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

/** Tables a table's foreign keys point at, per `PRAGMA foreign_key_list`. */
async function referencedTables(
    db: Database,
    table: string,
): Promise<string[]> {
    try {
        const rows = await db.select<Array<{ table: string }>>(
            `PRAGMA foreign_key_list(${table})`,
        );
        return rows.map((r) => r.table);
    } catch {
        return [];
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
        success_check       TEXT NOT NULL DEFAULT '',
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

/**
 * Same shape as {@link CREATE_PUSH_RECORDS}, under a scratch name.
 * Used when the live table has to be rebuilt to shed a broken REFERENCES
 * clause (see `repairStaleTicketReference`).
 */
const CREATE_PUSH_RECORDS_REBUILD = `
    CREATE TABLE push_records_repaired (
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
    ['success_check', `TEXT NOT NULL DEFAULT ''`],
    ['timeout_ms', `INTEGER NOT NULL DEFAULT 30000`],
    ['retry_count', `INTEGER NOT NULL DEFAULT 0`],
    ['enabled', `INTEGER NOT NULL DEFAULT 1`],
    ['last_push_at', `TEXT`],
    ['created_at', `TEXT NOT NULL DEFAULT ''`],
    ['updated_at', `TEXT NOT NULL DEFAULT ''`],
];

/**
 * Re-point `push_records.ticket_id` at the live `tickets` table.
 *
 * The `tickets` table-recreation migrations (v4, v5, v8, v12) rename the table
 * out of the way before dropping it. SQLite rewrites `REFERENCES` clauses of
 * *other* tables when a table is renamed — regardless of `PRAGMA foreign_keys`
 * — so `push_records` ends up referencing the temporary name (`tickets_v11`,
 * `tickets_v7`, …), which is then dropped. The reference dangles.
 *
 * A dangling reference is not a harmless leftover: SQLite resolves every FK of
 * a table whenever that table is written, so any write touching `boards`,
 * `tickets` or `push_records` fails with `no such table: main.tickets_v11`.
 * That is what makes deleting a board (cascading into `tickets` and
 * `push_records`) silently impossible.
 *
 * Rebuilding the table is the only repair that works — a dangling FK cannot be
 * fixed with ALTER TABLE, and deleting the child rows first does not help
 * either, because the write itself is what fails. Rows are copied across, and
 * the table's indexes are recreated by the caller afterwards.
 */
async function repairStaleTicketReference(db: Database): Promise<void> {
    if (!(await tableExists(db, 'push_records'))) return;
    if (!(await tableExists(db, 'tickets'))) return;

    // A dangling reference is exactly one whose parent table is gone: the
    // rename replaces the live `tickets` entry with the temporary name.
    const targets = new Set(await referencedTables(db, 'push_records'));
    let staleName: string | null = null;
    for (const target of targets) {
        if (!(await tableExists(db, target))) {
            staleName = target;
            break;
        }
    }
    if (!staleName) return;

    const columns = [...(await columnNames(db, 'push_records'))];
    if (columns.length === 0) return;

    const columnList = columns.join(', ');

    try {
        await db.execute(CREATE_PUSH_RECORDS_REBUILD);
        await db.execute(
            `INSERT INTO push_records_repaired (${columnList}) SELECT ${columnList} FROM push_records`,
        );
        await db.execute(`DROP TABLE push_records`);
        await db.execute(
            `ALTER TABLE push_records_repaired RENAME TO push_records`,
        );
        console.warn(
            `[ensurePushSchema] repaired push_records.ticket_id -> tickets (was referencing missing table "${staleName}")`,
        );
    } catch (e) {
        console.error('[ensurePushSchema] push_records repair failed:', e);
    }
}

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
        // Must run before the column check: it rebuilds the table.
        await repairStaleTicketReference(db);

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
