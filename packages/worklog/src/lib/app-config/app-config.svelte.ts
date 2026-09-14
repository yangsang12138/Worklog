import { browser } from '$app/environment';
import type Database from '@tauri-apps/plugin-sql';
import { isTauri } from '@tauri-apps/api/core';
import {
    adoptGitLibrary,
    createGitConfig,
    findGitConfig,
    legacyToken,
    normalizeGitConfigs,
    type GitConfigEntry,
} from './git-configs';
import { LEGACY_CONFIG_NAME } from './tokens';
import {
    BUILTIN_CATALOG_SET_ID,
    normalizeCatalogSets,
    type CatalogSet,
} from './catalogs';

/**
 * Application-level configuration — "this person, on this machine".
 *
 * Every value here is shared by **all workspaces** this app opens, and is
 * deliberately stored *outside* the workspace folder, so it can never travel
 * with a git-synced workspace or an export. Two rules every key added here must
 * satisfy:
 *
 *   1. It describes the user or the machine — not the team's data.
 *   2. It must never be needed to interpret a stored ticket. Anything a ticket
 *      refers to by id (types, priorities, tags, columns) belongs to the
 *      workspace, where it is materialised and synced; keeping it here would
 *      leave every teammate and every export with dangling references.
 *
 * The shape is a small library of **resources that other things reference**,
 * not a pile of live settings:
 *
 *   - `git.configs` — named, self-contained Git connections, each carrying its
 *     own commit identity and access token.
 *
 * That is why nothing here carries a "currently active" flag: usage belongs to
 * the referrer. A workspace records *which* Git configuration it uses (plus the
 * branch it syncs, which is its own decision), so its behaviour is reproducible
 * from its own data instead of from whatever the library happened to point at.
 *
 * Why any of this lives here rather than in the workspace DB: a workspace folder
 * is usually a git repository, so a token in `worklog.db` is one `git add .`
 * away from being published, and an identity in there is shared with whoever
 * syncs next.
 *
 * Storage is `tauri-plugin-store` (app config dir). NOTE: plugin-store is plain
 * JSON, **not** an encrypted store — keeping the token out of the git-tracked
 * workspace removes the main exposure, but an OS keychain is still the correct
 * long-term home for it, and is not implemented yet.
 */

/** Store file name, resolved inside the OS app-config directory by the plugin. */
const STORE_FILE = 'worklog-app.json';

/** Single key holding the whole config object, so reads/writes stay atomic. */
const STORE_KEY = 'app_config';

/** Fallback for plain-browser dev (`vite dev`), where Tauri APIs are absent. */
const FALLBACK_KEY = 'worklog:app-config';

export interface AppIdentityConfig {
    /** Author recorded on comments and events. */
    author_name: string;
    /**
     * Legacy commit identity, from before Git configurations existed.
     *
     * Read only, and only by the one-time adoption that moves these values into
     * a Git configuration. Nothing writes them any more — a repository's commit
     * identity belongs to its Git configuration, because a work repo and a
     * personal repo want different ones.
     */
    git_name: string;
    git_email: string;
}

/** Preferences for the data-management tools (export/import). */
export interface AppDataConfig {
    export_format: 'json' | 'csv';
    export_mode: 'single-file' | 'folder';
}

export interface AppConfig {
    identity: AppIdentityConfig;
    /** The library of named Git connections a workspace can reference. */
    git: { configs: GitConfigEntry[] };
    data: AppDataConfig;
    /**
     * The library of todo-attribute **configurations**. A workspace references
     * one and materialises it into its own rows — its *instance*.
     */
    catalogs: { sets: CatalogSet[] };
}

/** What the sync engine needs, resolved from one workspace reference. */
export interface ResolvedGitReference {
    remote_url: string;
    git_name: string;
    git_email: string;
    access_token: string;
}

function defaults(): AppConfig {
    return {
        identity: { author_name: '', git_name: '', git_email: '' },
        git: { configs: [] },
        data: { export_format: 'json', export_mode: 'single-file' },
        catalogs: { sets: [] },
    };
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/**
 * A credential found in an older shape, held until a workspace claims it.
 *
 * The very first shape kept one token at the top level and no library. It cannot
 * become a configuration here — nothing in the app config knows which repository
 * it belongs to — so it waits for `adoptWorkspaceSettings`, which does.
 */
let _legacyCredential = '';

/** Coerce whatever is on disk into a complete config — never trust the file. */
function normalize(raw: unknown): AppConfig {
    if (!raw || typeof raw !== 'object') return defaults();

    const source = raw as {
        identity?: Partial<AppIdentityConfig>;
        git?: unknown;
        credentials?: unknown;
        data?: Partial<AppDataConfig>;
        catalogs?: unknown;
        // Older generations kept these at the top of the file.
        git_name?: unknown;
        git_email?: unknown;
        github_token?: unknown;
    };

    const identity = source.identity ?? {};
    const data = source.data ?? {};

    _legacyCredential =
        legacyToken(source.credentials) ||
        legacyToken(source.git) ||
        str(source.github_token).trim();

    return {
        identity: {
            author_name: str(identity.author_name),
            // Older builds stored the commit identity here; keep reading it so
            // the adoption below can still find it.
            git_name: str(identity.git_name) || str(source.git_name),
            git_email: str(identity.git_email) || str(source.git_email),
        },
        git: {
            // The pool is handed over explicitly: it used to sit under
            // `credentials`, not inside `git`.
            configs: adoptGitLibrary(
                source.git,
                (source.credentials as { tokens?: unknown } | undefined)?.tokens,
            ),
        },
        data: {
            export_format: data.export_format === 'csv' ? 'csv' : 'json',
            export_mode:
                data.export_mode === 'folder' ? 'folder' : 'single-file',
        },
        catalogs: { sets: normalizeCatalogSets(source.catalogs) },
    };
}

let _config = $state<AppConfig>(defaults());
let _loaded = false;
let _loadInFlight: Promise<void> | null = null;

function canUseTauri(): boolean {
    if (!browser) return false;
    try {
        return isTauri();
    } catch {
        return false;
    }
}

/**
 * Opens the app-level store file, or `null` outside Tauri (plain-browser dev).
 *
 * `defaults` seeds a well-formed file on first run; on an existing file the
 * on-disk state wins (plugin default), so nothing is ever silently reset.
 * Requires the `store:allow-load` capability.
 */
async function openStore() {
    if (!canUseTauri()) return null;
    try {
        const { load } = await import('@tauri-apps/plugin-store');
        return await load(STORE_FILE, {
            defaults: { [STORE_KEY]: defaults() },
            autoSave: false,
        });
    } catch (e) {
        console.warn('[app-config] plugin-store unavailable:', e);
        return null;
    }
}

/** The webview-store fallback, used only when the app config is unavailable. */
function readFallback(): unknown {
    if (!browser) return undefined;
    try {
        const raw = localStorage.getItem(FALLBACK_KEY);
        return raw ? JSON.parse(raw) : undefined;
    } catch {
        return undefined;
    }
}

function writeFallback(value: AppConfig): boolean {
    if (!browser) return false;
    try {
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

function clearFallback(): void {
    if (!browser) return;
    try {
        localStorage.removeItem(FALLBACK_KEY);
    } catch {
        // Nothing to do.
    }
}

/** Reads the raw object from the best backend available. */
async function readRaw(): Promise<unknown> {
    const store = await openStore();
    if (!store) return readFallback();

    let stored: unknown;
    try {
        stored = await store.get(STORE_KEY);
    } catch (e) {
        console.warn(
            '[app-config] plugin-store read failed, falling back to localStorage:',
            e,
        );
        return readFallback();
    }
    if (stored) return stored;

    // The app config is empty, but a value can still sit in the webview
    // fallback from a build that could not open the store (before
    // `store:allow-load` was granted). Adopt it here, so rebuilding the app
    // does not look like "my settings and my token disappeared".
    const fallback = readFallback();
    if (fallback) {
        try {
            await store.set(STORE_KEY, fallback);
            await store.save();
        } catch {
            // Keep serving it from the fallback; the next write will retry.
        }
    }
    return fallback;
}

/**
 * Persists the config. Returns `false` when no backend accepted the write, so
 * callers can avoid destroying a value they were about to migrate.
 *
 * Exactly one backend owns the value: the app config when it is available,
 * otherwise the webview fallback. Writing to both would put a token in two
 * places for no benefit, and the fallback is cleared once the app config has
 * taken over.
 */
async function writeRaw(value: AppConfig): Promise<boolean> {
    const store = await openStore();
    if (store) {
        try {
            await store.set(STORE_KEY, value);
            await store.save();
            clearFallback();
            return true;
        } catch (e) {
            console.warn('[app-config] failed to save via plugin-store:', e);
        }
    }

    return writeFallback(value);
}

/** Loads the app-level config once; concurrent callers share one read. */
export async function loadAppConfig(): Promise<void> {
    if (_loaded) return;
    if (_loadInFlight) return _loadInFlight;

    _loadInFlight = (async () => {
        try {
            _config = normalize(await readRaw());
            _loaded = true;
        } finally {
            _loadInFlight = null;
        }
    })();

    return _loadInFlight;
}

async function persist(next: AppConfig): Promise<boolean> {
    if (!(await writeRaw($state.snapshot(next)))) return false;
    _config = next;
    _loaded = true;
    return true;
}

/** Snapshot of the current values for components that bind to them. */
export function getAppConfig() {
    return {
        get identity() {
            return _config.identity;
        },
        get gitConfigs() {
            return _config.git.configs;
        },
        get data() {
            return _config.data;
        },
        get catalogSets() {
            return _config.catalogs.sets;
        },
        get loaded() {
            return _loaded;
        },
        async load() {
            await loadAppConfig();
        },
        async setIdentity(patch: Partial<AppIdentityConfig>) {
            await persist({
                ..._config,
                identity: { ..._config.identity, ...patch },
            });
        },
        async setData(patch: Partial<AppDataConfig>) {
            await persist({ ..._config, data: { ..._config.data, ...patch } });
        },
        /** Replace the todo-attribute configuration library wholesale. */
        async setCatalogSets(sets: CatalogSet[]) {
            await persist({
                ..._config,
                catalogs: { sets: normalizeCatalogSets({ sets }) },
            });
        },
        /**
         * Replace the Git configuration library wholesale.
         *
         * Whole-list writes (rather than per-entry mutations) keep references
         * consistent in a single write: a deleted or re-pointed entry can never
         * be half-applied on disk.
         */
        async setGitConfigs(configs: GitConfigEntry[]) {
            await persist({
                ..._config,
                git: { configs: normalizeGitConfigs(configs) },
            });
        },
    };
}

/**
 * Author name for anything that records "who did this".
 *
 * Replaces the per-view `SettingsRepo.getSettings(db).author_name || "…"`
 * blocks, which each re-read a workspace-scoped value that was never editable.
 */
export async function resolveAuthorName(fallback = 'Anonymous'): Promise<string> {
    await loadAppConfig();
    return _config.identity.author_name.trim() || fallback;
}

/** Synchronous read for hot paths that already awaited `loadAppConfig()`. */
export function authorNameNow(): string {
    return _config.identity.author_name.trim();
}

/**
 * Resolve a workspace's Git reference into everything the engine needs.
 *
 * The branch is deliberately absent: it belongs to the workspace that chose it,
 * not to the connection. Returns `null` when the reference is missing or
 * dangling, which the sync engine reports as "not configured" rather than
 * authenticating with whatever credential happens to be around.
 */
export function resolveGitReference(
    gitConfigId: string | null | undefined,
): ResolvedGitReference | null {
    const config = findGitConfig(_config.git.configs, gitConfigId);
    if (!config) return null;

    return {
        remote_url: config.remote_url,
        git_name: config.git_name,
        git_email: config.git_email,
        access_token: config.token.trim(),
    };
}

/**
 * One-time (idempotent) adoption of workspace-scoped Git settings into the
 * app-level library, then erasure of the workspace copies.
 *
 * Runs on every workspace open, so pre-existing workspaces heal themselves:
 *
 *   - the workspace's remote, commit identity and credential become one Git
 *     configuration it then references, so an existing setup keeps working with
 *     no manual step;
 *   - the **branch stays in the workspace**: it was never part of the
 *     connection, and this workspace's choice of branch must not be overwritten;
 *   - the legacy columns are cleared afterwards. Clearing is what actually
 *     closes the leak — a stale copy would also re-create the "two sources of
 *     truth" problem this move exists to remove.
 *
 * The columns are kept in the schema (dropping them needs a table rebuild); they
 * are simply never read or written again.
 */
export async function adoptWorkspaceSettings(db: Database): Promise<void> {
    await loadAppConfig();

    let dbAuthor = '';
    let dbRemoteUrl = '';
    let dbGitName = '';
    let dbGitEmail = '';
    let dbToken = '';
    let dbGitConfigId = '';

    try {
        const rows = await db.select<{ author_name: string }[]>(
            `SELECT author_name FROM app_settings WHERE id = 1`,
        );
        dbAuthor = str(rows[0]?.author_name);
    } catch {
        // Pre-migration workspace, or the table is gone. Nothing to adopt.
    }

    try {
        const rows = await db.select<
            {
                remote_url: string;
                access_token: string;
                git_name: string;
                git_email: string;
                git_config_id: string;
            }[]
        >(
            `SELECT remote_url, access_token, git_name, git_email, git_config_id
               FROM sync_config WHERE id = 1`,
        );
        dbRemoteUrl = str(rows[0]?.remote_url);
        dbToken = str(rows[0]?.access_token);
        dbGitName = str(rows[0]?.git_name);
        dbGitEmail = str(rows[0]?.git_email);
        dbGitConfigId = str(rows[0]?.git_config_id);
    } catch {
        // Same as above.
    }

    const identity = { ..._config.identity };
    const configs = _config.git.configs;
    let nextGitConfigId = dbGitConfigId;

    if (!identity.author_name && dbAuthor) identity.author_name = dbAuthor;

    // A connection left in the workspace becomes a named configuration, so an
    // existing setup survives the change to a reference with nothing to
    // re-enter. The credential may be in the database (original shape) or
    // already lifted into the app config (the shape before this one).
    if (!findGitConfig(configs, nextGitConfigId) && dbRemoteUrl) {
        const adopted = createGitConfig({
            name: LEGACY_CONFIG_NAME,
            remote_url: dbRemoteUrl,
            git_name: identity.git_name || dbGitName,
            git_email: identity.git_email || dbGitEmail,
            token: dbToken || _legacyCredential,
        });
        nextGitConfigId = adopted.id;

        const saved = await persist({
            ..._config,
            identity,
            git: { configs: [...configs, adopted] },
        });
        if (!saved) {
            // Could not persist: keep the workspace copies as the only source
            // rather than deleting the user's connection outright.
            console.warn(
                '[app-config] adoption not persisted; workspace copies kept',
            );
            return;
        }
        _legacyCredential = '';
    } else if (identity.author_name !== _config.identity.author_name) {
        await persist({ ..._config, identity });
    }

    if (nextGitConfigId && nextGitConfigId !== dbGitConfigId) {
        try {
            await db.execute(
                `UPDATE sync_config SET git_config_id = ? WHERE id = 1`,
                [nextGitConfigId],
            );
        } catch {
            // Column missing on an un-migrated workspace; the next open retries.
        }
    }

    await clearWorkspaceCopies(db);

    // The todo-attribute reference is adopted after the connection: both write
    // the app config, and a single writer keeps that file honest.
    await adoptCatalogReference(db);
}

/**
 * Point an unreferenced workspace at the product's built-in configuration.
 *
 * That is what the reference means by default: the rows a workspace is seeded
 * with *are* the built-in, so referencing it starts a workspace out honest — no
 * difference to report and nothing invented. If the workspace has since drifted
 * (extra types, renamed levels, its own tags) the reference page says so, and the
 * user decides whether to push the drift up or pull the built-in down.
 *
 * Nothing is written to the app config here: the built-in is a view of the app's
 * own defaults, not a stored row.
 */
async function adoptCatalogReference(db: Database): Promise<void> {
    try {
        const found = await db.select<{ catalog_set_id: string }[]>(
            `SELECT catalog_set_id FROM workspace_meta WHERE id = 1`,
        );
        if (str(found[0]?.catalog_set_id)) return;

        await db.execute(
            `UPDATE workspace_meta SET catalog_set_id = ? WHERE id = 1`,
            [BUILTIN_CATALOG_SET_ID],
        );
    } catch {
        // Pre-migration workspace (no column yet); the next open retries once the
        // migration has run.
    }
}

/**
 * Removes the connection and identity from the workspace database.
 *
 * `branch` is deliberately **not** cleared: it is a live, workspace-scoped
 * setting now.
 */
async function clearWorkspaceCopies(db: Database): Promise<void> {
    try {
        await db.execute(
            `UPDATE sync_config
                SET remote_url = '', access_token = '', git_name = '', git_email = ''
              WHERE id = 1
                AND (remote_url <> '' OR access_token <> ''
                     OR git_name <> '' OR git_email <> '')`,
        );
    } catch {
        // Column set from an older schema, or no sync_config row yet.
    }

    try {
        await db.execute(
            `UPDATE app_settings SET author_name = ''
              WHERE id = 1 AND author_name <> ''`,
        );
    } catch {
        // Nothing to clear.
    }
}
