/**
 * Tests for catalog portability: a snapshot must carry the definitions that its
 * tickets' ids refer to.
 *
 * The bug these pin: a ticket stores its type, priority and tags by id, but the
 * export/sync snapshot used to carry only boards and tickets. A teammate who
 * pulled, or a machine that restored an export, resolved those ids to nothing and
 * showed raw ids like `TY-ABC123` where the author saw "Payment refactor".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { CREATE_TABLES, SCHEMA_VERSION } from '../src/lib/db/schema.ts';
import { importSnapshot } from '../src/lib/db/mappers/import.ts';
import {
    EXPORT_VERSION,
    emptyCatalogSnapshot,
} from '../src/lib/db/mappers/types.ts';
import {
    parseSnapshotFromFolder,
    parseSnapshotFromSingleJson,
} from '../src/lib/db/mappers/deserialize-json.ts';
import { snapshotToFolderJsonFiles } from '../src/lib/db/mappers/serialize-json.ts';
import { snapshotToFolderCsvFiles } from '../src/lib/db/mappers/serialize-csv.ts';

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

function workspace() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(CREATE_TABLES);
    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO workspace_meta (id, name, schema_version, created_at) VALUES (1, 'ws', ?, ?)`,
        )
        .run(SCHEMA_VERSION, now);
    return sqlite;
}

const snapshot = (patch = {}) => ({
    export_version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    workspace_meta: { name: 'ws', schema_version: SCHEMA_VERSION, sync_mode: 'local' },
    boards: [],
    catalogs: {
        types: [
            { id: 'TY-ABC123', name: 'Payment refactor', color: '#8a3ffc', icon: 'upgrade', is_default: true },
        ],
        priorities: [
            { id: 'PR-XYZ789', name: 'Urgent', color: '#da1e28', rank: 10, is_default: true },
        ],
        tags: [{ id: 'uuid-from-author', name: 'billing', color: 'teal' }],
    },
    ...patch,
});

test('the export version that added catalogs is 2', () => {
    assert.equal(EXPORT_VERSION, 2);
});

test('a folder export writes catalogs.json, in JSON and CSV mode alike', () => {
    for (const files of [
        snapshotToFolderJsonFiles(snapshot()),
        snapshotToFolderCsvFiles(snapshot()),
    ]) {
        const raw = files.get('catalogs.json');
        assert.ok(raw, 'catalogs.json must be written');
        assert.equal(JSON.parse(raw).types[0].id, 'TY-ABC123');
    }
});

test('a folder export round-trips its catalogs', () => {
    const files = snapshotToFolderJsonFiles(snapshot());
    const parsed = parseSnapshotFromFolder(files);

    assert.equal(parsed.catalogs.types.length, 1);
    assert.equal(parsed.catalogs.types[0].name, 'Payment refactor');
    assert.equal(parsed.catalogs.priorities[0].rank, 10);
    assert.equal(parsed.catalogs.tags[0].name, 'billing');
});

test('a single-file export round-trips its catalogs', () => {
    const parsed = parseSnapshotFromSingleJson(JSON.stringify(snapshot()));

    assert.equal(parsed.catalogs.types[0].id, 'TY-ABC123');
    assert.equal(parsed.catalogs.tags[0].color, 'teal');
});

test('a version 1 file still imports, with empty catalogs', () => {
    // A file from before this fix: no `catalogs` key at all.
    const parsed = parseSnapshotFromSingleJson(
        JSON.stringify({
            export_version: 1,
            exported_at: new Date().toISOString(),
            workspace_meta: null,
            boards: [],
        }),
    );

    assert.deepEqual(parsed.catalogs, emptyCatalogSnapshot());
});

test('unusable catalog entries are dropped rather than imported', () => {
    const parsed = parseSnapshotFromSingleJson(
        JSON.stringify(
            snapshot({
                catalogs: {
                    types: [{ id: 'TY-1', name: '' }, { id: '', name: 'No id' }, 'nope', null],
                    priorities: [{ id: 'PR-1', name: 'P', rank: 'later' }],
                    tags: [],
                },
            }),
        ),
    );

    assert.deepEqual(parsed.catalogs.types, []);
    assert.equal(parsed.catalogs.priorities.length, 1);
    assert.equal(
        parsed.catalogs.priorities[0].rank,
        0,
        'an unusable rank becomes a number rather than poisoning the ordering',
    );
});

test('importing creates catalog rows the tickets resolve against', async () => {
    const sqlite = workspace();
    const db = pluginLike(sqlite);

    const result = await importSnapshot(db, snapshot(), 'merge');

    assert.equal(result.catalogRowsCreated, 3);
    assert.equal(result.catalogRowsUpdated, 0);

    const type = sqlite.prepare('SELECT * FROM ticket_types WHERE id = ?').get('TY-ABC123');
    assert.equal(type.name, 'Payment refactor');
    assert.equal(type.is_default, 1);

    const priority = sqlite
        .prepare('SELECT * FROM ticket_priorities WHERE id = ?')
        .get('PR-XYZ789');
    assert.equal(priority.name, 'Urgent');

    const tag = sqlite.prepare('SELECT * FROM tags WHERE name = ?').get('billing');
    assert.equal(tag.color, 'teal');
});

test('importing again updates in place instead of duplicating', async () => {
    const sqlite = workspace();
    const db = pluginLike(sqlite);

    await importSnapshot(db, snapshot(), 'merge');
    const renamed = snapshot({
        catalogs: {
            types: [
                { id: 'TY-ABC123', name: 'Payments', color: '#0f62fe', icon: null, is_default: true },
            ],
            priorities: [
                { id: 'PR-XYZ789', name: 'Urgent', color: '#da1e28', rank: 5, is_default: true },
            ],
            tags: [{ id: 'different-uuid', name: 'billing', color: 'purple' }],
        },
    });
    const result = await importSnapshot(db, renamed, 'merge');

    assert.equal(result.catalogRowsCreated, 0, 'nothing new was introduced');
    assert.equal(result.catalogRowsUpdated, 3);

    const count = sqlite.prepare('SELECT COUNT(*) AS n FROM ticket_types').get();
    assert.equal(count.n, 1);
    assert.equal(
        sqlite.prepare('SELECT name FROM ticket_types WHERE id = ?').get('TY-ABC123').name,
        'Payments',
    );

    const tags = sqlite.prepare('SELECT * FROM tags').all();
    assert.equal(
        tags.length,
        1,
        'tags are matched by name, so the author\'s random id does not add a twin',
    );
    assert.equal(tags[0].color, 'purple');
});

test('an import never deletes catalog rows this workspace already had', async () => {
    const sqlite = workspace();
    const db = pluginLike(sqlite);
    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO ticket_types (id, name, color, icon, is_default, created_at, updated_at)
             VALUES ('TY-LOCAL', 'Only here', '#525252', NULL, 0, ?, ?)`,
        )
        .run(now, now);

    await importSnapshot(db, snapshot(), 'merge');

    const local = sqlite.prepare('SELECT name FROM ticket_types WHERE id = ?').get('TY-LOCAL');
    assert.equal(
        local?.name,
        'Only here',
        'a row the file does not mention must survive — a ticket may point at it',
    );
});

test('an imported default replaces the existing one rather than joining it', async () => {
    const sqlite = workspace();
    const db = pluginLike(sqlite);
    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO ticket_types (id, name, color, icon, is_default, created_at, updated_at)
             VALUES ('TY-OLD', 'Old default', '#525252', NULL, 1, ?, ?)`,
        )
        .run(now, now);

    await importSnapshot(db, snapshot(), 'merge');

    const defaults = sqlite
        .prepare('SELECT id FROM ticket_types WHERE is_default = 1')
        .all()
        .map((row) => row.id);
    assert.deepEqual(
        defaults,
        ['TY-ABC123'],
        'two defaults would make "the type a new ticket starts at" depend on row order',
    );
});
