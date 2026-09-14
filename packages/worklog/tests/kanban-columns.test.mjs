/**
 * Unit tests for the per-board Kanban column configuration.
 *
 * `columns_config` is a JSON column that can be written by older builds, hand
 * edits or a partially-synced workspace, so the parser has to be defensive:
 * a bad value must degrade to the built-in four columns rather than leave a
 * board with nothing to show. These tests pin that contract plus the rules
 * that keep a column removal from losing work.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DatabaseSync } from 'node:sqlite';

import { CREATE_TABLES } from '../src/lib/db/schema.ts';
import { ensureBoardSchema } from '../src/lib/db/ensure-board-schema.ts';
import { ensurePushSchema } from '../src/lib/db/ensure-push-schema.ts';

import {
    MAX_WIDTH_SHARE,
    addCustomColumn,
    applyViewState,
    canRemoveColumn,
    clampShare,
    columnWeight,
    computeShares,
    defaultColumns,
    extractViewState,
    findColumn,
    hasOverrides,
    hiddenColumns,
    isBuiltinColumn,
    legacyViewStateFromStored,
    moveColumn,
    normalizeColumns,
    parseBoardColumns,
    patchColumn,
    removeColumn,
    resetColumn,
    resetWidthShares,
    resolveColumnTitle,
    setWidthShare,
    serializeBoardColumns,
    visibleColumns,
} from '../src/lib/db/columns-config.ts';

const ORDER = ['backlog', 'todo', 'in_progress', 'done'];

test('an empty config resolves to the four built-in columns in canonical order', () => {
    for (const raw of ['', null, undefined]) {
        const columns = parseBoardColumns(raw, ORDER);
        assert.deepEqual(
            columns.map((c) => c.status),
            ORDER,
        );
        assert.ok(columns.every((c) => c.title === null && c.note === null));
        assert.ok(columns.every((c) => !c.collapsed && !c.hidden));
    }
});

test('malformed or unusable configs fall back to the defaults', () => {
    for (const raw of ['not json', '{}', '[]', 'null', '42', '[{"status":""}]', '[{"noStatus":1}]']) {
        assert.deepEqual(
            parseBoardColumns(raw, ORDER).map((c) => c.status),
            ORDER,
            `raw=${raw}`,
        );
    }
});

test('unknown statuses become custom columns, and their order is kept', () => {
    const raw = JSON.stringify([
        { status: 'CST-ABCDEF', title: '待评审' },
        { status: 'backlog' },
    ]);

    const columns = normalizeColumns(JSON.parse(raw), ORDER);
    // The custom stage keeps its stored slot; the missing built-in stages are
    // slotted in at their canonical positions around it.
    assert.deepEqual(
        columns.map((c) => c.status),
        ['CST-ABCDEF', 'backlog', 'todo', 'in_progress', 'done'],
    );
    assert.equal(findColumn(columns, 'CST-ABCDEF').kind, 'custom');
    assert.ok(columns.every((c) => (ORDER.includes(c.status) ? c.kind === 'builtin' : c.kind === 'custom')));
});

test('duplicate statuses collapse to the first entry', () => {
    const raw = JSON.stringify([
        { status: 'done', title: 'first wins' },
        { status: 'done', title: 'second loses' },
        { status: 'CST-DUPLIC', title: 'stage' },
        { status: 'CST-DUPLIC', title: 'again' },
    ]);

    const columns = parseBoardColumns(raw, ORDER);
    assert.deepEqual(columns.map((c) => c.status), [...ORDER, 'CST-DUPLIC']);
    assert.equal(findColumn(columns, 'done').title, 'first wins');
    assert.equal(findColumn(columns, 'CST-DUPLIC').title, 'stage');
});

test('a status the board does not know stays visible as its own stage', () => {
    // Sync can hand us a ticket whose stage belongs to another machine's
    // custom column. It must not vanish.
    const columns = parseBoardColumns(
        JSON.stringify([{ status: 'CST-REMOTE', title: '远端阶段' }]),
        ORDER,
    );
    assert.equal(findColumn(columns, 'CST-REMOTE').kind, 'custom');
    assert.equal(findColumn(columns, 'CST-REMOTE').title, '远端阶段');
});

test('the stored order is authoritative, and missing built-ins slot back in', () => {
    const raw = JSON.stringify([
        { status: 'done' },
        { status: 'backlog' },
        { status: 'in_progress' },
    ]);
    // 'todo' was missing, so it returns ahead of the first stage that
    // canonically follows it ('done'), leaving the rest of the order alone.
    assert.deepEqual(
        parseBoardColumns(raw, ORDER).map((c) => c.status),
        ['todo', 'done', 'backlog', 'in_progress'],
    );

    // A config that only lost a trailing stage gets it back on the end.
    assert.deepEqual(
        parseBoardColumns(
            JSON.stringify([{ status: 'backlog' }, { status: 'todo' }, { status: 'in_progress' }]),
            ORDER,
        ).map((c) => c.status),
        ORDER,
    );
});

test('overrides are trimmed and blank strings become "no override"', () => {
    const raw = JSON.stringify([
        { status: 'backlog', title: '  Ideas  ', note: '   ' },
        { status: 'todo', title: '', note: 'queued' },
        { status: 'in_progress' },
        { status: 'done' },
    ]);

    const [backlog, todo] = parseBoardColumns(raw, ORDER);
    assert.equal(backlog.title, 'Ideas');
    assert.equal(backlog.note, null, 'whitespace-only note is not an override');
    assert.equal(todo.title, null, 'empty title is not an override');
    assert.equal(todo.note, 'queued');
});

test('view state only accepts real booleans', () => {
    const raw = JSON.stringify([
        { status: 'backlog', collapsed: 'yes', hidden: 1 },
        { status: 'todo', collapsed: true, hidden: true },
        { status: 'in_progress' },
        { status: 'done' },
    ]);

    const [backlog, todo] = parseBoardColumns(raw, ORDER);
    assert.equal(backlog.collapsed, false);
    assert.equal(backlog.hidden, false);
    assert.equal(todo.collapsed, true);
    assert.equal(todo.hidden, true);
});

test('the four default columns are built-in and never removable', () => {
    const columns = defaultColumns(ORDER);

    assert.ok(columns.every((c) => c.kind === 'builtin'));
    assert.ok(columns.every((c) => isBuiltinColumn(c)));
    assert.ok(columns.every((c) => !hasOverrides(c)));

    for (const column of columns) {
        assert.equal(
            canRemoveColumn(columns, column.status, 0),
            false,
            'a built-in stage must never be removable',
        );
    }

    // Renaming a built-in column does not turn it into a custom one.
    const renamed = patchColumn(columns, 'todo', { title: 'Ready' });
    assert.equal(isBuiltinColumn(findColumn(renamed, 'todo')), true);
    assert.equal(hasOverrides(findColumn(renamed, 'todo')), true);
    assert.equal(canRemoveColumn(renamed, 'todo', 0), false);
});

test('serialize/parse round-trips the domain half of a config', () => {
    const columns = parseBoardColumns(
        JSON.stringify([
            { status: 'backlog', title: 'Ideas', note: 'not started', collapsed: true },
            { status: 'done', hidden: true },
        ]),
        ORDER,
    );

    // `columns_config` is a *synced* field, so the stored form carries only
    // what the team shares: view state is stripped on write (it lives in the
    // per-board local store) and comes back at its defaults.
    const stored = parseBoardColumns(serializeBoardColumns(columns), ORDER);

    assert.deepEqual(
        stored.map(({ status, kind, title, note, accentColor }) => ({
            status,
            kind,
            title,
            note,
            accentColor,
        })),
        columns.map(({ status, kind, title, note, accentColor }) => ({
            status,
            kind,
            title,
            note,
            accentColor,
        })),
    );

    assert.ok(
        stored.every((c) => !c.collapsed && !c.hidden && c.widthShare === null),
        'view state must not be persisted into the synced column config',
    );
});

test('view state is extracted only when it differs from the default', () => {
    let columns = defaultColumns(ORDER);
    assert.deepEqual(extractViewState(columns), {}, 'a default board stores nothing');

    columns = patchColumn(columns, 'todo', { collapsed: true, widthShare: 3 });
    columns = patchColumn(columns, 'done', { hidden: true });

    assert.deepEqual(extractViewState(columns), {
        todo: { collapsed: true, widthShare: 3 },
        done: { hidden: true },
    });
});

test('view state reapplies onto the stored domain config', () => {
    const columns = defaultColumns(ORDER);
    const restored = applyViewState(columns, {
        todo: { collapsed: true, widthShare: 2 },
        done: { hidden: true },
    });

    assert.equal(findColumn(restored, 'todo').collapsed, true);
    assert.equal(findColumn(restored, 'todo').widthShare, 2);
    assert.equal(findColumn(restored, 'done').hidden, true);
    assert.equal(findColumn(restored, 'backlog').collapsed, false);
});

test('view state for a status the board no longer has is ignored', () => {
    const restored = applyViewState(defaultColumns(ORDER), {
        'CST-GONE01': { hidden: true },
    });

    assert.deepEqual(
        restored.map((c) => c.status),
        ORDER,
        'a stale local layout cannot resurrect a deleted column',
    );
});

test('a legacy stored config still yields its view state for migration', () => {
    const raw = JSON.stringify([
        { status: 'backlog', collapsed: true, widthShare: 2 },
        { status: 'todo', hidden: true },
        { status: 'done', collapsed: 'yes', widthShare: 'wide' },
    ]);

    assert.deepEqual(legacyViewStateFromStored(raw), {
        backlog: { collapsed: true, widthShare: 2 },
        todo: { hidden: true },
    });
    assert.deepEqual(legacyViewStateFromStored('not json'), {});
    assert.deepEqual(legacyViewStateFromStored(''), {});
});

test('hidden and visible columns partition the config', () => {
    const columns = patchColumn(defaultColumns(ORDER), 'todo', { hidden: true });
    assert.deepEqual(
        visibleColumns(columns).map((c) => c.status),
        ['backlog', 'in_progress', 'done'],
    );
    assert.deepEqual(
        hiddenColumns(columns).map((c) => c.status),
        ['todo'],
    );
});

test('built-in columns that were dropped by an older config come back', () => {
    // The previous model allowed removing a built-in column; those configs
    // must not leave a board without its fixed stages.
    const parsed = parseBoardColumns(
        JSON.stringify([{ status: 'todo' }, { status: 'done' }]),
        ORDER,
    );
    assert.deepEqual(
        parsed.map((c) => c.status).sort(),
        [...ORDER].sort(),
    );
    assert.ok(parsed.every((c) => c.kind === 'builtin'));
});

test('adding a custom column appends a new stage with its own status', () => {
    const columns = defaultColumns(ORDER);
    const withCustom = addCustomColumn(columns, '  待评审  ', ['teal', 'purple']);

    assert.equal(withCustom.length, ORDER.length + 1);
    const custom = withCustom[withCustom.length - 1];
    assert.equal(custom.kind, 'custom');
    assert.equal(custom.title, '待评审', 'the name is trimmed');
    assert.equal(custom.accentColor, 'teal', 'accent comes from the palette');
    assert.ok(custom.status.startsWith('CST-'), 'a generated status id');
    assert.ok(
        !ORDER.includes(custom.status),
        'the custom stage is not one of the built-in statuses',
    );
    assert.equal(custom.collapsed, false);
    assert.equal(custom.hidden, false);

    // The generated status survives a store/load round trip.
    const reloaded = parseBoardColumns(serializeBoardColumns(withCustom), ORDER);
    assert.deepEqual(reloaded, withCustom);
});

test('a custom column needs a name, and accents cycle through the palette', () => {
    let columns = defaultColumns(ORDER);
    assert.equal(
        addCustomColumn(columns, '   ', ['teal']).length,
        columns.length,
        'a blank name is rejected',
    );

    columns = addCustomColumn(columns, '评审', ['teal', 'purple']);
    columns = addCustomColumn(columns, '测试', ['teal', 'purple']);
    const customs = columns.filter((c) => c.kind === 'custom');
    assert.deepEqual(
        customs.map((c) => c.accentColor),
        ['teal', 'purple'],
    );
    assert.notEqual(customs[0].status, customs[1].status, 'statuses are unique');
});

test('columns can be reordered, and the order survives a round trip', () => {
    let columns = addCustomColumn(defaultColumns(ORDER), '评审', ['teal']);
    const custom = columns[columns.length - 1].status;
    const order = () => columns.map((c) => c.status);

    columns = moveColumn(columns, custom, -1);
    assert.deepEqual(order(), ['backlog', 'todo', 'in_progress', custom, 'done']);

    columns = moveColumn(columns, custom, -1);
    assert.deepEqual(order(), ['backlog', 'todo', custom, 'in_progress', 'done']);

    // Out-of-range moves are no-ops, not corruption.
    const first = columns[0].status;
    assert.deepEqual(moveColumn(columns, first, -1).map((c) => c.status), order());
    const last = columns[columns.length - 1].status;
    assert.deepEqual(moveColumn(columns, last, 1).map((c) => c.status), order());

    assert.deepEqual(
        parseBoardColumns(serializeBoardColumns(columns), ORDER).map((c) => c.status),
        order(),
        'display order is preserved through storage',
    );
});

test('resetting a built-in column drops only its overrides', () => {
    let columns = patchColumn(defaultColumns(ORDER), 'backlog', {
        title: 'Ideas',
        note: 'someday',
        collapsed: true,
    });

    columns = resetColumn(columns, 'backlog');
    const backlog = columns.find((c) => c.status === 'backlog');
    assert.equal(backlog?.title, null);
    assert.equal(backlog?.note, null);
    assert.equal(backlog?.collapsed, true, 'view state survives a reset');
});

test('only an empty custom column can be removed', () => {
    const columns = addCustomColumn(defaultColumns(ORDER), '评审', ['teal']);
    const custom = columns[columns.length - 1].status;

    assert.equal(canRemoveColumn(columns, custom, 0), true);
    assert.equal(canRemoveColumn(columns, custom, 3), false, 'tickets would be stranded');
    assert.equal(canRemoveColumn(columns, 'todo', 0), false, 'built-in stages stay');
    assert.equal(canRemoveColumn(columns, 'nope', 0), false, 'unknown column');

    // Even a custom column cannot be deleted out from under its tickets.
    assert.deepEqual(
        removeColumn(columns, custom).map((c) => c.status),
        ORDER,
    );
    assert.deepEqual(
        removeColumn(columns, 'todo').map((c) => c.status),
        columns.map((c) => c.status),
        'removing a built-in column is a no-op',
    );
});

test('the resolved title prefers the override and falls back to the built-in label', () => {
    const columns = patchColumn(defaultColumns(ORDER), 'todo', { title: 'Ready' });

    assert.equal(resolveColumnTitle(columns, 'todo', 'To Do'), 'Ready');
    assert.equal(resolveColumnTitle(columns, 'done', 'Done'), 'Done');
});

// ── Upgrade path ───────────────────────────────────────────────────────────
// Adding a column to a live workspace is the one part of this feature that
// touches data people already have, so it is exercised against real SQLite.
//
// `migrate.ts` cannot be imported here (its internal imports are
// extensionless, which Node's ESM resolver rejects), so the statement is read
// straight out of the source — the same approach `board-delete.test.mjs` uses
// for `migrate_v12`.

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATE_V20_DDL = (() => {
    const source = readFileSync(join(here, '..', 'src', 'lib', 'db', 'migrate.ts'), 'utf8');
    const fn = source.slice(source.indexOf('async function migrate_v20'));
    const ddl = fn.match(/`(ALTER TABLE boards ADD COLUMN columns_config[^`]*)`/);
    assert.ok(ddl, 'could not locate the migrate_v20 ADD COLUMN statement');
    return ddl[1];
})();

/** The `boards` table as it existed at schema v19 — before columns_config. */
const BOARDS_V19 = `
    CREATE TABLE boards (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tabs_config TEXT NOT NULL DEFAULT '["kanban"]',
        archived_at TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
`;

test('migrate_v20 adds columns_config to an existing workspace without losing boards', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(BOARDS_V19);

    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO boards (id, name, description, tabs_config, archived_at, created_at, updated_at)
             VALUES ('BRD-1', 'Existing', 'desc', '["kanban","table"]', NULL, ?, ?)`,
        )
        .run(now, now);

    sqlite.exec(MIGRATE_V20_DDL);

    const column = sqlite
        .prepare(`PRAGMA table_info(boards)`)
        .all()
        .find((c) => c.name === 'columns_config');
    assert.ok(column, 'columns_config was not added');
    assert.equal(column.notnull, 1, 'the column is NOT NULL');
    assert.equal(column.dflt_value, "''", 'the column defaults to an empty string');

    // Existing rows must survive the upgrade untouched, and read as "default".
    const row = sqlite.prepare('SELECT * FROM boards WHERE id = ?').get('BRD-1');
    assert.equal(row.name, 'Existing');
    assert.equal(row.tabs_config, '["kanban","table"]');
    assert.equal(row.columns_config, '');
    assert.deepEqual(
        parseBoardColumns(row.columns_config, ORDER).map((c) => c.status),
        ORDER,
        'an untouched legacy board keeps all four columns',
    );
});

test('a fresh workspace declares columns_config directly', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(CREATE_TABLES);

    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO boards (id, name, description, created_at, updated_at)
             VALUES ('BRD-2', 'Fresh', '', ?, ?)`,
        )
        .run(now, now);

    const row = sqlite.prepare('SELECT columns_config FROM boards WHERE id = ?').get('BRD-2');
    assert.equal(row.columns_config, '');

    // A board that never customises still resolves to the built-in columns.
    assert.deepEqual(
        parseBoardColumns(row.columns_config, ORDER).map((c) => c.status),
        ORDER,
    );
});

test('a stored customisation survives a round-trip through the DB column', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(CREATE_TABLES);

    const configured = parseBoardColumns(
        JSON.stringify([
            { status: 'backlog', title: 'Ideas', note: 'someday' },
            { status: 'done', hidden: true },
        ]),
        ORDER,
    );

    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO boards (id, name, description, columns_config, created_at, updated_at)
             VALUES ('BRD-3', 'Custom', '', ?, ?, ?)`,
        )
        .run(serializeBoardColumns(configured), now, now);

    const row = sqlite.prepare('SELECT columns_config FROM boards WHERE id = ?').get('BRD-3');
    const stored = parseBoardColumns(row.columns_config, ORDER);

    // The name and remark are workspace data — the team shares them.
    assert.equal(findColumn(stored, 'backlog').title, 'Ideas');
    assert.equal(findColumn(stored, 'backlog').note, 'someday');

    // The layout is not: it belongs to the machine, so the DB round-trip drops
    // it (the caller's local view-state store keeps it).
    assert.equal(
        findColumn(stored, 'done').hidden,
        false,
        'view state must not survive as workspace data',
    );
});

// ── Self-healing guard ─────────────────────────────────────────────────────
// A workspace can report the current `schema_version` while `boards` is still
// the older shape, because `CREATE TABLE IF NOT EXISTS` is a no-op on an
// existing table and `runMigrations` returns early once the version matches.
// Every column-config write then fails with "no such column" and the UI
// silently reverts. `ensureBoardSchema` repairs this independently of the
// version — this test pins the exact failure that produced a dead column
// manager on a real workspace.

/** Minimal stand-in for the Tauri SQL plugin's `Database`. */
function pluginLike(sqlite) {
    return {
        select: async (sql, params) => sqlite.prepare(sql).all(...(params ?? [])),
        execute: async (sql, params) =>
            params?.length
                ? sqlite.prepare(sql).run(...params)
                : sqlite.exec(sql),
    };
}

/** The UPDATE that `BoardRepo.updateBoardColumns` issues. */
function updateColumns(sqlite, boardId, json) {
    sqlite
        .prepare(`UPDATE boards SET columns_config = ?, updated_at = ? WHERE id = ?`)
        .run(json, new Date().toISOString(), boardId);
}

test('a workspace stamped at the current version but missing columns_config is repaired', async () => {
    // Exactly the state found in the wild: version 20, boards table at v19.
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE workspace_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            sync_mode TEXT NOT NULL DEFAULT 'local',
            created_at TEXT NOT NULL
        );
    `);
    sqlite.exec(BOARDS_V19);

    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO workspace_meta (id, name, schema_version, created_at) VALUES (1, 'ws', 20, ?)`,
        )
        .run(now);
    sqlite
        .prepare(
            `INSERT INTO boards (id, name, description, tabs_config, archived_at, created_at, updated_at)
             VALUES ('BRD-1', 'Board', '', '["kanban"]', NULL, ?, ?)`,
        )
        .run(now, now);

    // Before the guard, the repo's write blows up — this is the "nothing
    // happens when I click" symptom.
    assert.throws(
        () => updateColumns(sqlite, 'BRD-1', '[]'),
        /no such column/,
        'the broken state must be reproducible without the guard',
    );

    await ensureBoardSchema(pluginLike(sqlite));

    // The write now succeeds and round-trips a real configuration.
    const configured = parseBoardColumns(
        JSON.stringify([{ status: 'backlog', title: 'Ideas' }, { status: 'done', note: 'shipped' }]),
        ORDER,
    );
    updateColumns(sqlite, 'BRD-1', serializeBoardColumns(configured));

    const row = sqlite.prepare('SELECT * FROM boards WHERE id = ?').get('BRD-1');
    assert.equal(row.name, 'Board', 'existing board data is untouched');
    assert.deepEqual(parseBoardColumns(row.columns_config, ORDER), configured);
    assert.equal(
        parseBoardColumns(row.columns_config, ORDER).find((c) => c.status === 'backlog').title,
        'Ideas',
        'the domain config survives the repaired write',
    );

    // Layout is deliberately *not* part of what gets stored here: this field is
    // synced, so a repair write must not carry one user's column widths into
    // everyone else's board.
    const withLayout = patchColumn(configured, 'backlog', {
        collapsed: true,
        widthShare: 4,
    });
    updateColumns(sqlite, 'BRD-1', serializeBoardColumns(withLayout));

    const refreshed = sqlite.prepare('SELECT * FROM boards WHERE id = ?').get('BRD-1');
    assert.equal(
        /collapsed|hidden|widthShare/.test(refreshed.columns_config),
        false,
        'view state must never reach the synced column config',
    );
});

test('the guard is idempotent and also reconciles the other late board columns', async () => {
    const sqlite = new DatabaseSync(':memory:');
    // The very first boards shape — before archiving, tabs and columns.
    sqlite.exec(`
        CREATE TABLE boards (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    `);

    const now = new Date().toISOString();
    sqlite
        .prepare(`INSERT INTO boards (id, name, created_at, updated_at) VALUES ('B', 'B', ?, ?)`)
        .run(now, now);

    const db = pluginLike(sqlite);
    await ensureBoardSchema(db);
    await ensureBoardSchema(db); // must be safe to re-run

    const cols = sqlite.prepare('PRAGMA table_info(boards)').all().map((c) => c.name);
    assert.ok(cols.includes('archived_at'), 'archived_at reconciled');
    assert.ok(cols.includes('tabs_config'), 'tabs_config reconciled');
    assert.ok(cols.includes('columns_config'), 'columns_config reconciled');

    const row = sqlite.prepare('SELECT * FROM boards WHERE id = ?').get('B');
    assert.equal(row.columns_config, '');
    assert.equal(row.tabs_config, '["kanban"]', 'the tab default is preserved');
    assert.equal(row.archived_at, null);
});

test('the guard does nothing when there is no boards table yet', async () => {
    const sqlite = new DatabaseSync(':memory:');
    await ensureBoardSchema(pluginLike(sqlite)); // must not throw
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM sqlite_master`).get().n, 0);
});

// ── Migration v21: custom statuses become storable ─────────────────────────
// `tickets.status` used to be limited to the four built-in values by a CHECK
// constraint, which is exactly what made a user-defined stage impossible.
// migrate.ts cannot be imported here (extensionless internal imports), so the
// statements are read out of the source, as with migrate_v12/migrate_v20.

const MIGRATE_V21 = (() => {
    const source = readFileSync(join(here, '..', 'src', 'lib', 'db', 'migrate.ts'), 'utf8');
    const fn = source.slice(source.indexOf('async function migrate_v21'));
    assert.ok(fn.length > 0, 'could not locate migrate_v21');

    const ddl = fn.match(/CREATE TABLE tickets \(([\s\S]*?)\n {12}\)\n/);
    const insert = fn.match(/INSERT INTO tickets \([\s\S]*?FROM tickets_v20\n/);
    assert.ok(ddl, 'could not locate the migrate_v21 tickets DDL');
    assert.ok(insert, 'could not locate the migrate_v21 copy statement');

    return {
        createTickets: `CREATE TABLE tickets (${ddl[1]}\n)`,
        copyTicketsRaw: insert[0],
        // The shape v20 shipped: status pinned to the four built-in values.
        legacyTickets: `
            CREATE TABLE tickets (
                id          TEXT PRIMARY KEY,
                board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status      TEXT NOT NULL DEFAULT 'todo'
                            CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
                priority    TEXT NOT NULL DEFAULT 'p2',
                ticket_type TEXT NOT NULL DEFAULT 'feature',
                position    REAL NOT NULL DEFAULT 0,
                due_date    TEXT,
                start_date  TEXT,
                labels      TEXT NOT NULL DEFAULT '[]',
                comments    TEXT NOT NULL DEFAULT '[]',
                push_info   TEXT NOT NULL DEFAULT '[]',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
        `,
    };
})();

/**
 * Replay migrate_v21 the way it actually runs: probe the source table for
 * `push_info`, then rename → recreate → copy → drop → recreate indexes.
 */
function replayV21(sqlite) {
    const srcCols = sqlite.prepare('PRAGMA table_info(tickets)').all().map((c) => c.name);
    const pushInfoSource = srcCols.includes('push_info') ? 'push_info' : `'[]'`;
    const copy = MIGRATE_V21.copyTicketsRaw.replace('${pushInfoSource}', pushInfoSource);

    sqlite.exec('PRAGMA foreign_keys = OFF;');
    sqlite.exec('ALTER TABLE tickets RENAME TO tickets_v20;');
    sqlite.exec(MIGRATE_V21.createTickets);
    sqlite.exec(copy);
    sqlite.exec('DROP TABLE tickets_v20;');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id);');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);');
    sqlite.exec('PRAGMA foreign_keys = ON;');
}

function withBoardsTable() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE boards (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            tabs_config TEXT NOT NULL DEFAULT '["kanban"]',
            columns_config TEXT NOT NULL DEFAULT '',
            archived_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    `);
    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO boards (id, name, created_at, updated_at) VALUES ('BRD-1', 'Board', ?, ?)`,
        )
        .run(now, now);
    return { sqlite, now };
}

test('the v20 tickets table rejects a custom status, and v21 accepts it', () => {
    const { sqlite, now } = withBoardsTable();
    sqlite.exec(MIGRATE_V21.legacyTickets);

    const insert = (status) =>
        sqlite
            .prepare(
                `INSERT INTO tickets (id, board_id, title, status, created_at, updated_at)
                 VALUES (?, 'BRD-1', 'T', ?, ?, ?)`,
            )
            .run(`TKT-${status}`, status, now, now);

    // This is the failure a custom column used to hit.
    assert.throws(() => insert('CST-ABCDEF'), /CHECK constraint failed/);
    insert('todo'); // built-in stages still work

    replayV21(sqlite);

    // The custom stage is now storable, and existing rows survived.
    insert('CST-ABCDEF');
    const statuses = sqlite
        .prepare('SELECT status FROM tickets ORDER BY status')
        .all()
        .map((r) => r.status);
    assert.deepEqual(statuses, ['CST-ABCDEF', 'todo']);
});

test('the v21 rebuild keeps every ticket field, including push_info', () => {
    const { sqlite, now } = withBoardsTable();
    sqlite.exec(MIGRATE_V21.legacyTickets);

    sqlite
        .prepare(
            `INSERT INTO tickets (id, board_id, title, description, status, priority, ticket_type,
                                  position, due_date, start_date, labels, comments, push_info,
                                  created_at, updated_at)
             VALUES ('TKT-1', 'BRD-1', 'Title', 'Body', 'in_progress', 'p1', 'bug',
                     42.5, '2026-01-02', '2026-01-01', '["a"]', '[{"author":"me"}]', '[{"status":"success"}]',
                     ?, ?)`,
        )
        .run(now, now);

    replayV21(sqlite);

    const row = sqlite.prepare('SELECT * FROM tickets WHERE id = ?').get('TKT-1');
    assert.equal(row.title, 'Title');
    assert.equal(row.description, 'Body');
    assert.equal(row.status, 'in_progress');
    assert.equal(row.priority, 'p1');
    assert.equal(row.ticket_type, 'bug');
    assert.equal(row.position, 42.5);
    assert.equal(row.due_date, '2026-01-02');
    assert.equal(row.start_date, '2026-01-01');
    assert.equal(row.labels, '["a"]');
    assert.equal(row.comments, '[{"author":"me"}]');
    assert.equal(row.push_info, '[{"status":"success"}]', 'push badges survive');
    assert.equal(row.created_at, now);

    // The indexes the migration recreates must exist again.
    const indexes = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tickets'`)
        .all()
        .map((r) => r.name);
    for (const name of ['idx_tickets_board_id', 'idx_tickets_status', 'idx_tickets_priority']) {
        assert.ok(indexes.includes(name), `${name} recreated`);
    }
});

test('the rebuild copes with a table that predates push_info', () => {
    const { sqlite, now } = withBoardsTable();
    sqlite.exec(MIGRATE_V21.legacyTickets.replace(
        "push_info   TEXT NOT NULL DEFAULT '[]',\n",
        '',
    ));
    sqlite
        .prepare(
            `INSERT INTO tickets (id, board_id, title, status, created_at, updated_at)
             VALUES ('TKT-OLD', 'BRD-1', 'Old', 'todo', ?, ?)`,
        )
        .run(now, now);

    replayV21(sqlite);

    const row = sqlite.prepare('SELECT * FROM tickets WHERE id = ?').get('TKT-OLD');
    assert.equal(row.title, 'Old');
    assert.equal(row.push_info, '[]', 'the column is created with its default');
});

test('the rebuild leaves push_records dangling, and ensurePushSchema repairs it', async () => {
    // Renaming `tickets` makes SQLite repoint push_records' REFERENCES at the
    // temporary table, which is then dropped. This pins the interaction the
    // migration comment relies on: ensurePushSchema runs right after and heals
    // it, so push records keep cascading.
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(CREATE_TABLES);

    const now = new Date().toISOString();
    sqlite
        .prepare(`INSERT INTO boards (id, name, created_at, updated_at) VALUES ('BRD-1', 'B', ?, ?)`)
        .run(now, now);
    sqlite
        .prepare(
            `INSERT INTO tickets (id, board_id, title, created_at, updated_at)
             VALUES ('TKT-1', 'BRD-1', 'T', ?, ?)`,
        )
        .run(now, now);
    sqlite
        .prepare(
            `INSERT INTO push_targets (id, name, endpoint_url, created_at, updated_at)
             VALUES ('PT-1', 'Target', 'http://localhost', ?, ?)`,
        )
        .run(now, now);
    sqlite
        .prepare(
            `INSERT INTO push_records (id, ticket_id, board_id, target_id, status, request_url, created_at, updated_at)
             VALUES ('PR-1', 'TKT-1', 'BRD-1', 'PT-1', 'pending', 'http://localhost', ?, ?)`,
        )
        .run(now, now);

    replayV21(sqlite);

    const references = () =>
        sqlite
            .prepare(`PRAGMA foreign_key_list(push_records)`)
            .all()
            .map((fk) => fk.table);
    assert.ok(
        references().includes('tickets_v20'),
        'the rebuild is expected to leave a dangling reference',
    );

    await ensurePushSchema(pluginLike(sqlite));

    assert.ok(references().includes('tickets'), 'the reference points at tickets again');
    assert.ok(!references().includes('tickets_v20'), 'no dangling reference remains');

    // And the repaired table still cascades.
    const db = pluginLike(sqlite);
    await db.execute(`DELETE FROM boards WHERE id = ?`, ['BRD-1']);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM push_records').get().n, 0);
});


// ── Column width planning ──────────────────────────────────────────────────

test('an unplanned board splits its width evenly', () => {
    const shares = computeShares(defaultColumns(ORDER));

    assert.equal(shares.length, ORDER.length);
    assert.ok(shares.every((s) => s.counts), 'all four take part');
    assert.ok(shares.every((s) => s.weight === 1), 'unplanned means weight 1');
    assert.ok(shares.every((s) => s.percent === 25));
    assert.equal(
        Math.round(shares.reduce((sum, s) => sum + s.percent, 0)),
        100,
    );
});

test('planned weights are honoured proportionally', () => {
    let columns = defaultColumns(ORDER);
    columns = setWidthShare(columns, 'backlog', 1);
    columns = setWidthShare(columns, 'todo', 2);
    columns = setWidthShare(columns, 'in_progress', 3);
    columns = setWidthShare(columns, 'done', 2);
    // Total = 8 → 12.5 / 25 / 37.5 / 25

    const shares = computeShares(columns);
    const percent = (status) => shares.find((s) => s.status === status).percent;

    assert.equal(percent('backlog'), 12.5);
    assert.equal(percent('todo'), 25);
    assert.equal(percent('in_progress'), 37.5);
    assert.equal(percent('done'), 25);
    assert.equal(
        shares.reduce((sum, s) => sum + s.percent, 0),
        100,
        'shares always total 100',
    );
});

test('hidden and collapsed columns stay listed but take no share', () => {
    let columns = defaultColumns(ORDER);
    columns = patchColumn(columns, 'backlog', { hidden: true });
    columns = patchColumn(columns, 'done', { collapsed: true });

    const shares = computeShares(columns);
    const find = (status) => shares.find((s) => s.status === status);

    assert.equal(shares.length, ORDER.length, 'every column is still listed');
    assert.equal(find('backlog').counts, false);
    assert.equal(find('backlog').percent, 0);
    assert.equal(find('done').counts, false, 'a collapsed rail is not a share');
    assert.equal(find('done').percent, 0);

    // Only the two expanded, visible columns share the width.
    assert.equal(find('todo').percent, 50);
    assert.equal(find('in_progress').percent, 50);
});

test('with nothing laid out the shares are all zero, not NaN', () => {
    let columns = defaultColumns(ORDER);
    for (const status of ORDER) {
        columns = patchColumn(columns, status, { hidden: true });
    }
    const shares = computeShares(columns);
    assert.ok(shares.every((s) => Number.isFinite(s.percent) && s.percent === 0));
});

test('weights are clamped into the allowed range', () => {
    assert.equal(clampShare(0), 0.25, 'below the slider minimum, so it clamps up');
    assert.equal(clampShare(Number.NaN), 1, 'a non-finite weight falls back to 1');
    assert.equal(clampShare(0.001), 0.25, 'never thinner than the minimum');
    assert.equal(clampShare(999), MAX_WIDTH_SHARE, 'never wider than the maximum');
    assert.equal(clampShare(2), 2);

    const columns = setWidthShare(defaultColumns(ORDER), 'todo', 0.001);
    assert.equal(columnWeight(findColumn(columns, 'todo')), 0.25);
});

test('invalid stored weights are treated as unplanned', () => {
    const raw = JSON.stringify([
        { status: 'backlog', widthShare: 0 },
        { status: 'todo', widthShare: -3 },
        { status: 'in_progress', widthShare: 'lots' },
        { status: 'done', widthShare: 2 },
    ]);

    const columns = parseBoardColumns(raw, ORDER);
    assert.equal(findColumn(columns, 'backlog').widthShare, null);
    assert.equal(findColumn(columns, 'todo').widthShare, null);
    assert.equal(findColumn(columns, 'in_progress').widthShare, null);
    assert.equal(findColumn(columns, 'done').widthShare, 2);
    assert.equal(columnWeight(findColumn(columns, 'backlog')), 1, 'defaults to 1');
});

test('a width plan is reset, and never stored in the synced config', () => {
    let columns = setWidthShare(defaultColumns(ORDER), 'in_progress', 3);

    // The plan is view state: it round-trips through `extractViewState` /
    // `applyViewState`, not through the synced `columns_config` string.
    const viewState = extractViewState(columns);
    assert.deepEqual(viewState, { in_progress: { widthShare: 3 } });

    const stored = parseBoardColumns(serializeBoardColumns(columns), ORDER);
    assert.ok(
        stored.every((c) => c.widthShare === null),
        'the stored config is unplanned even when the board is not',
    );
    assert.deepEqual(
        applyViewState(stored, viewState),
        columns,
        'domain storage plus local view state reconstructs the board',
    );

    columns = resetWidthShares(columns);
    assert.ok(columns.every((c) => c.widthShare === null));
    assert.ok(computeShares(columns).every((s) => s.percent === 25));

    // Resetting an already-unplanned board returns the same array (no write).
    assert.equal(resetWidthShares(columns), columns);
});

test('a new custom column joins the width split unplanned', () => {
    let columns = setWidthShare(defaultColumns(ORDER), 'todo', 3);
    columns = addCustomColumn(columns, '评审', ['teal']);

    const custom = columns[columns.length - 1];
    assert.equal(custom.widthShare, null);

    // 5 columns: todo carries 3, the rest carry 1 each → 3/7.
    const shares = computeShares(columns);
    const todo = shares.find((s) => s.status === 'todo');
    assert.equal(Math.round(todo.percent), 43);
    assert.equal(Math.round(shares.reduce((sum, s) => sum + s.percent, 0)), 100);
});

// ── Column layout invariant ────────────────────────────────────────────────
// The planned width shares were silently dead once before: `flex-basis: 0`
// hands the whole row's spare space out in the ratios of `--column-grow`, but
// a `min-width` floor that is large relative to the board area pins *every*
// column, leaving the weights with nothing to distribute.
//
// This pins the two halves of that contract in the stylesheet itself.

const COLUMN_STYLES = readFileSync(
    join(here, '..', 'src', 'lib', 'components', 'app', 'kanban', 'kanban-column.svelte'),
    'utf8',
);

/** The `.kanban-column` rule body (not the `--collapsed` modifier). */
const BASE_COLUMN_RULE = (() => {
    const match = COLUMN_STYLES.match(/\n {4}\.kanban-column \{([\s\S]*?)\n {4}\}/);
    assert.ok(match, 'could not locate the .kanban-column rule');
    return match[1];
})();

test('the board width is distributed by the planned weights', () => {
    const flex = BASE_COLUMN_RULE.match(/flex:\s*([^;]+);/);
    assert.ok(flex, 'the column declares no flex shorthand');

    // `var(--column-grow, 1)` contains a space, so split on the shorthand's
    // three components rather than on whitespace alone.
    const parsed = flex[1].trim().match(/^(var\([^)]*\)|\S+)\s+(\S+)\s+(\S+)$/);
    assert.ok(parsed, `could not parse the flex shorthand: ${flex[1]}`);
    const [, grow, shrink, basis] = parsed;
    assert.match(
        grow,
        /^var\(--column-grow/,
        'the grow factor must come from the planned weight',
    );
    assert.equal(shrink, '1');
    assert.equal(basis, '0', 'a zero basis frees the whole row for the ratios');
});

test('the minimum column width cannot pin every column at once', () => {
    const minWidth = BASE_COLUMN_RULE.match(/min-width:\s*([\d.]+)rem;/);
    assert.ok(minWidth, 'the column declares no rem min-width');
    const floor = Number(minWidth[1]);

    // A conservative laptop board area: 1200px, minus the row padding and the
    // gaps between eight columns. If the floor can pin all eight, the width
    // plan is invisible again — which is exactly the bug this guards.
    const GAP_REM = 1;
    const PADDING_PX = 32;
    const columns = 8;
    const available = 1200 - PADDING_PX - (columns - 1) * GAP_REM * 16;
    assert.ok(
        floor * 16 * columns <= available,
        `a ${floor}rem floor pins ${columns} columns (${floor * 16 * columns}px > ${available}px), ` +
            'so the planned shares could not take effect',
    );
});

test('the board hands each column its planned weight', () => {
    const board = readFileSync(
        join(here, '..', 'src', 'lib', 'components', 'app', 'kanban', 'kanban-board.svelte'),
        'utf8',
    );
    assert.match(board, /columnWeight\(config\)/, 'the weight is never read from the config');
    assert.match(board, /grow=\{col\.collapsed \? 0 : col\.grow\}/, 'the weight is not passed down');
});
