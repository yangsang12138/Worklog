/**
 * Git configurations — the app-level library of *named, self-contained
 * connections*.
 *
 * A "Git configuration" answers the whole question of how to reach a repository
 * as one portable unit: where it is, who commits are signed as, and the token
 * that authenticates (see `./tokens.ts`). A workspace does not re-enter any of
 * that; it **references** one of these.
 *
 * What is deliberately **not** here: the **branch**. Which line of history to
 * sync is a decision the team shares, and it changes per workspace — the same
 * repository can be synced on `main` in one workspace and a release branch in
 * another. So the branch lives with the workspace that makes that choice, not in
 * a connection definition that several workspaces point at.
 *
 * Being self-contained is what makes a configuration *copyable*: duplicate it,
 * export it to a file, import it on another machine — each is one unit, with no
 * dangling reference to a shared credential pool to carry along.
 *
 * Nothing here changes when a workspace opens or a sync runs: these are
 * resources, not state.
 *
 * This module has **no runtime imports** except the token helpers, so it can be
 * unit-tested with plain Node and shared verbatim by the sync engine and the UI.
 */

// Explicit extension: this module is imported directly by plain-Node tests, and
// Node's ESM resolver does not guess extensions (`allowImportingTsExtensions` is
// on for exactly this reason).
import { normalizeIsoDate } from './tokens.ts';

export interface GitConfigEntry {
    /** Stable id — this is what a workspace stores instead of the fields. */
    id: string;
    /** Human label, e.g. "团队仓库" or "Personal". */
    name: string;
    /** Free note: what this connection is for. */
    description: string;
    /** HTTPS URL of the repository. */
    remote_url: string;
    /** Commit identity used inside the sync repository. */
    git_name: string;
    git_email: string;
    /**
     * The credential, part of the configuration rather than a shared pool. A
     * pasted trailing newline is a silent authentication failure, so it is
     * trimmed on the way in.
     */
    token: string;
    /** ISO date the token stops working, or null when nothing was recorded. */
    token_expires_at: string | null;
}

/** File format version for exported configurations. */
export const GIT_CONFIG_FILE_VERSION = 1;

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function newGitConfigId(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 6; i += 1) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `GIT-${suffix}`;
}

export function createGitConfig(
    patch: Partial<GitConfigEntry> = {},
): GitConfigEntry {
    const id = str(patch.id);

    return {
        id: id.length > 0 ? id : newGitConfigId(),
        // Labels are trimmed too: they are typed into forms and shown in
        // pickers, where stray padding only ever looks wrong.
        name: str(patch.name).trim(),
        description: str(patch.description).trim(),
        remote_url: str(patch.remote_url).trim(),
        git_name: str(patch.git_name).trim(),
        git_email: str(patch.git_email).trim(),
        token: str(patch.token).trim(),
        token_expires_at: normalizeIsoDate(patch.token_expires_at),
    };
}

/**
 * Coerce whatever is on disk into a usable list.
 *
 * Entries without a remote URL are dropped for the same reason a configuration
 * without one is unusable: it is a half-filled form, and kept as a row it would
 * only ever be noise. The UI holds such a draft until it is saved.
 */
export function normalizeGitConfigs(raw: unknown): GitConfigEntry[] {
    if (!Array.isArray(raw)) return [];

    const seen = new Set<string>();
    const configs: GitConfigEntry[] = [];

    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;

        const config = createGitConfig(entry as Partial<GitConfigEntry>);
        if (!config.remote_url) continue;
        // Ids must be unique, or a reference to one becomes ambiguous.
        if (seen.has(config.id)) config.id = newGitConfigId();
        seen.add(config.id);
        configs.push(config);
    }

    return configs;
}

export function findGitConfig(
    configs: GitConfigEntry[],
    id: string | null | undefined,
): GitConfigEntry | null {
    if (!id) return null;
    return configs.find((entry) => entry.id === id) ?? null;
}

/**
 * A copy of a configuration: same connection, new identity.
 *
 * The name is copied verbatim rather than suffixed with "(copy)": a stored label
 * is user data, and inventing one would bake the UI language into it. The copy
 * opens in the detail view, so renaming is the first thing in reach.
 */
export function duplicateGitConfig(entry: GitConfigEntry): GitConfigEntry {
    return createGitConfig({ ...entry, id: newGitConfigId() });
}

/**
 * Whether a URL is one the sync engine can actually drive.
 *
 * Shared with the engine on purpose: the UI must not offer a configuration the
 * engine will refuse. Sync is implemented over `git` with an HTTPS remote and a
 * token in the URL, so SSH remotes and other hosts are not supported yet.
 */
export function isSupportedRemoteUrl(value: string): boolean {
    try {
        const url = new URL(value);
        const pathParts = url.pathname.split('/').filter(Boolean);
        return (
            url.protocol === 'https:' &&
            url.hostname === 'github.com' &&
            pathParts.length >= 2
        );
    } catch {
        return false;
    }
}

/** A short, human-readable form of a remote for lists: `owner/repo`. */
export function describeRemote(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';

    try {
        const url = new URL(trimmed);
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
        }
        return url.hostname;
    } catch {
        return trimmed;
    }
}

export type GitConfigStatus =
    | 'ready'
    | 'no-remote'
    | 'unsupported-remote'
    | 'no-token';

/**
 * Whether a configuration can be used to sync, and if not, what is missing.
 *
 * Reported in the list so an unusable configuration reads as unusable *before* a
 * sync fails — the alternative is an authentication error nobody can attribute
 * to a missing token.
 */
export function gitConfigStatus(config: GitConfigEntry): GitConfigStatus {
    if (!config.remote_url) return 'no-remote';
    if (!isSupportedRemoteUrl(config.remote_url)) return 'unsupported-remote';
    if (config.token.length === 0) return 'no-token';
    return 'ready';
}

// ── Portability: copy a configuration to a file, or in from one ───────────

/** The documented shape of an exported file. */
export interface GitConfigFile {
    version: number;
    exported_at: string;
    /** Whether the file carries credentials — stated so a user can tell. */
    includes_secrets: boolean;
    configs: GitConfigEntry[];
}

/**
 * Serialise configurations for export.
 *
 * `includeSecrets: false` strips the token **and its expiry**: the expiry
 * documents the exporter's credential, which means nothing to whoever receives
 * the file. The result is safe to share and still carries everything needed to
 * reconnect (address, identity, description).
 */
export function serializeGitConfigs(
    configs: GitConfigEntry[],
    options: { includeSecrets: boolean },
): string {
    const exported = configs.map((entry) =>
        options.includeSecrets
            ? createGitConfig(entry)
            : createGitConfig({
                  ...entry,
                  token: '',
                  token_expires_at: null,
              }),
    );

    const file: GitConfigFile = {
        version: GIT_CONFIG_FILE_VERSION,
        exported_at: new Date().toISOString(),
        includes_secrets: options.includeSecrets,
        configs: exported,
    };

    return `${JSON.stringify(file, null, 2)}\n`;
}

export type GitConfigImportResult =
    | { ok: true; configs: GitConfigEntry[]; includesSecrets: boolean }
    | { ok: false; reason: 'invalid-json' | 'unsupported-version' | 'no-configs' };

/**
 * Parse an exported file.
 *
 * Every imported entry gets a **fresh id**: importing is additive, and silently
 * overwriting an existing configuration because two machines happened to export
 * the same id would be indistinguishable from the import doing nothing.
 */
export function deserializeGitConfigs(raw: string): GitConfigImportResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, reason: 'invalid-json' };
    }

    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, reason: 'invalid-json' };
    }

    const file = parsed as Partial<GitConfigFile>;

    // Accept a bare array too: it is what someone hand-writes when sharing one
    // configuration between machines.
    const rawConfigs = Array.isArray(parsed) ? parsed : file.configs;
    if (!Array.isArray(rawConfigs)) {
        return { ok: false, reason: 'invalid-json' };
    }

    if (
        !Array.isArray(parsed) &&
        file.version !== undefined &&
        file.version !== GIT_CONFIG_FILE_VERSION
    ) {
        return { ok: false, reason: 'unsupported-version' };
    }

    const configs: GitConfigEntry[] = [];
    for (const entry of rawConfigs) {
        if (!entry || typeof entry !== 'object') continue;
        const config = createGitConfig(entry as Partial<GitConfigEntry>);
        if (!config.remote_url) continue;
        config.id = newGitConfigId();
        configs.push(config);
    }

    if (configs.length === 0) return { ok: false, reason: 'no-configs' };

    return {
        ok: true,
        configs,
        includesSecrets: file.includes_secrets === true,
    };
}

/**
 * Read the library out of whatever the config file holds, adopting earlier
 * shapes.
 *
 * Three generations exist:
 *   1. now — a configuration carries its own token;
 *   2. a short-lived one where configurations referenced a shared credential
 *      pool by `token_id`, so the referenced entry is merged in;
 *   3. the original single top-level `github_token`.
 *
 * A pool entry that no configuration referenced is *not* carried over: there is
 * no configuration it belongs to, and this shape has nowhere to keep a loose
 * credential.
 */
export function adoptGitLibrary(
    raw: unknown,
    legacyPool?: unknown,
): GitConfigEntry[] {
    const source = (raw ?? {}) as {
        configs?: unknown;
        tokens?: unknown;
        github_token?: unknown;
    };

    // The pool has to be passed in: it used to live under `credentials.tokens`,
    // *outside* the `git` object, so looking for it only here silently dropped
    // every referenced token on upgrade — a configuration would come back with
    // no credential at all.
    const poolSource = Array.isArray(legacyPool)
        ? legacyPool
        : Array.isArray(source.tokens)
          ? source.tokens
          : [];
    const pool = poolSource as Record<string, unknown>[];
    const entries = Array.isArray(source.configs) ? source.configs : [];

    const configs: GitConfigEntry[] = [];

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const tokenId = str(record.token_id).trim();

        const referenced = tokenId
            ? pool.find((item) => item && str(item.id) === tokenId)
            : undefined;

        const config = createGitConfig({
            ...(record as Partial<GitConfigEntry>),
            token: str(record.token) || str(referenced?.token),
            // Both are `unknown` from the file; the normaliser decides what is a
            // usable date.
            token_expires_at: normalizeIsoDate(
                record.token_expires_at ?? referenced?.expires_at,
            ),
        });
        if (config.remote_url) configs.push(config);
    }

    // Nothing is invented for a credential that no configuration referenced:
    // generation 3 (one token, no library yet) is adopted by the caller, which
    // is the only place that knows which workspace it belonged to.
    return configs;
}

/** Any credential left in an older shape, so the caller can still adopt it. */
export function legacyToken(raw: unknown): string {
    const source = (raw ?? {}) as {
        tokens?: unknown;
        github_token?: unknown;
    };

    const bare = str(source.github_token).trim();
    if (bare) return bare;

    const pool = Array.isArray(source.tokens)
        ? (source.tokens as Record<string, unknown>[])
        : [];
    return str(pool[0]?.token).trim();
}
