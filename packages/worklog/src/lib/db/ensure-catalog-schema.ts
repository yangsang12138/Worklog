import type Database from '@tauri-apps/plugin-sql';

/**
 * Make sure the three catalog tables can hold a retired row.
 *
 * A "retired" row is one a configuration no longer contains while a ticket still
 * points at it. Deleting it would put a raw id back on that ticket's card (the
 * failure the catalogs-in-the-snapshot work exists to prevent); leaving it *active*
 * would mean the workspace never actually matches its configuration. Retiring it
 * is the only option that satisfies both, and it needs a column.
 *
 * Why this runs on every `getDb` instead of living only in the migration chain:
 * `runMigrations` returns immediately when a workspace's stamped `schema_version`
 * already equals the current one, so a workspace whose version was advanced
 * without the chain running is never revisited — the same trap that left a stale
 * CHECK constraint on `tickets` and made every custom priority fail with SQLite
 * error 275. Column additions are idempotent, so doing them here costs nothing.
 */
export async function ensureCatalogSchema(db: Database): Promise<void> {
    for (const table of ['ticket_types', 'ticket_priorities', 'tags']) {
        try {
            const columns = await db.select<Array<{ name: string }>>(
                `PRAGMA table_info(${table})`,
            );
            // No table yet: `getDb` creates them from CREATE_TABLES, which
            // already carries the column.
            if (columns.length === 0) continue;
            if (columns.some((column) => column.name === 'retired_at')) continue;

            await db.execute(`ALTER TABLE ${table} ADD COLUMN retired_at TEXT`);
        } catch (error) {
            console.error(`[ensureCatalogSchema] ${table} failed:`, error);
        }
    }
}
