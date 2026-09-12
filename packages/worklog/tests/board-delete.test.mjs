/**
 * Regression tests for the board-delete blocker.
 *
 * The `tickets` table-recreation migrations (v4, v5, v8, v12) rename `tickets`
 * out of the way and drop the temporary table. SQLite rewrites `REFERENCES`
 * clauses in *other* tables when a table is renamed, so `push_records` was left
 * pointing at a table that no longer existed. SQLite resolves a table's foreign
 * keys on every write to it, so `DELETE FROM boards` then failed with
 * `no such table: main.tickets_v11` — deleting a board (active or archived) was
 * impossible, and the failure was swallowed by the UI.
 *
 * `ensurePushSchema` rebuilds `push_records` to shed the dangling reference.
 * These tests pin both the failure and the repair.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DatabaseSync } from 'node:sqlite';

import { CREATE_TABLES } from '../src/lib/db/schema.ts';
import { ensurePushSchema } from '../src/lib/db/ensure-push-schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

/** The `tickets` DDL as migrate_v12 recreates it, read straight from source. */
const MIGRATE_V12_TICKETS = (() => {
    const source = readFileSync(join(srcDir, 'lib/db/migrate.ts'), 'utf8');
    const fn = source.slice(source.indexOf('async function migrate_v12'));
    const ddl = fn.match(/CREATE TABLE tickets \(([\s\S]*?)\n\s*\)\n/);
    assert.ok(ddl, 'could not locate the migrate_v12 tickets DDL');
    return `CREATE TABLE tickets (${ddl[1]}\n)`;
})();

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

function openWorkspace({ corrupt = false, withPushRecord = false } = {}) {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(CREATE_TABLES);

    if (corrupt) {
        // Replay migrate_v12 exactly: rename, recreate, drop the temporary.
        sqlite.exec('PRAGMA foreign_keys = OFF;');
        sqlite.exec('ALTER TABLE tickets RENAME TO tickets_v11;');
        sqlite.exec(MIGRATE_V12_TICKETS);
        sqlite.exec('DROP TABLE tickets_v11;');
        sqlite.exec('PRAGMA foreign_keys = ON;');
    }

    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO boards (id, name, description, tabs_config, archived_at, created_at, updated_at)
             VALUES (?, ?, '', '["kanban"]', ?, ?, ?)`,
        )
        .run('BRD-1', 'Board', null, now, now);
    sqlite
        .prepare(
            `INSERT INTO tickets (id, board_id, title, description, status, priority, ticket_type, position,
                                  due_date, start_date, labels, comments, created_at, updated_at)
             VALUES ('TCK-1', 'BRD-1', 'Ticket', '', 'todo', 'p2', 'feature', 0, NULL, NULL, '[]', '[]', ?, ?)`,
        )
        .run(now, now);

    if (withPushRecord) {
        sqlite
            .prepare(
                `INSERT INTO push_targets (id, name, endpoint_url, created_at, updated_at)
                 VALUES ('PT-1', 'Target', 'http://localhost', ?, ?)`,
            )
            .run(now, now);
        sqlite
            .prepare(
                `INSERT INTO push_records (id, ticket_id, board_id, target_id, status, request_url,
                                           variables_snapshot, created_at, updated_at)
                 VALUES ('PR-1', 'TCK-1', 'BRD-1', 'PT-1', 'pending', 'http://localhost', '[]', ?, ?)`,
            )
            .run(now, now);
    }

    return { sqlite, db: pluginLike(sqlite) };
}

function foreignKeyTargets(sqlite, table) {
    return sqlite
        .prepare(`PRAGMA foreign_key_list(${table})`)
        .all()
        .map((row) => row.table);
}

function count(sqlite, table) {
    return sqlite.prepare(`SELECT count(*) AS c FROM ${table}`).get().c;
}

test('a stale ticket reference makes deleting a board fail', () => {
    const { sqlite } = openWorkspace({ corrupt: true });

    assert.ok(
        foreignKeyTargets(sqlite, 'push_records').includes('tickets_v11'),
        'fixture should reproduce the dangling reference',
    );
    assert.throws(
        () => sqlite.exec(`DELETE FROM boards WHERE id = 'BRD-1'`),
        /no such table: main\.tickets_v11/,
    );
});

test('ensurePushSchema repairs the reference and cascades the delete', async () => {
    const { sqlite, db } = openWorkspace({ corrupt: true });

    await ensurePushSchema(db);

    assert.deepEqual(
        foreignKeyTargets(sqlite, 'push_records').sort(),
        ['boards', 'push_targets', 'tickets'],
    );

    sqlite.exec(`DELETE FROM boards WHERE id = 'BRD-1'`);

    assert.equal(count(sqlite, 'boards'), 0);
    assert.equal(count(sqlite, 'tickets'), 0, 'tickets should cascade');
});

test('archived boards are deletable once repaired', async () => {
    const { sqlite, db } = openWorkspace({ corrupt: true });
    await ensurePushSchema(db);

    const archivedAt = new Date().toISOString();
    sqlite
        .prepare(`UPDATE boards SET archived_at = ? WHERE id = 'BRD-1'`)
        .run(archivedAt);

    sqlite.exec(`DELETE FROM boards WHERE id = 'BRD-1'`);

    assert.equal(count(sqlite, 'boards'), 0);
    assert.equal(count(sqlite, 'tickets'), 0);
});

test('repair keeps existing push records and their indexes', async () => {
    const { sqlite, db } = openWorkspace({ withPushRecord: true });

    await ensurePushSchema(db);

    assert.equal(count(sqlite, 'push_records'), 1, 'rows must survive the rebuild');
    const indexes = sqlite
        .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'push_records'`,
        )
        .all()
        .map((row) => row.name);
    for (const name of [
        'idx_push_records_ticket',
        'idx_push_records_board',
        'idx_push_records_target',
        'idx_push_records_status',
    ]) {
        assert.ok(indexes.includes(name), `${name} should be recreated`);
    }

    sqlite.exec(`DELETE FROM boards WHERE id = 'BRD-1'`);
    assert.equal(
        count(sqlite, 'push_records'),
        0,
        'push records should cascade with the board',
    );
});

test('a healthy workspace is left untouched', async () => {
    const { sqlite, db } = openWorkspace({ withPushRecord: true });
    const before = sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'push_records'`)
        .get().sql;

    await ensurePushSchema(db);

    const after = sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'push_records'`)
        .get().sql;
    assert.equal(after, before, 'no rebuild should happen on a healthy schema');
    assert.equal(count(sqlite, 'push_records'), 1);

    sqlite.exec(`DELETE FROM boards WHERE id = 'BRD-1'`);
    assert.equal(count(sqlite, 'boards'), 0);
    assert.equal(count(sqlite, 'tickets'), 0);
});
