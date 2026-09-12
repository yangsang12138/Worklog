import type Database from '@tauri-apps/plugin-sql';

// ─────────────────────────────────────────────────────────────────────────────
// Self-healing schema guard for the `boards` table.
//
// `workspace_meta.schema_version` is authoritative for the *migration chain*,
// but it can be stamped ahead of the actual DDL — an interrupted upgrade, or a
// build whose SCHEMA_VERSION was bumped in one commit while the matching
// migration landed in another. `runMigrations` then returns early on
// `current === SCHEMA_VERSION` forever, and every later migration is skipped.
//
// A board column that exists in the version but not in the table cannot be
// written: `UPDATE boards SET ...` fails with "no such column", the write is
// swallowed by the caller and the UI silently reverts. This guard repairs the
// table independently of the version so the feature recovers on next launch.
//
// Safe to call on every connection; never throws for a recoverable problem.
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

/**
 * Board columns introduced after the initial schema, each one a plain
 * additive `ALTER TABLE` that is safe to re-run against a live database.
 */
const BOARD_COLUMNS: ReadonlyArray<readonly [name: string, ddl: string]> = [
    // v13 — soft-delete / archiving
    ['archived_at', 'TEXT'],
    // v15 — per-board tab set
    ['tabs_config', `TEXT NOT NULL DEFAULT '["kanban"]'`],
    // v20 — per-board Kanban column configuration
    ['columns_config', `TEXT NOT NULL DEFAULT ''`],
];

/**
 * Reconcile the `boards` table with the schema this build expects.
 */
export async function ensureBoardSchema(db: Database): Promise<void> {
    if (!(await tableExists(db, 'boards'))) return;

    const existing = await columnNames(db, 'boards');
    if (existing.size === 0) return;

    for (const [name, ddl] of BOARD_COLUMNS) {
        if (existing.has(name)) continue;
        try {
            await db.execute(`ALTER TABLE boards ADD COLUMN ${name} ${ddl}`);
            console.log(`[ensureBoardSchema] added boards.${name}`);
        } catch (e) {
            console.error(`[ensureBoardSchema] boards.${name} failed:`, e);
        }
    }
}
