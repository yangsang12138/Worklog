import type Database from '@tauri-apps/plugin-sql';
import type { AppSettings, UpdateAppSettingsInput } from '$lib/components/app/types';

/**
 * The workspace `app_settings` table — **vestigial, kept only for migration**.
 *
 * Its three columns were all at the wrong level, and none of them is read any
 * more:
 *
 *   - `author_name` — an identity ("who is operating"), which is app-level now
 *     (`$lib/app-config`). It used to be serialised into the synced
 *     `settings.json`, so two teammates overwrote each other's name on every
 *     push, and it silently changed when you switched workspaces.
 *   - `default_branch` — a duplicate of `sync_config.branch`, which is the one
 *     the sync engine actually uses. The workspace is the right owner for a
 *     branch: it is a contract the team shares, not a per-machine preference.
 *   - `autosave_seconds` — never had a single consumer.
 *
 * `adoptWorkspaceIdentity()` clears `author_name` on workspace open and lifts
 * the value to the app config. The table is left in place because dropping it
 * needs a table rebuild, and an empty table does no harm.
 */

function toSettings(row: AppSettings): AppSettings {
    return {
        author_name: row.author_name,
        default_branch: row.default_branch,
        autosave_seconds: Number(row.autosave_seconds),
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

export async function initSettings(db: Database): Promise<void> {
    const now = new Date().toISOString();

    await db.execute(
        `INSERT OR IGNORE INTO app_settings (
            id,
            author_name,
            default_branch,
            autosave_seconds,
            created_at,
            updated_at
        ) VALUES (1, '', 'main', 10, ?, ?)`,
        [now, now],
    );
}

export async function getSettings(db: Database): Promise<AppSettings> {
    await initSettings(db);

    const rows = await db.select<AppSettings[]>(
        `SELECT author_name, default_branch, autosave_seconds, created_at, updated_at
         FROM app_settings
         WHERE id = 1`,
    );

    return toSettings(rows[0]);
}

export async function updateSettings(
    db: Database,
    input: UpdateAppSettingsInput,
): Promise<AppSettings> {
    const existing = await getSettings(db);

    const next: AppSettings = {
        ...existing,
        ...input,
        autosave_seconds:
            input.autosave_seconds ?? existing.autosave_seconds,
        updated_at: new Date().toISOString(),
    };

    await db.execute(
        `UPDATE app_settings
         SET author_name = ?,
             default_branch = ?,
             autosave_seconds = ?,
             updated_at = ?
         WHERE id = 1`,
        [
            next.author_name,
            next.default_branch,
            next.autosave_seconds,
            next.updated_at,
        ],
    );

    return next;
}
