import type Database from '@tauri-apps/plugin-sql';

// ─────────────────────────────────────────────────────────────────────────────
// Self-healing schema guard for the remote-push tables.
//
// `workspace_meta.schema_version` is authoritative for the *migration chain*,
// but the version can be stamped ahead of the actual DDL (e.g. an interrupted
// upgrade, or a workspace whose tables were created by an older `CREATE_TABLES`
// and never re-created because `CREATE TABLE IF NOT EXISTS` is a no-op).
//
// When that happens the version check makes `runMigrations` return early
// forever, leaving the tables permanently behind — inserts then fail with
// "table push_targets has no column named ...".
//
// This guard runs on every connection and reconciles the tables against the
// shape the code actually expects, independently of the version number. It is
// idempotent and cheap (a handful of lookups on the common path).
// ─────────────────────────────────────────────────────────────────────────────

async function tableExists(db: Database, name: string): Promise<boolean> {
    try {
        const rows = await db.select<Array<{ name: string }>>(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
            [name],
        );
        return rows.length > 0;
    } catch {
        return false;
    }
}

async function columnNames(db: Database, table: string): Promise<Set<string>> {
    try {
        const rows = await db.select<Array<{ name: string }>>(
            `PRAGMA table_info(${table})`,
        );
        return new Set(rows.map((r) => r.name));
    } catch {
        return new Set();
    }
}

const CREATE_PUSH_TARGETS = `
    CREATE TABLE IF NOT EXISTS push_targets (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        description         TEXT NOT NULL DEFAULT '',
        endpoint_url        TEXT NOT NULL,
        http_method         TEXT NOT NULL DEFAULT 'POST',
        headers             TEXT NOT NULL DEFAULT '{}',
        body_template       TEXT NOT NULL DEFAULT '',
        body_content_type   TEXT NOT NULL DEFAULT 'application/json',
        field_mapping       TEXT NOT NULL DEFAULT '{}',
        payload_fields      TEXT NOT NULL DEFAULT '[]',
        query_params        TEXT NOT NULL DEFAULT '[]',
        variables           TEXT NOT NULL DEFAULT '[]',
        source_config       TEXT NOT NULL DEFAULT '',
        timeout_ms          INTEGER NOT NULL DEFAULT 30000,
        retry_count         INTEGER NOT NULL DEFAULT 0,
        enabled             INTEGER NOT NULL DEFAULT 1,
        last_push_at        TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
    )
`;

const CREATE_PUSH_RECORDS = `
    CREATE TABLE IF NOT EXISTS push_records (
        id                  TEXT PRIMARY KEY,
        ticket_id           TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        board_id            TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        target_id           TEXT NOT NULL REFERENCES push_targets(id) ON DELETE CASCADE,
        status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'success', 'failed')),
        request_url         TEXT NOT NULL,
        request_body        TEXT,
        variables_snapshot  TEXT,
        response_status     INTEGER,
        response_body       TEXT,
        error_message       TEXT,
        duration_ms         INTEGER,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
    )
`;

/** Columns push_targets may be missing on a workspace created by older code. */
const PUSH_TARGET_COLUMNS: Array<[string, string]> = [
    ['name', `TEXT NOT NULL DEFAULT ''`],
    ['description', `TEXT NOT NULL DEFAULT ''`],
    ['endpoint_url', `TEXT NOT NULL DEFAULT ''`],
    ['http_method', `TEXT NOT NULL DEFAULT 'POST'`],
    ['headers', `TEXT NOT NULL DEFAULT '{}'`],
    ['body_template', `TEXT NOT NULL DEFAULT ''`],
    ['body_content_type', `TEXT NOT NULL DEFAULT 'application/json'`],
    ['field_mapping', `TEXT NOT NULL DEFAULT '{}'`],
    ['payload_fields', `TEXT NOT NULL DEFAULT '[]'`],
    ['query_params', `TEXT NOT NULL DEFAULT '[]'`],
    ['variables', `TEXT NOT NULL DEFAULT '[]'`],
    ['source_config', `TEXT NOT NULL DEFAULT ''`],
    ['timeout_ms', `INTEGER NOT NULL DEFAULT 30000`],
    ['retry_count', `INTEGER NOT NULL DEFAULT 0`],
    ['enabled', `INTEGER NOT NULL DEFAULT 1`],
    ['last_push_at', `TEXT`],
    ['created_at', `TEXT NOT NULL DEFAULT ''`],
    ['updated_at', `TEXT NOT NULL DEFAULT ''`],
];

/**
 * Reconcile the remote-push tables with the schema this build expects.
 * Safe to call on every connection; never throws for a recoverable problem.
 */
export async function ensurePushSchema(db: Database): Promise<void> {
    // ── tickets.push_info (mirrored push badges on the card) ────────────────
    if (await tableExists(db, 'tickets')) {
        const ticketCols = await columnNames(db, 'tickets');
        if (!ticketCols.has('push_info')) {
            try {
                await db.execute(
                    `ALTER TABLE tickets ADD COLUMN push_info TEXT NOT NULL DEFAULT '[]'`,
                );
            } catch (e) {
                console.error('[ensurePushSchema] tickets.push_info failed:', e);
            }
        }
    }

    // ── push_targets ────────────────────────────────────────────────────────
    if (!(await tableExists(db, 'push_targets'))) {
        await db.execute(CREATE_PUSH_TARGETS);
    } else {
        const cols = await columnNames(db, 'push_targets');
        for (const [name, ddl] of PUSH_TARGET_COLUMNS) {
            if (cols.has(name)) continue;
            try {
                await db.execute(
                    `ALTER TABLE push_targets ADD COLUMN ${name} ${ddl}`,
                );
            } catch (e) {
                console.error(
                    `[ensurePushSchema] push_targets.${name} failed:`,
                    e,
                );
            }
        }
    }

    // ── push_records ────────────────────────────────────────────────────────
    if (!(await tableExists(db, 'push_records'))) {
        await db.execute(CREATE_PUSH_RECORDS);
    } else {
        const cols = await columnNames(db, 'push_records');
        if (!cols.has('variables_snapshot')) {
            try {
                await db.execute(
                    `ALTER TABLE push_records ADD COLUMN variables_snapshot TEXT`,
                );
            } catch (e) {
                console.error(
                    '[ensurePushSchema] push_records.variables_snapshot failed:',
                    e,
                );
            }
        }
    }

    // ── indexes ─────────────────────────────────────────────────────────────
    const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_push_records_ticket ON push_records(ticket_id)`,
        `CREATE INDEX IF NOT EXISTS idx_push_records_board ON push_records(board_id)`,
        `CREATE INDEX IF NOT EXISTS idx_push_records_target ON push_records(target_id)`,
        `CREATE INDEX IF NOT EXISTS idx_push_records_status ON push_records(status)`,
    ];
    for (const sql of indexes) {
        try {
            await db.execute(sql);
        } catch (e) {
            console.error('[ensurePushSchema] index failed:', e);
        }
    }
}
