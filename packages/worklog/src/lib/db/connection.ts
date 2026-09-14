import Database from '@tauri-apps/plugin-sql';
import { mkdir, exists } from '@tauri-apps/plugin-fs';
import { CREATE_TABLES } from './schema';

let _db: Database | null = null;
let _dbWorkspacePath: string | null = null;

export async function getDb(workspacePath: string): Promise<Database> {
    if (_db && _dbWorkspacePath === workspacePath) return _db;

    if (_db && _dbWorkspacePath !== workspacePath) {
        await _db.close();
        _db = null;
        _dbWorkspacePath = null;
    }

    // ── Ensure .worklog/ directory exists ──────────────
    const dirPath = `${workspacePath}/.worklog`;
    const dirExists = await exists(dirPath);
    if (!dirExists) {
        await mkdir(dirPath, { recursive: true });
    }

    // ── Open or create the SQLite database ─────────────
    _db = await Database.load(`sqlite:${workspacePath}/.worklog/worklog.db`);
    _dbWorkspacePath = workspacePath;
    await _db.execute(CREATE_TABLES);

    // ── Handle Migrations ──────────────────────────────
    const { runMigrations } = await import('./migrate');
    await runMigrations(_db);

    // ── Reconcile board columns ────────────────────────
    // Same reason as the push tables below: a workspace can report the current
    // schema_version while `boards` was created by older code and never
    // upgraded, because `CREATE TABLE IF NOT EXISTS` is a no-op on an existing
    // table. Without this, column config writes fail with "no such column".
    const { ensureBoardSchema } = await import('./ensure-board-schema');
    await ensureBoardSchema(_db);

    // ── Reconcile the catalog tables ───────────────────
    // Adds `retired_at` for workspaces the migration chain can no longer reach.
    const { ensureCatalogSchema } = await import('./ensure-catalog-schema');
    await ensureCatalogSchema(_db);

    // ── Reconcile the tickets table ────────────────────
    // A workspace can be stamped at the current schema_version while its
    // `tickets` table is still the one v21 built — the table that pinned
    // `priority` to p1/p2/p3, which makes a custom priority fail with SQLite
    // error 275. Must run before ensurePushSchema, which repairs the
    // `push_records` reference that this rebuild dangles.
    const { ensureTicketSchema } = await import('./ensure-ticket-schema');
    await ensureTicketSchema(_db);

    // ── Reconcile remote-push tables ───────────────────
    // Runs independently of schema_version: a workspace can report the current
    // version while its tables were created by older code and never upgraded
    // (CREATE TABLE IF NOT EXISTS is a no-op on an existing table), which would
    // make every push-target insert fail on a missing column.
    const { ensurePushSchema } = await import('./ensure-push-schema');
    await ensurePushSchema(_db);

    // ── Seed Default Ticket Types if empty ──────────────
    const typesCount = await _db.select<{ count: number }[]>("SELECT COUNT(*) as count FROM ticket_types");
    if (typesCount && typesCount[0] && typesCount[0].count === 0) {
        const now = new Date().toISOString();
        const { DEFAULT_TICKET_TYPES } = await import('./catalogs');

        for (const t of DEFAULT_TICKET_TYPES) {
            await _db.execute(
                "INSERT INTO ticket_types (id, name, color, icon, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [t.id, t.name, t.color, t.icon, t.is_default, now, now]
            );
        }
    }

    // ── Seed priority levels and tags if empty ──────────
    // Both are user-editable catalogs; this only ever fills an empty table, so
    // deleting a seeded entry never brings it back.
    const { seedCatalogs } = await import('./catalogs');
    await seedCatalogs(_db);

    return _db;
}

export async function closeDb(): Promise<void> {
    if (_db) {
        await _db.close();
        _db = null;
        _dbWorkspacePath = null;
    }
}
