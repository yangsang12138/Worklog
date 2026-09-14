import type Database from '@tauri-apps/plugin-sql';
import type { WorkspaceMeta } from '$lib/components/app/types';
import { SCHEMA_VERSION } from '$lib/db/schema';

export async function initWorkspace(db: Database, name: string): Promise<void> {
    // A brand-new workspace is created by CREATE_TABLES at the current schema,
    // so stamping SCHEMA_VERSION here is correct.
    //
    // Do NOT update the version of an *existing* workspace from here: writing a
    // newer version without running the migrations makes `runMigrations` return
    // early forever, stranding the tables at their old shape. Only the
    // migration runner may advance the version.
    await db.execute(
        `INSERT OR IGNORE INTO workspace_meta (id, name, schema_version, sync_mode, created_at)
     VALUES (1, ?, ?, 'local', ?)`,
        [name, SCHEMA_VERSION, new Date().toISOString()]
    );
}

export async function getWorkspaceMeta(db: Database): Promise<WorkspaceMeta | null> {
    const rows = await db.select<WorkspaceMeta[]>(
        `SELECT name, schema_version, sync_mode, created_at FROM workspace_meta WHERE id = 1`
    );
    return rows[0] ?? null;
}

/**
 * The workspace's reference to an app-level todo-attribute configuration.
 *
 * Read directly rather than through `WorkspaceMeta`, whose shape is shared with
 * the export snapshot: a reference to a machine-local library has no meaning in a
 * file meant for another machine.
 */
export async function getCatalogSetId(db: Database): Promise<string> {
    try {
        const rows = await db.select<{ catalog_set_id: string }[]>(
            `SELECT catalog_set_id FROM workspace_meta WHERE id = 1`,
        );
        return rows[0]?.catalog_set_id ?? '';
    } catch {
        // Pre-migration workspace.
        return '';
    }
}

export async function setCatalogSetId(db: Database, id: string): Promise<void> {
    await db.execute(
        `UPDATE workspace_meta SET catalog_set_id = ? WHERE id = 1`,
        [id],
    );
}

export async function updateWorkspaceName(db: Database, name: string): Promise<void> {
    await db.execute(
        `UPDATE workspace_meta SET name = ? WHERE id = 1`,
        [name]
    );
}
