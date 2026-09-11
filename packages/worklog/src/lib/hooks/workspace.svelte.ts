import type { WorkspaceMeta } from '$lib/components/app/types';
import { getDb, closeDb, WorkspaceRepo } from '$lib/db';
import { runMigrations } from '$lib/db/migrate';
import { syncState } from '$lib/sync/sync-scheduler.svelte';
import * as m from '$lib/paraglide/messages.js';

const WORKSPACE_PATH_KEY = 'last_workspace_path';
const RECENT_PATHS_KEY = 'recent_workspace_paths';
const MAX_RECENT_PATHS = 8;
let initInFlight: Promise<void> | null = null;

function readStorage<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;

    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function writeStorage(key: string, value: unknown) {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore storage failures and continue with in-memory app state.
    }
}

function getSavedWorkspacePath(): string | null {
    if (typeof window === 'undefined') return null;

    try {
        return window.localStorage.getItem(WORKSPACE_PATH_KEY);
    } catch {
        return null;
    }
}

function saveWorkspacePath(path: string) {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(WORKSPACE_PATH_KEY, path);
    } catch {
        // Ignore storage failures and continue with in-memory app state.
    }
}

function clearSavedWorkspacePath() {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.removeItem(WORKSPACE_PATH_KEY);
    } catch {
        // Ignore storage failures and continue with in-memory app state.
    }
}

type WorkspaceStatus =
    | 'idle'        // app just opened, checking persisted path
    | 'no_workspace'// no saved path or path invalid — show open screen
    | 'loading'     // initializing DB
    | 'ready'       // fully loaded, show board view
    | 'error'       // something went wrong

/** Normalize Windows backslashes to forward slashes for consistent path handling. */
function normalizePath(p: string): string {
    return p.replaceAll('\\', '/');
}

/** Last path segment, used as a human-friendly label for a workspace path. */
export function workspaceFolderName(path: string): string {
    const trimmed = normalizePath(path).replace(/\/+$/, '');
    const segment = trimmed.split('/').filter(Boolean).pop();
    return segment || trimmed || path;
}

/** Classify common Tauri errors into user-friendly messages. */
function classifyWorkspaceError(raw: string): string {
    // Tauri filesystem scope violations (Windows "forbidden path")
    if (
        raw.toLowerCase().includes('forbidden') ||
        raw.toLowerCase().includes('not allowed') ||
        raw.toLowerCase().includes('permission denied') ||
        raw.includes('tauri::fs') ||
        raw.includes('not permitted')
    ) {
        return m.workspace_folder_not_accessible();
    }
    return raw;
}

let _path = $state<string | null>(null);
let _meta = $state<WorkspaceMeta | null>(null);
let _status = $state<WorkspaceStatus>('idle');
let _error = $state<string | null>(null);
let _recents = $state<string[]>([]);

function rememberRecentPath(path: string) {
    const next = [path, ..._recents.filter((item) => item !== path)].slice(
        0,
        MAX_RECENT_PATHS,
    );
    _recents = next;
    writeStorage(RECENT_PATHS_KEY, next);
}

function forgetRecentPath(path: string) {
    const next = _recents.filter((item) => item !== path);
    if (next.length === _recents.length) return;
    _recents = next;
    writeStorage(RECENT_PATHS_KEY, next);
}

async function ensureFolderExists(path: string): Promise<boolean> {
    try {
        const { exists } = await import('@tauri-apps/plugin-fs');
        return await exists(path);
    } catch {
        // If the check itself fails, let the open attempt surface the real error.
        return true;
    }
}

export function getWorkspace() {

    // Called once on app boot from +layout.svelte
    async function init() {
        if (_status === 'ready' && _path) return;
        if (initInFlight) return initInFlight;

        initInFlight = (async () => {
            try {
                _status = 'idle';
                _error = null;
                _recents = readStorage<string[]>(RECENT_PATHS_KEY, []).filter(
                    (item): item is string => typeof item === 'string',
                );

                const saved = getSavedWorkspacePath();
                if (!saved) {
                    _status = 'no_workspace';
                    return;
                }

                const resolved = normalizePath(saved);
                await open_workspace(resolved);

                if (_path !== resolved) {
                    _path = null;
                    _meta = null;
                    clearSavedWorkspacePath();
                    _status = 'no_workspace';
                }
            } catch (e) {
                const msg = String(e);
                _error = classifyWorkspaceError(msg);

                // If the saved path is no longer accessible (e.g. drive removed,
                // permissions changed), clear it so the next launch goes straight
                // to the workspace selector instead of re-triggering the error.
                if (
                    msg.toLowerCase().includes('forbidden') ||
                    msg.toLowerCase().includes('not allowed') ||
                    msg.toLowerCase().includes('permission denied') ||
                    msg.toLowerCase().includes('no such file or directory') ||
                    msg.toLowerCase().includes('enosys')
                ) {
                    _path = null;
                    _meta = null;
                    clearSavedWorkspacePath();
                    _status = 'no_workspace';
                } else {
                    _status = 'error';
                }
            } finally {
                initInFlight = null;
            }
        })();

        return initInFlight;
    }

    /**
     * Ask the user for a folder via the OS dialog and open it as the workspace.
     * Returns the opened path, or `null` when the user cancelled / opening failed.
     */
    async function pick(): Promise<string | null> {
        try {
            _error = null;
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({ directory: true, multiple: false });
            if (!selected) return null; // user cancelled

            const path = normalizePath(selected as string);
            const ok = await openPath(path);
            return ok ? path : null;
        } catch (e) {
            _error = classifyWorkspaceError(String(e));
            _status = 'error';
            return null;
        }
    }

    /**
     * Open a specific folder as the workspace. Used for recent workspaces,
     * where the folder may have been moved or deleted in the meantime.
     */
    async function openPath(rawPath: string): Promise<boolean> {
        const path = normalizePath(rawPath);

        if (path === _path && _status === 'ready') return true;
        if (syncState.isSyncing) {
            _error = m.sync_operation_busy();
            return false;
        }

        if (!(await ensureFolderExists(path))) {
            forgetRecentPath(path);
            _error = m.workspace_folder_missing();
            if (_status !== 'ready') _status = 'error';
            return false;
        }

        const opened = await open_workspace(path);
        if (!opened) forgetRecentPath(path);
        return opened;
    }

    async function open_workspace(rawPath: string): Promise<boolean> {
        if (syncState.isSyncing) {
            _error = m.sync_operation_busy();
            return false;
        }
        try {
            _status = 'loading';
            _error = null;

            const path = normalizePath(rawPath);
            const db = await getDb(path);
            await runMigrations(db);
            await WorkspaceRepo.initWorkspace(db, workspaceFolderName(path) || m.workspace_default_name());

            _meta = await WorkspaceRepo.getWorkspaceMeta(db);
            _path = path;

            saveWorkspacePath(path);
            rememberRecentPath(path);

            _status = 'ready';
            return true;
        } catch (e) {
            _error = classifyWorkspaceError(String(e));
            _status = 'error';
            return false;
        }
    }

    async function close() {
        if (syncState.isSyncing) throw new Error(m.sync_operation_busy());
        await closeDb();
        clearSavedWorkspacePath();
        _path = null;
        _meta = null;
        _status = 'no_workspace';
        _error = null;
    }

    async function refreshMeta() {
        if (_path) _meta = await WorkspaceRepo.getWorkspaceMeta(await getDb(_path));
    }

    return {
        get path() { return _path },
        get meta() { return _meta },
        get status() { return _status },
        get error() { return _error },
        get recents() { return _recents },
        init, pick, openPath, close, refreshMeta
    };
}
