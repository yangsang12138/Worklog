/**
 * Tests for the app-level todo-attribute configurations and their instances.
 *
 * The invariants here are what make "apply a configuration to a workspace" and
 * "push the instance back up" safe and repeatable: rules need names (or they
 * render blank everywhere), unique ids (or a ticket's id resolves twice), a
 * stable priority order (or two machines apply different orders), and at most one
 * default (or "the default" depends on row order). The diff is what tells a user
 * that their instance has drifted.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BUILTIN_CATALOG_SET_ID,
    DEFAULT_PRIORITY_COLOR,
    DEFAULT_TAG_COLOR,
    DEFAULT_TYPE_COLOR,
    LEGACY_CATALOG_NAME,
    catalogSetCounts,
    diffCatalogSet,
    diffIsEmpty,
    duplicateCatalogSet,
    emptyCatalogSet,
    findCatalogSet,
    isBuiltinCatalogSet,
    isCatalogSetEmpty,
    emptyRetainedRows,
    annotateRetainedLocal,
    retainedCount,
    newPriorityRule,
    newTagRule,
    newTypeRule,
    nextPriorityRank,
    normalizeCatalogSet,
    normalizeCatalogSets,
} from '../src/lib/app-config/catalogs.ts';

const set = (patch = {}) =>
    normalizeCatalogSet({
        name: 'Rules',
        types: [{ id: 'feature', name: 'Feature', color: 'teal', is_default: true }],
        priorities: [
            { id: 'p1', name: 'High', color: '#da1e28', rank: 10, is_default: true },
            { id: 'p2', name: 'Medium', color: '#005d5d', rank: 20 },
        ],
        tags: [{ id: 'TG-1', name: 'backend', color: 'blue' }],
        ...patch,
    });

// ── The library ───────────────────────────────────────────────────────────

test('a configuration with no name is dropped, a named one is kept', () => {
    const sets = normalizeCatalogSets({
        sets: [{ types: [{ name: 'Bug' }] }, { name: 'Product', tags: [{ name: 'docs' }] }],
    });

    assert.equal(sets.length, 1, 'an unlabelled configuration cannot be picked');
    assert.equal(sets[0].name, 'Product');
});

test('the single-set shape is adopted as the Default configuration', () => {
    // What the previous version wrote: one unnamed set at the top level.
    const sets = normalizeCatalogSets({
        types: [{ id: 'feature', name: 'Feature' }],
        priorities: [{ id: 'p1', name: 'High' }],
        tags: [{ name: 'backend' }],
    });

    assert.equal(sets.length, 1);
    assert.equal(sets[0].name, LEGACY_CATALOG_NAME);
    assert.equal(sets[0].types.length, 1);
    assert.equal(sets[0].priorities.length, 1);
    assert.equal(sets[0].tags.length, 1);
});

test('a bare array of configurations reads too', () => {
    const sets = normalizeCatalogSets([{ name: 'A' }, { name: 'B' }]);
    assert.deepEqual(
        sets.map((entry) => entry.name),
        ['A', 'B'],
    );
});

test('duplicate set ids are replaced', () => {
    const sets = normalizeCatalogSets({
        sets: [
            { id: 'CAT-SAME', name: 'A' },
            { id: 'CAT-SAME', name: 'B' },
        ],
    });

    assert.notEqual(sets[0].id, sets[1].id);
});

test('garbage produces an empty library, not garbage configurations', () => {
    for (const raw of [null, undefined, 'nope', 42, { sets: 'no' }, { sets: [1, null] }]) {
        assert.deepEqual(normalizeCatalogSets(raw), [], `raw=${JSON.stringify(raw)}`);
    }
});

// ── Rules inside a configuration ──────────────────────────────────────────

test('rules without a name are dropped', () => {
    const config = set({
        types: [{ name: '   ' }, { name: 'Bug' }],
        priorities: [{ name: '' }],
        tags: [{ name: '  ' }, { name: 'backend' }],
    });

    assert.deepEqual(config.types.map((rule) => rule.name), ['Bug']);
    assert.equal(config.priorities.length, 0);
    assert.deepEqual(config.tags.map((rule) => rule.name), ['backend']);
});

test('missing ids and colours get usable defaults', () => {
    const config = set({
        types: [{ name: 'Chore' }],
        priorities: [{ name: 'Low' }],
        tags: [{ name: 'docs' }],
    });

    assert.ok(config.types[0].id.startsWith('TY-'));
    assert.equal(config.types[0].color, DEFAULT_TYPE_COLOR);
    assert.ok(config.priorities[0].id.startsWith('PR-'));
    assert.equal(config.priorities[0].color, DEFAULT_PRIORITY_COLOR);
    assert.ok(config.tags[0].id.startsWith('TG-'));
    assert.equal(config.tags[0].color, DEFAULT_TAG_COLOR);
});

test('duplicate tag names are dropped, because names are the match key', () => {
    const config = set({
        tags: [
            { name: 'backend', color: 'blue' },
            { name: 'backend', color: 'red' },
        ],
    });

    assert.equal(config.tags.length, 1);
    assert.equal(config.tags[0].color, 'blue', 'the first one wins');
});

test('priority levels come out in a stable, gap-free order', () => {
    const config = set({
        priorities: [
            { name: 'Medium', rank: 20 },
            { name: 'High', rank: 5 },
            { name: 'Low', rank: 99 },
        ],
    });

    assert.deepEqual(config.priorities.map((rule) => rule.name), ['High', 'Medium', 'Low']);
    assert.deepEqual(config.priorities.map((rule) => rule.rank), [10, 20, 30]);
});

test('at most one default survives, and the first flagged one wins', () => {
    const config = set({
        types: [{ name: 'A', is_default: true }, { name: 'B', is_default: true }],
        priorities: [
            { name: 'X', rank: 10, is_default: true },
            { name: 'Y', rank: 20, is_default: true },
        ],
    });

    assert.deepEqual(config.types.map((rule) => rule.is_default), [true, false]);
    assert.deepEqual(config.priorities.map((rule) => rule.is_default), [true, false]);
});

test('new rules were made for appending to a configuration', () => {
    const empty = emptyCatalogSet();
    assert.equal(newPriorityRule(empty).is_default, true);
    assert.equal(nextPriorityRank(empty), 10);

    const one = set();
    assert.equal(
        newPriorityRule(one).is_default,
        false,
        'a level added later must not steal the default',
    );
    assert.equal(newPriorityRule(one).rank, 30);
    assert.equal(newTypeRule().name, '');
    assert.equal(newTagRule().name, '');
});

test('counts and emptiness describe a configuration', () => {
    assert.deepEqual(catalogSetCounts(set()), { types: 1, priorities: 2, tags: 1 });
    assert.equal(isCatalogSetEmpty(emptyCatalogSet()), true);
    assert.equal(isCatalogSetEmpty(set()), false);
});

test('duplicating gives the copy its own rule ids', () => {
    const original = set();
    const copy = duplicateCatalogSet(original);

    assert.notEqual(copy.id, original.id);
    assert.equal(copy.name, original.name, 'the label is copied, not invented');
    assert.deepEqual(copy.types.map((r) => r.name), original.types.map((r) => r.name));
    assert.notEqual(copy.types[0].id, original.types[0].id);
    assert.notEqual(copy.priorities[0].id, original.priorities[0].id);
    assert.notEqual(copy.tags[0].id, original.tags[0].id);

    copy.types[0].name = 'Renamed';
    assert.equal(original.types[0].name, 'Feature', 'the copy is independent');
});

test('findCatalogSet resolves a workspace reference', () => {
    const sets = normalizeCatalogSets({ sets: [{ id: 'CAT-ONE', name: 'A' }] });
    assert.equal(findCatalogSet(sets, 'CAT-ONE')?.name, 'A');
    assert.equal(findCatalogSet(sets, 'CAT-GONE'), null);
    assert.equal(findCatalogSet(sets, ''), null);
    assert.equal(findCatalogSet(sets, null), null);
});

// ── Divergence ────────────────────────────────────────────────────────────

test('an instance that matches its configuration reports no differences', () => {
    const diff = diffCatalogSet(set(), set());
    assert.equal(diff.identical, true);
    assert.equal(diff.total, 0);
    assert.equal(diffIsEmpty(diff.types), true);
});

test('a rule missing from the instance is reported as missing', () => {
    const body = set({ tags: [{ id: 'TG-1', name: 'backend' }, { id: 'TG-2', name: 'docs' }] });
    const instance = set({ tags: [{ id: 'TG-1', name: 'backend' }] });

    const diff = diffCatalogSet(body, instance);
    assert.deepEqual(diff.tags.missing, ['docs']);
    assert.deepEqual(diff.tags.local, []);
    assert.equal(diff.identical, false);
});

test('a rule added locally is reported as local, not as an error', () => {
    // This is the ordinary case: a tag added while filing a ticket.
    const body = set();
    const instance = set({
        tags: [{ id: 'TG-1', name: 'backend' }, { id: 'TG-9', name: 'one-off' }],
    });

    const diff = diffCatalogSet(body, instance);
    assert.deepEqual(diff.tags.local, ['one-off']);
    assert.deepEqual(diff.tags.missing, []);
});

test('a renamed rule is reported as changed', () => {
    const body = set();
    const instance = set({
        types: [{ id: 'feature', name: 'Enhancement', color: 'teal', is_default: true }],
    });

    const diff = diffCatalogSet(body, instance);
    assert.deepEqual(diff.types.changed, ['Enhancement']);
    assert.deepEqual(diff.types.missing, []);
});

test('a colour change counts as a difference', () => {
    const body = set();
    const instance = set({
        tags: [{ id: 'TG-1', name: 'backend', color: 'red' }],
    });

    assert.deepEqual(diffCatalogSet(body, instance).tags.changed, ['backend']);
});

test('priority order is part of the comparison', () => {
    const body = set();
    // Same levels, same names and colours — only the order differs, which the
    // board would render in the wrong sequence.
    const instance = normalizeCatalogSet({
        name: 'Rules',
        types: body.types,
        priorities: [
            { id: 'p2', name: 'Medium', color: '#005d5d', rank: 10 },
            { id: 'p1', name: 'High', color: '#da1e28', rank: 20, is_default: true },
        ],
        tags: body.tags,
    });

    const diff = diffCatalogSet(body, instance);
    assert.equal(diff.identical, false);
    assert.deepEqual(diff.priorities.changed, ['High', 'Medium']);
});

test('the total counts every kind of difference', () => {
    const body = set();
    const instance = set({
        types: [{ id: 'feature', name: 'Enhancement', color: 'teal', is_default: true }],
        priorities: [],
        tags: [{ id: 'TG-1', name: 'backend', color: 'blue' }, { id: 'TG-9', name: 'extra' }],
    });

    const diff = diffCatalogSet(body, instance);
    assert.equal(
        diff.total,
        4,
        '1 changed type + 2 missing priorities + 1 tag that only exists locally',
    );
    assert.equal(diff.identical, false);
    assert.deepEqual(diff.types.changed, ['Enhancement']);
    assert.deepEqual(diff.priorities.missing, ['High', 'Medium']);
    assert.deepEqual(
        diff.tags.changed,
        [],
        'an identical tag is not a difference, even when other kinds are',
    );
    assert.deepEqual(diff.tags.local, ['extra']);
});

// ── The built-in ──────────────────────────────────────────────────────────

test('only the reserved id counts as the built-in', () => {
    assert.equal(isBuiltinCatalogSet(BUILTIN_CATALOG_SET_ID), true);
    assert.equal(isBuiltinCatalogSet('CAT-ABCDEF'), false);
    assert.equal(isBuiltinCatalogSet(''), false);
    assert.equal(isBuiltinCatalogSet(null), false);
    assert.equal(
        isBuiltinCatalogSet(undefined),
        false,
        'so a copy of the built-in is an ordinary configuration',
    );
});

test('tags are compared by name, because their ids are not stable', () => {
    // The workspace seeds tags with random UUIDs; the built-in derives its ids
    // from the names. Comparing ids would report every tag as both missing and
    // local on an untouched workspace.
    const body = normalizeCatalogSet({
        name: 'Body',
        tags: [{ id: 'TG-BUILTIN-BACKEND9', name: 'backend', color: 'cool-gray' }],
    });
    const instance = normalizeCatalogSet({
        name: 'Instance',
        tags: [{ id: '9f1c-uuid', name: 'backend', color: 'cool-gray' }],
    });

    const diff = diffCatalogSet(body, instance);
    assert.equal(diff.tags.missing.length, 0);
    assert.equal(diff.tags.local.length, 0);
    assert.equal(diff.tags.changed.length, 0);
    assert.equal(diff.identical, true, 'a matching tag is a match, whatever its id');
});

test('a tag colour change is reported even though ids differ', () => {
    const body = normalizeCatalogSet({
        name: 'Body',
        tags: [{ id: 'TG-1', name: 'backend', color: 'cool-gray' }],
    });
    const instance = normalizeCatalogSet({
        name: 'Instance',
        tags: [{ id: 'uuid-1', name: 'backend', color: 'red' }],
    });

    assert.deepEqual(diffCatalogSet(body, instance).tags.changed, ['backend']);
});

test('a renamed tag reads as one addition and one removal', () => {
    const body = normalizeCatalogSet({
        name: 'Body',
        tags: [{ name: 'backend', color: 'cool-gray' }],
    });
    const instance = normalizeCatalogSet({
        name: 'Instance',
        tags: [{ name: 'server', color: 'cool-gray' }],
    });

    const diff = diffCatalogSet(body, instance);
    assert.deepEqual(diff.tags.missing, ['backend']);
    assert.deepEqual(diff.tags.local, ['server']);
    assert.deepEqual(
        diff.tags.changed,
        [],
        'nothing links the two rows except the name, so neither counts as changed',
    );
});

// ── Rows kept because tickets point at them ───────────────────────────────

test('a retained row is still reported as a difference, just not as removable', () => {
    const body = normalizeCatalogSet({
        name: 'Config',
        types: [{ id: 'bug', name: 'Bug', color: 'red' }],
    });
    const instance = normalizeCatalogSet({
        name: 'Instance',
        types: [
            { id: 'bug', name: 'Bug', color: 'red' },
            { id: 'TY-USED', name: 'Only here', color: 'blue' },
        ],
    });

    const retained = emptyRetainedRows();
    retained.types.add('TY-USED');
    const annotated = annotateRetainedLocal(
        diffCatalogSet(body, instance),
        instance,
        retained,
    );

    assert.deepEqual(
        annotated.types.local,
        [],
        'a replace would not remove it',
    );
    assert.deepEqual(
        annotated.retained.types,
        ['Only here'],
        'but the instance genuinely does have something the configuration does not',
    );
    assert.equal(
        annotated.identical,
        false,
        'claiming "identical" here was the bug: a user who had just added a level was told nothing differed',
    );
    assert.equal(annotated.total, 1);
});

test('a local row nothing references is reported as removable', () => {
    const body = normalizeCatalogSet({ name: 'Config', types: [] });
    const instance = normalizeCatalogSet({
        name: 'Instance',
        types: [
            { id: 'TY-KEPT', name: 'Kept', color: 'blue' },
            { id: 'TY-FREE', name: 'Free', color: 'red' },
        ],
    });

    const retained = emptyRetainedRows();
    retained.types.add('TY-KEPT');
    const annotated = annotateRetainedLocal(
        diffCatalogSet(body, instance),
        instance,
        retained,
    );

    assert.deepEqual(annotated.types.local, ['Free']);
    assert.deepEqual(annotated.retained.types, ['Kept']);
    assert.equal(annotated.total, 2, 'both are differences; only one is removable');
    assert.equal(annotated.identical, false);
});

test('retained tags are matched by name, and priorities by id', () => {
    const body = normalizeCatalogSet({ name: 'Config', tags: [], priorities: [] });
    const instance = normalizeCatalogSet({
        name: 'Instance',
        priorities: [{ id: 'PR-USED', name: 'Used level', color: '#da1e28', rank: 10 }],
        tags: [
            { id: 'uuid-1', name: 'used', color: 'blue' },
            { id: 'uuid-2', name: 'free', color: 'red' },
        ],
    });

    const retained = emptyRetainedRows();
    retained.priorities.add('PR-USED');
    retained.tags.add('used');

    const annotated = annotateRetainedLocal(
        diffCatalogSet(body, instance),
        instance,
        retained,
    );

    assert.deepEqual(annotated.retained.priorities, ['Used level']);
    assert.deepEqual(annotated.retained.tags, ['used']);
    assert.deepEqual(annotated.tags.local, ['free']);
    assert.equal(annotated.total, 3);
    assert.equal(retainedCount(retained), 2);
});

test('a genuine difference is never excused by retention', () => {
    const body = normalizeCatalogSet({
        name: 'Config',
        types: [{ id: 'bug', name: 'Bug', color: 'red' }],
    });
    const instance = normalizeCatalogSet({
        name: 'Instance',
        types: [{ id: 'bug', name: 'Bug', color: 'blue' }],
    });

    const retained = emptyRetainedRows();
    retained.types.add('bug');
    const annotated = annotateRetainedLocal(
        diffCatalogSet(body, instance),
        instance,
        retained,
    );

    assert.deepEqual(annotated.types.changed, ['Bug']);
    assert.deepEqual(annotated.retained.types, []);
    assert.equal(annotated.identical, false);
    assert.equal(annotated.total, 1);
});

test('nothing retained and nothing different means identical', () => {
    const body = normalizeCatalogSet({ name: 'Same' });
    const annotated = annotateRetainedLocal(
        diffCatalogSet(body, body),
        body,
        emptyRetainedRows(),
    );

    assert.equal(annotated.identical, true);
    assert.equal(annotated.total, 0);
});
