// ── Sync Types ─────────────────────────────────────────────────────────────

export interface SyncConfig {
    /**
     * The workspace's Git **reference**: the id of an entry in the app-level Git
     * configuration library. This is the only connection field the workspace
     * stores; everything below it is resolved from that entry.
     */
    git_config_id: string;
    /**
     * Branch to sync against. **Workspace scope**: which line of history to sync
     * is this workspace's own decision, and the same connection may be synced on
     * different branches by different workspaces.
     */
    branch: string;
    /** Resolved from the reference: repository HTTPS URL. */
    remote_url: string;
    /** Resolved from the reference: the token that configuration carries. */
    access_token: string;
    /** Resolved from the reference: Git committer name. */
    git_name: string;
    /** Resolved from the reference: Git committer email. */
    git_email: string;
    /** Whether to automatically push after every save */
    auto_sync: boolean;
    /** Interval in minutes for auto sync */
    auto_sync_interval: number;
    /** ISO timestamp of last successful sync, or null */
    last_synced_at: string | null;
}

export type SyncStatus =
    | 'idle'
    | 'pushing'
    | 'pulling'
    | 'error'
    | 'conflict'
    | 'not_configured';

export type SyncOperation = 'push' | 'pull' | 'force_push' | 'force_pull' | 'auto';

export type SyncResultStatus =
    | 'success'
    | 'conflict'
    | 'error'
    | 'busy'
    | 'branch_mismatch'
    | 'remote_has_data'
    | 'remote_empty';

export type SyncSuccessKind =
    | 'pushed'
    | 'up_to_date'
    | 'pulled'
    | 'force_pushed'
    | 'force_pulled';

export interface SyncResult {
    status: SyncResultStatus;
    message: string;
    timestamp: string;
    successKind?: SyncSuccessKind;
    configuredBranch?: string;
    remoteDefaultBranch?: string | null;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
    git_config_id: '',
    remote_url: '',
    access_token: '',
    branch: 'main',
    git_name: '',
    git_email: '',
    auto_sync: false,
    auto_sync_interval: 15,
    last_synced_at: null,
};
