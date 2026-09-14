/**
 * Regression tests for SQLite error 275 (`SQLITE_CONSTRAINT_CHECK`) when filing
 * a ticket with a custom priority.
 *
 * The failure in the wild: create a new priority level in the ticket dialog, save
 * the ticket, and the save fails. The cause is not the priority — it is the
 * `tickets` table. Migration v21 rebuilt it to drop the `status` CHECK and its
 * template added back `CHECK (priority IN ('p1','p2','p3'))`; v22 is what removes
 * that, but `runMigrations` returns early when a workspace's stamped version is
 * already current. Such a workspace is stranded on v21's table, and no migration
 * will ever revisit it — which is why `ensureTicketSchema` exists.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { ensureTicketSchema } from '../src/lib/db/ensure-ticket-schema.ts';
import { ensurePushSchema } from '../src/lib/db/ensure-push-schema.ts';
import { ensureCatalogSchema } from '../src/lib/db/ensure-catalog-schema.ts';
import { CREATE_TABLES } from '../src/lib/db/schema.ts';

function pluginLike(sqlite) {
    return {
        select: async (sql, params) => sqlite.prepare(sql).all(...(params ?? [])),
        execute: async (sql, params) =>
            params?.length
                ? sqlite.prepare(sql).run(...params)
                : sqlite.exec(sql),
    };
}

/** Exactly the table migration v21 leaves behind. */
function strandedWorkspace() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE workspace_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            sync_mode TEXT NOT NULL DEFAULT 'local',
            catalog_set_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
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
        );
    `);

    const now = new Date().toISOString();
    // Notably stamped at the *current* version: this is the stranded case.
    sqlite
        .prepare(
            `INSERT INTO workspace_meta (id, name, schema_version, created_at) VALUES (1, 'ws', 24, ?)`,
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
            `INSERT INTO tickets (id, board_id, title, description, status, priority, ticket_type, position, labels, comments, push_info, created_at, updated_at)
             VALUES ('TKT-1', 'BRD-1', 'Existing work', 'notes', 'in_progress', 'p1', 'bug', 1000, '["backend"]', '[]', '[]', ?, ?)`,
        )
        .run(now, now);

    return sqlite;
}

function insertTicket(sqlite, priority) {
    sqlite
        .prepare(
            `INSERT INTO tickets (id, board_id, title, description, status, priority, ticket_type, position, labels, comments, push_info, created_at, updated_at)
             VALUES (?, 'BRD-1', 'New', '', 'todo', ?, 'feature', 2000, '[]', '[]', '[]', ?, ?)`,
        )
        .run(`TKT-${priority}`, priority, new Date().toISOString(), new Date().toISOString());
}

test('a custom priority is rejected by the stranded table — the reported 275', () => {
    const sqlite = strandedWorkspace();

    let failure = null;
    try {
        insertTicket(sqlite, 'PR-CUSTOM1');
    } catch (error) {
        failure = error;
    }

    assert.ok(failure, 'the insert must fail before the repair, or this test proves nothing');
    assert.match(
        String(failure.message),
        /CHECK constraint/i,
        'this is the constraint the user hit',
    );
    assert.equal(
        failure.errcode,
        275,
        'SQLITE_CONSTRAINT_CHECK — the code reported as "error returned from database:code:275"',
    );
});

test('the repair removes the stale CHECK and keeps the existing tickets', async () => {
    const sqlite = strandedWorkspace();
    const db = pluginLike(sqlite);

    const before = sqlite.prepare('SELECT COUNT(*) AS n FROM tickets').get();
    assert.equal(before.n, 1);

    await ensureTicketSchema(db);

    const ddl = sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tickets'`)
        .get().sql;
    assert.ok(
        !ddl.includes('CHECK (priority IN'),
        'the priority CHECK must be gone',
    );
    assert.ok(
        !ddl.includes('CHECK (status IN'),
        'and the status CHECK must not come back either',
    );

    const kept = sqlite.prepare('SELECT * FROM tickets WHERE id = ?').get('TKT-1');
    assert.equal(kept.title, 'Existing work');
    assert.equal(kept.description, 'notes');
    assert.equal(kept.priority, 'p1', 'existing values are preserved');
    assert.equal(kept.status, 'in_progress');
    assert.equal(kept.ticket_type, 'bug');
    assert.equal(kept.labels, '["backend"]');
    assert.equal(kept.position, 1000);

    const after = sqlite.prepare('SELECT COUNT(*) AS n FROM tickets').get();
    assert.equal(after.n, 1, 'nothing was duplicated or dropped');

    // The whole point: the same insert now works.
    insertTicket(sqlite, 'PR-CUSTOM1');
    const custom = sqlite.prepare('SELECT priority FROM tickets WHERE id = ?').get('TKT-PR-CUSTOM1');
    assert.equal(custom.priority, 'PR-CUSTOM1');
});

test('the repair recreates the indexes it had to drop', async () => {
    const sqlite = strandedWorkspace();
    await ensureTicketSchema(pluginLike(sqlite));

    const indexes = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tickets'`)
        .all()
        .map((row) => row.name);

    for (const expected of [
        'idx_tickets_board_id',
        'idx_tickets_status',
        'idx_tickets_priority',
        'idx_tickets_ticket_type',
        'idx_tickets_due_date',
    ]) {
        assert.ok(indexes.includes(expected), `${expected} must exist`);
    }
});

test('the repair is idempotent', async () => {
    const sqlite = strandedWorkspace();
    const db = pluginLike(sqlite);

    await ensureTicketSchema(db);
    const afterFirst = sqlite.prepare('SELECT COUNT(*) AS n FROM tickets').get().n;

    await ensureTicketSchema(db);
    await ensureTicketSchema(db);

    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, afterFirst);
});

test('a healthy workspace is left completely alone', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(CREATE_TABLES);
    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO workspace_meta (id, name, schema_version, created_at) VALUES (1, 'ws', 24, ?)`,
        )
        .run(now);
    sqlite
        .prepare(
            `INSERT INTO boards (id, name, description, created_at, updated_at)
             VALUES ('BRD-1', 'Board', '', ?, ?)`,
        )
        .run(now, now);
    insertTicket(sqlite, 'PR-ANY');

    const before = sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tickets'`)
        .get().sql;
    await ensureTicketSchema(pluginLike(sqlite));
    const after = sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tickets'`)
        .get().sql;

    assert.equal(after, before, 'no rebuild happens when there is nothing stale');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM tickets').get().n, 1);
});

test('the repair runs before ensurePushSchema, which restores the push reference', async () => {
    // The rebuild renames `tickets`, and SQLite rewrites every REFERENCES clause
    // pointing at it — so `push_records` ends up referencing a table that is
    // about to be dropped. That is why `ensurePushSchema` must run after this one,
    // and why a push record must survive the pair.
    const sqlite = strandedWorkspace();
    sqlite.exec(`
        CREATE TABLE push_targets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            endpoint_url TEXT NOT NULL,
            http_method TEXT NOT NULL DEFAULT 'POST',
            headers TEXT NOT NULL DEFAULT '{}',
            body_template TEXT NOT NULL DEFAULT '',
            body_content_type TEXT NOT NULL DEFAULT 'application/json',
            field_mapping TEXT NOT NULL DEFAULT '{}',
            payload_fields TEXT NOT NULL DEFAULT '[]',
            query_params TEXT NOT NULL DEFAULT '[]',
            variables TEXT NOT NULL DEFAULT '[]',
            source_config TEXT NOT NULL DEFAULT '',
            success_check TEXT NOT NULL DEFAULT '',
            timeout_ms INTEGER NOT NULL DEFAULT 30000,
            retry_count INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_push_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE push_records (
            id TEXT PRIMARY KEY,
            ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
            board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            target_id TEXT NOT NULL REFERENCES push_targets(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'success', 'failed')),
            request_url TEXT NOT NULL,
            request_body TEXT,
            variables_snapshot TEXT,
            response_status INTEGER,
            response_body TEXT,
            error_message TEXT,
            duration_ms INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    `);

    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO push_targets (id, name, endpoint_url, created_at, updated_at)
             VALUES ('PT-1', 'target', 'https://example.com', ?, ?)`,
        )
        .run(now, now);
    sqlite
        .prepare(
            `INSERT INTO push_records (id, ticket_id, board_id, target_id, request_url, created_at, updated_at)
             VALUES ('PR-1', 'TKT-1', 'BRD-1', 'PT-1', 'https://example.com', ?, ?)`,
        )
        .run(now, now);

    const db = pluginLike(sqlite);

    await ensureTicketSchema(db);
    await ensurePushSchema(db);

    const ddl = sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'push_records'`)
        .get().sql;
    assert.ok(
        /REFERENCES\s+"?tickets"?\s*\(/.test(ddl),
        'push_records must reference the real tickets table again',
    );
    assert.ok(
        !ddl.includes('tickets_stale'),
        'and never the temporary table the rebuild left behind',
    );

    // The cascade still works, which is what the reference is for.
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM push_records').get().n, 1);
    sqlite.prepare('DELETE FROM tickets WHERE id = ?').run('TKT-1');
    assert.equal(
        sqlite.prepare('SELECT COUNT(*) AS n FROM push_records').get().n,
        0,
        'deleting the ticket still cascades to its push records',
    );
});

// ── Retiring a catalog row (v25) ──────────────────────────────────────────

test('a workspace stamped as current but missing retired_at is repaired', async () => {
    // The same trap as the CHECK constraint: version stamped, migration chain
    // skipped, column missing. Applying a configuration would then fail outright.
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE ticket_types (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
            icon TEXT, is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE ticket_priorities (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#0f62fe',
            rank INTEGER NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE tags (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'cool-gray',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
    `);
    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO ticket_types (id, name, color, is_default, created_at, updated_at)
             VALUES ('TY-1', 'Bug', '#f00', 0, ?, ?)`,
        )
        .run(now, now);

    const db = pluginLike(sqlite);
    await ensureCatalogSchema(db);

    for (const table of ['ticket_types', 'ticket_priorities', 'tags']) {
        const columns = sqlite
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((row) => row.name);
        assert.ok(columns.includes('retired_at'), `${table}.retired_at must exist`);
    }

    const kept = sqlite.prepare('SELECT * FROM ticket_types WHERE id = ?').get('TY-1');
    assert.equal(kept.name, 'Bug', 'existing rows are untouched');
    assert.equal(kept.retired_at, null, 'and start out active');

    // Retiring and restoring are the two moves the reference page makes.
    sqlite.prepare(`UPDATE ticket_types SET retired_at = ? WHERE id = 'TY-1'`).run(now);
    assert.ok(sqlite.prepare('SELECT retired_at FROM ticket_types WHERE id = ?').get('TY-1').retired_at);
});

test('the catalog repair is idempotent and tolerant of missing tables', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const db = pluginLike(sqlite);

    // No tables at all: nothing to do, and no throw.
    await ensureCatalogSchema(db);

    sqlite.exec(`
        CREATE TABLE tags (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'x',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
    `);
    await ensureCatalogSchema(db);
    await ensureCatalogSchema(db);

    const columns = sqlite
        .prepare(`PRAGMA table_info(tags)`)
        .all()
        .map((row) => row.name);
    assert.equal(
        columns.filter((name) => name === 'retired_at').length,
        1,
        'the column is added exactly once',
    );
});
