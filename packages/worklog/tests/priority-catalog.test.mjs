/**
 * Regression tests for the priority-catalog migration (v22).
 *
 * `tickets.priority` used to be pinned to ('p1','p2','p3') by a CHECK
 * constraint, which made a user-defined priority level impossible to store.
 * Migration v22 rebuilds the table to drop it and adds the two catalog tables
 * (`ticket_priorities`, `tags`).
 *
 * The rebuild is the risky part: it renames `tickets` out of the way, which
 * makes SQLite rewrite `push_records`'s REFERENCES clause to the temporary
 * name. These tests pin that rows survive the rebuild, that the constraint is
 * really gone, and that the dangling reference is repaired afterwards.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DatabaseSync } from 'node:sqlite';

import { CREATE_TABLES, SCHEMA_VERSION } from '../src/lib/db/schema.ts';
import { runMigrations } from '../src/lib/db/migrate.ts';
import { ensurePushSchema } from '../src/lib/db/ensure-push-schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

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

/**
 * A workspace frozen at the shape v21 left behind: `tickets` still carries the
 * priority CHECK constraint, and `push_records` references the live table.
 */
function openV21Workspace() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(CREATE_TABLES);

    // Re-create `tickets` the way migrate_v21 did, constraint included.
    //
    // `push_records` is dropped first and recreated afterwards: renaming
    // `tickets` makes SQLite repoint its REFERENCES clause at the temporary
    // name, which would leave the fixture itself broken before the migration
    // under test ever runs.
    sqlite.exec('DROP TABLE push_records;');
    sqlite.exec('PRAGMA foreign_keys = OFF;');
    sqlite.exec('ALTER TABLE tickets RENAME TO tickets_current;');
    sqlite.exec(`
        CREATE TABLE tickets (
            id          TEXT PRIMARY KEY,
            board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            title       TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'todo',
            priority    TEXT NOT NULL DEFAULT 'p2'
                        CHECK (priority IN ('p1', 'p2', 'p3')),
            ticket_type TEXT NOT NULL DEFAULT 'feature',
            position    REAL NOT NULL DEFAULT 0,
            due_date    TEXT,
            start_date  TEXT,
            labels      TEXT NOT NULL DEFAULT '[]',
            comments    TEXT NOT NULL DEFAULT '[]',
            push_info   TEXT NOT NULL DEFAULT '[]',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        )
    `);
    sqlite.exec('DROP TABLE tickets_current;');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(CREATE_TABLES);

    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO workspace_meta (id, name, schema_version, sync_mode, created_at)
             VALUES (1, 'Workspace', 21, 'local', ?)`,
        )
        .run(now);
    sqlite
        .prepare(
            `INSERT INTO boards (id, name, description, created_at, updated_at)
             VALUES ('BRD-1', 'Board', '', ?, ?)`,
        )
        .run(now, now);
    sqlite
        .prepare(
            `INSERT INTO tickets (
                id, board_id, title, description, status, priority, ticket_type,
                position, due_date, start_date, labels, comments, push_info,
                created_at, updated_at
             ) VALUES (?, 'BRD-1', ?, '', 'todo', ?, 'feature', 1, ?, ?, ?, '[]', '[]', ?, ?)`,
        )
        .run(
            'TCK-1',
            'Keep me',
            'p1',
            '2025-02-01',
            '2025-01-01',
            JSON.stringify(['backend']),
            now,
            now,
        );
    sqlite
        .prepare(
            `INSERT INTO push_targets (id, name, endpoint_url, created_at, updated_at)
             VALUES ('TGT-1', 'Target', 'https://example.com', ?, ?)`,
        )
        .run(now, now);
    sqlite
        .prepare(
            `INSERT INTO push_records (
                id, ticket_id, board_id, target_id, status, request_url,
                created_at, updated_at
             ) VALUES ('REC-1', 'TCK-1', 'BRD-1', 'TGT-1', 'success', 'https://example.com', ?, ?)`,
        )
        .run(now, now);

    return { sqlite, db: pluginLike(sqlite) };
}

test('migration v22 removes the priority CHECK constraint', async () => {
    const { sqlite, db } = openV21Workspace();

    await runMigrations(db);

    // A custom level is now storable — this is the whole point of the change.
    sqlite
        .prepare(
            `INSERT INTO tickets (
                id, board_id, title, description, status, priority, ticket_type,
                position, labels, comments, push_info, created_at, updated_at
             ) VALUES ('TCK-2', 'BRD-1', 'Custom level', '', 'todo', ?, 'feature', 2,
                       '[]', '[]', '[]', '2025-01-01T00:00', '2025-01-01T00:00')`,
        )
        .run('urgent-custom-id');

    const rows = sqlite
        .prepare(`SELECT id, priority FROM tickets ORDER BY id`)
        .all();
    assert.deepEqual(
        rows.map((row) => [row.id, row.priority]),
        [
            ['TCK-1', 'p1'],
            ['TCK-2', 'urgent-custom-id'],
        ],
    );
});

test('migration v22 preserves the ticket fields it carries over', async () => {
    const { sqlite, db } = openV21Workspace();

    await runMigrations(db);

    const ticket = sqlite
        .prepare(`SELECT * FROM tickets WHERE id = 'TCK-1'`)
        .get();

    assert.equal(ticket.title, 'Keep me');
    assert.equal(ticket.priority, 'p1');
    assert.equal(ticket.start_date, '2025-01-01');
    assert.equal(ticket.due_date, '2025-02-01');
    assert.deepEqual(JSON.parse(ticket.labels), ['backend']);
});

test('migration v22 creates the priority and tag catalogs', async () => {
    const { sqlite, db } = openV21Workspace();

    await runMigrations(db);

    const tables = sqlite
        .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('ticket_priorities', 'tags')`,
        )
        .all()
        .map((row) => row.name)
        .sort();
    assert.deepEqual(tables, ['tags', 'ticket_priorities']);

    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO ticket_priorities (id, name, color, rank, is_default, created_at, updated_at)
             VALUES ('urgent', 'Urgent', '#da1e28', 5, 0, ?, ?)`,
        )
        .run(now, now);
    sqlite
        .prepare(
            `INSERT INTO tags (id, name, color, created_at, updated_at)
             VALUES ('TAG-1', 'frontend', 'cool-gray', ?, ?)`,
        )
        .run(now, now);

    assert.equal(
        sqlite.prepare(`SELECT COUNT(*) AS count FROM ticket_priorities`).get()
            .count,
        1,
    );
    assert.equal(
        sqlite.prepare(`SELECT COUNT(*) AS count FROM tags`).get().count,
        1,
    );
});

test('migration v22 leaves no dangling reference behind', async () => {
    const { sqlite, db } = openV21Workspace();

    await runMigrations(db);
    // The rebuild renames `tickets`, which repoints push_records at the
    // temporary name; the guard that runs on every connection repairs it.
    await ensurePushSchema(db);

    const targets = sqlite
        .prepare(`PRAGMA foreign_key_list(push_records)`)
        .all()
        .map((row) => row.table);
    assert.ok(
        !targets.some((table) => table.startsWith('tickets_v')),
        `push_records still references a temporary table: ${targets.join(', ')}`,
    );

    // A cascade through the repaired reference must work.
    sqlite.prepare(`DELETE FROM boards WHERE id = 'BRD-1'`).run();
    assert.equal(
        sqlite.prepare(`SELECT COUNT(*) AS count FROM push_records`).get()
            .count,
        0,
    );
});

test('the authoritative schema version matches the migration chain', async () => {
    const source = readFileSync(join(srcDir, 'lib/db/migrate.ts'), 'utf8');
    assert.ok(
        source.includes(`if (current < ${SCHEMA_VERSION})`),
        `runMigrations does not apply migrate_v${SCHEMA_VERSION}`,
    );
});
