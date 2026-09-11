import type Database from '@tauri-apps/plugin-sql';
import { save, open } from '@tauri-apps/plugin-dialog';
import { documentDir } from '@tauri-apps/api/path';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import type { PushTarget, CreatePushTargetInput } from './types';
import { PushTargetRepo } from './push-target.repo';
import { parseSuccessCheck, serializeSuccessCheck } from './success-check';

// ─────────────────────────────────────────────────────────────────────────────
// Push target configuration import / export.
//
// The exported file is a plain, human-editable JSON document. Runtime-only
// fields (id, timestamps, last push time) are deliberately omitted so the file
// can be committed to version control and shared between machines.
// ─────────────────────────────────────────────────────────────────────────────

export const EXPORT_KIND = 'worklog.push-targets';
export const EXPORT_VERSION = 1;

/** A target configuration without any local/runtime state. */
export interface PortablePushTarget {
    name: string;
    description: string;
    endpoint_url: string;
    http_method: string;
    headers: string;
    body_template: string;
    body_content_type: string;
    field_mapping: string;
    payload_fields: string;
    query_params: string;
    variables: string;
    source_config: string;
    /** JSON PushSuccessCheck; empty string means "any 2xx counts". */
    success_check: string;
    timeout_ms: number;
    retry_count: number;
    enabled: number;
}

export interface PushTargetExportFile {
    kind: string;
    version: number;
    exported_at: string;
    app: string;
    targets: PortablePushTarget[];
}

export interface PushImportSummary {
    created: number;
    updated: number;
    skipped: number;
    names: string[];
}

// ── Serialisation ────────────────────────────────────────────────────────────

export function toPortable(target: PushTarget): PortablePushTarget {
    return {
        name: target.name,
        description: target.description ?? '',
        endpoint_url: target.endpoint_url,
        http_method: target.http_method || 'POST',
        headers: target.headers || '{}',
        body_template: target.body_template ?? '',
        body_content_type: target.body_content_type || 'application/json',
        field_mapping: target.field_mapping || '{}',
        payload_fields: target.payload_fields || '[]',
        query_params: target.query_params || '[]',
        variables: target.variables || '[]',
        source_config: target.source_config ?? '',
        success_check: target.success_check ?? '',
        timeout_ms: target.timeout_ms ?? 30000,
        retry_count: target.retry_count ?? 0,
        enabled: target.enabled ?? 1,
    };
}

export function serializeTargets(targets: PushTarget[]): string {
    const doc: PushTargetExportFile = {
        kind: EXPORT_KIND,
        version: EXPORT_VERSION,
        exported_at: new Date().toISOString(),
        app: 'Worklog',
        targets: targets.map(toPortable),
    };
    return JSON.stringify(doc, null, 2);
}

// ── Parsing / validation ─────────────────────────────────────────────────────

function asString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Accept either a JSON string or an already-parsed object, and store it as a
 * string. Invalid JSON falls back to `fallback` so a hand-edited file with a
 * typo cannot poison the configuration.
 */
function asJsonString(value: unknown, fallback: string): string {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return fallback;
        try {
            JSON.parse(trimmed);
            return trimmed;
        } catch {
            return fallback;
        }
    }
    if (value !== null && value !== undefined && typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return fallback;
        }
    }
    return fallback;
}

/**
 * Validate and normalise one imported target.
 * Returns null when the entry is unusable (no name or no endpoint URL).
 */
export function sanitizePortable(raw: unknown): PortablePushTarget | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;

    const name = asString(o.name).trim();
    const endpoint_url = asString(o.endpoint_url).trim();
    if (!name || !endpoint_url) return null;

    return {
        name,
        description: asString(o.description),
        endpoint_url,
        http_method: asString(o.http_method, 'POST') || 'POST',
        headers: asJsonString(o.headers, '{}'),
        body_template: asString(o.body_template),
        body_content_type: asString(o.body_content_type, 'application/json'),
        field_mapping: asJsonString(o.field_mapping, '{}'),
        payload_fields: asJsonString(o.payload_fields, '[]'),
        query_params: asJsonString(o.query_params, '[]'),
        variables: asJsonString(o.variables, '[]'),
        source_config: asJsonString(o.source_config, ''),
        // Round-trip through the parser so a hand edited file with a broken rule
        // degrades to "no rule" instead of poisoning every future push.
        success_check: serializeSuccessCheck(
            parseSuccessCheck(asString(o.success_check, '')),
        ),
        timeout_ms: asNumber(o.timeout_ms, 30000),
        retry_count: asNumber(o.retry_count, 0),
        enabled: o.enabled === 0 || o.enabled === false ? 0 : 1,
    };
}

/**
 * Parse an exported document. Accepts three shapes so hand-written files are
 * easy to produce:
 *   1. { kind, version, targets: [...] }   — the full export envelope
 *   2. [ {...}, {...} ]                    — a bare array of targets
 *   3. { name, endpoint_url, ... }         — a single target
 */
export function parseImportFile(content: string): PortablePushTarget[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        throw new Error(
            `配置文件不是合法的 JSON：${e instanceof Error ? e.message : String(e)}`,
        );
    }

    let entries: unknown[];

    if (Array.isArray(parsed)) {
        entries = parsed;
    } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.targets)) {
            entries = obj.targets;
        } else if (obj.name !== undefined || obj.endpoint_url !== undefined) {
            entries = [obj];
        } else {
            throw new Error('无法识别的配置文件：缺少 targets 数组');
        }
    } else {
        throw new Error('无法识别的配置文件结构');
    }

    const out: PortablePushTarget[] = [];
    for (const entry of entries) {
        const clean = sanitizePortable(entry);
        if (clean) out.push(clean);
    }
    return out;
}

// ── File IO ──────────────────────────────────────────────────────────────────

function safeFileName(name: string): string {
    const cleaned = name
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .trim();
    return cleaned || 'push-target';
}

/**
 * Prompt for a location and write the given targets as JSON.
 * @returns true when written, false when the user cancelled.
 */
export async function exportPushTargetsToFile(
    targets: PushTarget[],
    fileBaseName: string,
    dialogTitle: string,
    filterName: string,
): Promise<boolean> {
    if (targets.length === 0) return false;

    let defaultPath = `${safeFileName(fileBaseName)}.json`;
    try {
        const documentsPath = await documentDir();
        defaultPath = `${documentsPath}/${safeFileName(fileBaseName)}.json`;
    } catch {
        // Fall back to a bare filename when the documents dir is unavailable.
    }

    const filePath = await save({
        title: dialogTitle,
        defaultPath,
        filters: [{ name: filterName, extensions: ['json'] }],
    });

    if (!filePath) return false;

    await writeTextFile(filePath, serializeTargets(targets));
    return true;
}

/**
 * Prompt for a JSON file and read its contents.
 * @returns the parsed targets, or null when the user cancelled.
 */
export async function pickImportFile(
    dialogTitle: string,
    filterName: string,
): Promise<PortablePushTarget[] | null> {
    const selected = await open({
        title: dialogTitle,
        multiple: false,
        directory: false,
        filters: [{ name: filterName, extensions: ['json'] }],
    });

    if (!selected) return null;

    const filePath = selected as string;
    const content = await readTextFile(filePath);
    return parseImportFile(content);
}

// ── Apply to the database ────────────────────────────────────────────────────

/**
 * Import targets into the workspace.
 *
 * Matching is by name: an existing target with the same name is overwritten in
 * place (so re-importing an edited export applies the change), while a new name
 * creates a fresh target. Nothing is ever deleted.
 */
export async function applyImport(
    db: Database,
    incoming: PortablePushTarget[],
): Promise<PushImportSummary> {
    const existing = await PushTargetRepo.list(db);
    const byName = new Map(existing.map((t) => [t.name.trim(), t]));

    const summary: PushImportSummary = {
        created: 0,
        updated: 0,
        skipped: 0,
        names: [],
    };

    for (const item of incoming) {
        const payload: CreatePushTargetInput = { ...item };
        const match = byName.get(item.name.trim());

        if (match) {
            await PushTargetRepo.update(db, match.id, payload);
            summary.updated += 1;
            summary.names.push(`${item.name}（更新）`);
        } else {
            const created = await PushTargetRepo.create(db, payload);
            byName.set(item.name.trim(), created);
            summary.created += 1;
            summary.names.push(item.name);
        }
    }

    return summary;
}
