/**
 * Guardrail for Carbon `Modal` buttons.
 *
 * `secondaryButtonText` (and `primaryButtonText`) only *render* a button —
 * Carbon does not close the dialog for you, so a text attribute without a
 * matching `on:click:button--*` handler produces a button that looks and feels
 * normal and does nothing at all. That is invisible to `svelte-check` and to
 * every unit test of the code around it; the only way to notice is to click it.
 *
 * It has happened once already (the table/list insert dialog's Cancel), so this
 * scans the source for the mismatch directly.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

function svelteFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...svelteFiles(path));
        else if (entry.name.endsWith('.svelte')) found.push(path);
    }
    return found;
}

/**
 * The end index of an opening tag's attribute list.
 *
 * A plain `indexOf('>')` is wrong here: arrow functions (`=>`) inside
 * `on:close={(e) => …}` are the first `>` in several of these tags. So braces
 * and quotes are tracked and only an unquoted, brace-free `>` ends the tag.
 */
function openingTagEnd(source, start) {
    let depth = 0;
    let quote = null;

    for (let i = start; i < source.length; i++) {
        const char = source[i];

        if (quote) {
            if (char === quote) quote = null;
            continue;
        }

        if (char === '"' || char === "'" || char === '`') quote = char;
        else if (char === '{') depth++;
        else if (char === '}') depth--;
        else if (char === '>' && depth === 0) return i;
    }

    return -1;
}

/** The raw source of every `<Modal …>` opening tag in a file. */
function modalTags(source) {
    const tags = [];
    let index = source.indexOf('<Modal');

    while (index !== -1) {
        const end = openingTagEnd(source, index);
        if (end === -1) break;
        tags.push(source.slice(index, end + 1));
        index = source.indexOf('<Modal', end);
    }

    return tags;
}

const BUTTONS = [
    ['primaryButtonText', 'on:click:button--primary'],
    ['secondaryButtonText', 'on:click:button--secondary'],
];

/** Button texts in a source that render without a handler. */
function deadButtons(source) {
    const dead = [];

    for (const tag of modalTags(source)) {
        for (const [text, handler] of BUTTONS) {
            if (tag.includes(text) && !tag.includes(handler)) dead.push(text);
        }
    }

    return dead;
}

test('every Modal button text has a matching click handler', () => {
    const offenders = [];

    for (const file of svelteFiles(srcDir)) {
        for (const text of deadButtons(readFileSync(file, 'utf8'))) {
            offenders.push(`${relative(srcDir, file)}: ${text}`);
        }
    }

    assert.deepEqual(
        offenders,
        [],
        `these Modal buttons render but do nothing: ${offenders.join(', ')}`,
    );
});

test('the check flags a button with no handler', () => {
    const source = [
        '<Modal',
        '    bind:open',
        '    primaryButtonText={m.md_insert()}',
        '    secondaryButtonText={m.modal_cancel()}',
        '    on:click:button--primary={handleSubmit}',
        '>',
    ].join('\n');

    assert.deepEqual(deadButtons(source), ['secondaryButtonText']);
});

test('the tag scanner survives arrow functions and braces', () => {
    // A naive `indexOf('>')` stops at the `=>` inside an arrow function and
    // cuts the tag short — which would make a wired button look unwired, or
    // worse, hide a real offender that appears after it.
    const source = [
        '<Modal',
        '    bind:open',
        '    secondaryButtonText={m.modal_cancel()}',
        '    on:click:button--secondary={() => (open = false)}',
        '    on:close={(e) => {',
        '        if (open) e.preventDefault();',
        '    }}',
        '>',
    ].join('\n');

    const [tag] = modalTags(source);

    // Attributes *after* the first arrow function are still inside the tag.
    assert.ok(tag.includes('on:click:button--secondary={() => (open = false)}'));
    assert.ok(tag.includes('if (open) e.preventDefault()'));
    assert.ok(tag.trimEnd().endsWith('>'));
    // And the wired button is not reported as dead.
    assert.deepEqual(deadButtons(source), []);
});
