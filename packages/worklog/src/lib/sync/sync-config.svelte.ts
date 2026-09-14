import type Database from '@tauri-apps/plugin-sql';
import type { SyncConfig, SyncStatus } from './types';
import { DEFAULT_SYNC_CONFIG } from './types';
import {
    loadAppConfig,
    resolveGitReference,
} from '$lib/app-config/app-config.svelte';

// ── Module-level reactive state ────────────────────────────────────────────

let _config = $state<SyncConfig>({ ...DEFAULT_SYNC_CONFIG });
let _status = $state<SyncStatus>('not_configured');

/**
 * Reactive hook for sync configuration.
 *
 * The config is **split across two scopes**, and this module is the seam that
 * presents them as one object so the engine, the scheduler and the UI keep
 * working unchanged:
 *
 *   | field                                   | owner     | why                     |
 *   |-----------------------------------------|-----------|-------------------------|
 *   | git_config_id, branch, auto_sync,       | workspace | which line of history   |
 *   | auto_sync_interval, last_synced_at      | (DB)      | to sync, and when *this*|
 *   |                                         |           | workspace syncs         |
 *   | remote_url, git_name, git_email,        | app       | a named Git connection, |
 *   | access_token                            | (config)  | resolved through the    |
 *   |                                         |           | workspace's reference   |
 *
 * The branch is a workspace value on purpose: which line of history to sync is
 * a decision this workspace makes, and the same connection can be synced on
 * `main` here and a release branch elsewhere. The connection fields are
 * *derived*, never stored here. If the reference is missing or dangling the
 * config resolves to empty values, which the engine reports as "not configured"
 * instead of authenticating with whatever credential happens to be around.
 */
export function getSyncConfig() {
    async function load(db: Database): Promise<void> {
        await loadAppConfig();

        try {
            const rows = await db.select<any[]>(
                `SELECT git_config_id, branch, auto_sync, auto_sync_interval, last_synced_at
                 FROM sync_config WHERE id = 1`
            );

            const row = rows[0] ?? {};
            const reference = resolveGitReference(row.git_config_id || null);

            _config = {
                git_config_id: reference ? row.git_config_id || '' : '',
                branch: row.branch || 'main',
                remote_url: reference?.remote_url ?? '',
                git_name: reference?.git_name ?? '',
                git_email: reference?.git_email ?? '',
                access_token: reference?.access_token ?? '',
                auto_sync: Boolean(row.auto_sync),
                auto_sync_interval: row.auto_sync_interval || 15,
                last_synced_at: row.last_synced_at || null,
            };

            _status = _config.remote_url ? 'idle' : 'not_configured';
        } catch {
            // Table or column missing (pre-migration): report as unconfigured
            // rather than throwing during workspace boot.
            _config = { ...DEFAULT_SYNC_CONFIG };
            _status = 'not_configured';
        }
    }

    async function save(db: Database): Promise<void> {
        // ── App scope is read-only from here ──────────────────────────────
        // The connection lives in the referenced Git configuration, owned by
        // Settings → Identity & Credentials → Git Authentication. This page
        // stores the reference, the branch, and its own behaviour — never a
        // copy of what the reference points at.

        // ── Workspace scope ───────────────────────────────────────────────
        // The pre-reference connection columns are written empty on purpose:
        // they are derived from the Git configuration now, and an explicit empty
        // string also erases any value left behind by an older build.
        const now = new Date().toISOString();
        await db.execute(
            `INSERT INTO sync_config (id, git_config_id, branch, remote_url, access_token, git_name, git_email, auto_sync, auto_sync_interval, last_synced_at, updated_at)
             VALUES (1, ?, ?, '', '', '', '', ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                git_config_id = excluded.git_config_id,
                branch = excluded.branch,
                remote_url = '',
                access_token = '',
                git_name = '',
                git_email = '',
                auto_sync = excluded.auto_sync,
                auto_sync_interval = excluded.auto_sync_interval,
                last_synced_at = excluded.last_synced_at,
                updated_at = excluded.updated_at`,
            [
                _config.git_config_id,
                _config.branch || 'main',
                _config.auto_sync ? 1 : 0,
                _config.auto_sync_interval,
                _config.last_synced_at,
                now,
            ]
        );
    }

    function updateLastSynced(timestamp: string) {
        _config.last_synced_at = timestamp;
    }

    function setStatus(status: SyncStatus) {
        _status = status;
    }

    return {
        get config() { return _config; },
        set config(value: SyncConfig) { _config = value; },
        get status() { return _status; },
        load,
        save,
        updateLastSynced,
        setStatus,
    };
}
