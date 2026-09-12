import type { Ticket } from '$lib/components/app/types';
import {
    TICKET_STATUS_CONFIG,
    TICKET_PRIORITY_CONFIG,
    TICKET_TYPE_CONFIG,
} from '$lib/components/app/types';
import type {
    PushContext,
    PushVariableDef,
    PushVariableValue,
    FieldBinding,
    FieldSourceKind,
    ConstantValueType,
    PushSourceConfig,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Field Catalog — the abstracted set of values a remote target may consume.
//
// Three namespaces are exposed:
//   ticket.*  — everything on the Worklog ticket (raw + derived helpers)
//   board.*   — the board the ticket lives in
//   app.*     — workspace / application level values
//
// Targets reference these by stable string key (see FieldBinding.field).
// Both the settings UI (dropdown) and the push engine (resolution) read from
// this single source of truth.
// ─────────────────────────────────────────────────────────────────────────────

export type CatalogGroup = 'ticket' | 'board' | 'app';

export type CatalogValueType =
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'array'
    | 'markdown';

export interface CatalogField {
    /** Stable key, e.g. "ticket.title" */
    key: string;
    group: CatalogGroup;
    value_type: CatalogValueType;
    /** i18n message key for the label */
    label_key: string;
    /** Fallback label (zh-CN) used when the message lookup is unavailable */
    label: string;
    /** Optional note shown next to the field in the picker */
    hint?: string;
}

export const FIELD_CATALOG: CatalogField[] = [
    // ── Ticket: identity & content ───────────────────────────────────────────
    {
        key: 'ticket.id',
        group: 'ticket',
        value_type: 'string',
        label_key: 'push_field_ticket_id',
        label: '待办 ID',
        hint: '如 TKT-00UB68',
    },
    {
        key: 'ticket.title',
        group: 'ticket',
        value_type: 'string',
        label_key: 'push_field_ticket_title',
        label: '标题',
    },
    {
        key: 'ticket.description',
        group: 'ticket',
        value_type: 'markdown',
        label_key: 'push_field_ticket_description',
        label: '描述',
        hint: '支持 Markdown 原文',
    },

    // ── Ticket: classification (code + display label) ────────────────────────
    {
        key: 'ticket.status',
        group: 'ticket',
        value_type: 'string',
        label_key: 'push_field_ticket_status',
        label: '状态（代码）',
        hint: 'backlog / todo / in_progress / done',
    },
    {
        key: 'ticket.status_label',
        group: 'ticket',
        value_type: 'string',
        label_key: 'push_field_ticket_status_label',
        label: '状态（名称）',
    },
    {
        key: 'ticket.priority',
        group: 'ticket',
        value_type: 'string',
        label_key: 'push_field_ticket_priority',
        label: '优先级（代码）',
        hint: 'p1 / p2 / p3',
    },
    {
        key: 'ticket.priority_label',
        group: 'ticket',
        value_type: 'string',
        label_key: 'push_field_ticket_priority_label',
        label: '优先级（名称）',
    },
    {
        key: 'ticket.ticket_type',
        group: 'ticket',
        value_type: 'string',
        label_key: 'push_field_ticket_type',
        label: '待办类型（代码）',
    },
    {
        key: 'ticket.ticket_type_label',
        group: 'ticket',
        value_type: 'string',
        label_key: 'push_field_ticket_type_label',
        label: '待办类型（名称）',
    },

    // ── Ticket: labels & dates ───────────────────────────────────────────────
    {
        key: 'ticket.labels',
        group: 'ticket',
        value_type: 'array',
        label_key: 'push_field_ticket_labels',
        label: '标签（数组）',
    },
    {
        key: 'ticket.labels_text',
        group: 'ticket',
        value_type: 'string',
        label_key: 'push_field_ticket_labels_text',
        label: '标签（逗号拼接）',
    },
    {
        key: 'ticket.start_date',
        group: 'ticket',
        value_type: 'date',
        label_key: 'push_field_ticket_start_date',
        label: '开始日期',
    },
    {
        key: 'ticket.due_date',
        group: 'ticket',
        value_type: 'date',
        label_key: 'push_field_ticket_due_date',
        label: '截止日期',
    },
    {
        key: 'ticket.created_at',
        group: 'ticket',
        value_type: 'datetime',
        label_key: 'push_field_ticket_created_at',
        label: '创建时间',
    },
    {
        key: 'ticket.updated_at',
        group: 'ticket',
        value_type: 'datetime',
        label_key: 'push_field_ticket_updated_at',
        label: '更新时间',
    },

    // ── Ticket: derived helpers ──────────────────────────────────────────────
    {
        key: 'ticket.comments_count',
        group: 'ticket',
        value_type: 'number',
        label_key: 'push_field_ticket_comments_count',
        label: '评论数',
    },
    {
        key: 'ticket.comments_text',
        group: 'ticket',
        value_type: 'string',
        label_key: 'push_field_ticket_comments_text',
        label: '评论内容',
        hint: '按“作者: 内容”拼接',
    },
    {
        key: 'ticket.is_overdue',
        group: 'ticket',
        value_type: 'boolean',
        label_key: 'push_field_ticket_is_overdue',
        label: '是否逾期',
    },
    {
        key: 'ticket.position',
        group: 'ticket',
        value_type: 'number',
        label_key: 'push_field_ticket_position',
        label: '排序位置',
    },

    // ── Board ────────────────────────────────────────────────────────────────
    {
        key: 'board.id',
        group: 'board',
        value_type: 'string',
        label_key: 'push_field_board_id',
        label: '看板 ID',
    },
    {
        key: 'board.name',
        group: 'board',
        value_type: 'string',
        label_key: 'push_field_board_name',
        label: '看板名称',
    },
    {
        key: 'board.description',
        group: 'board',
        value_type: 'string',
        label_key: 'push_field_board_description',
        label: '看板描述',
    },

    // ── App / workspace ──────────────────────────────────────────────────────
    {
        key: 'app.workspace_name',
        group: 'app',
        value_type: 'string',
        label_key: 'push_field_app_workspace_name',
        label: '工作区名称',
    },
    {
        key: 'app.author_name',
        group: 'app',
        value_type: 'string',
        label_key: 'push_field_app_author_name',
        label: '当前用户',
        hint: '来自设置中的作者名',
    },
    {
        key: 'app.version',
        group: 'app',
        value_type: 'string',
        label_key: 'push_field_app_version',
        label: 'Worklog 版本',
    },
    {
        key: 'app.pushed_at',
        group: 'app',
        value_type: 'datetime',
        label_key: 'push_field_app_pushed_at',
        label: '推送时间',
        hint: '本次推送发生的时间',
    },
];

const CATALOG_BY_KEY = new Map(FIELD_CATALOG.map((f) => [f.key, f]));

export function getCatalogField(key: string): CatalogField | undefined {
    return CATALOG_BY_KEY.get(key);
}

export function catalogByGroup(group: CatalogGroup): CatalogField[] {
    return FIELD_CATALOG.filter((f) => f.group === group);
}

/** Human label for a catalog key, falling back to the key itself. */
export function catalogLabel(key: string): string {
    return CATALOG_BY_KEY.get(key)?.label ?? key;
}

// ── Value resolution ─────────────────────────────────────────────────────────

function isTicketOverdue(ticket: Ticket): boolean {
    if (!ticket.due_date || ticket.status === 'done') return false;
    const due = new Date(ticket.due_date);
    due.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return due < now;
}

/**
 * Resolve a catalog key to its current value for the given push context.
 * Returns undefined when the key is unknown.
 */
export function resolveCatalogValue(
    key: string,
    ctx: PushContext,
): unknown {
    const t = ctx.ticket;
    const b = ctx.board;
    const a = ctx.app;

    switch (key) {
        case 'ticket.id':
            return t.id;
        case 'ticket.title':
            return t.title;
        case 'ticket.description':
            return t.description;

        case 'ticket.status':
            return t.status;
        case 'ticket.status_label': {
            // A custom column's name lives on the board, not here — fall back
            // to the raw status rather than losing the value.
            const builtin =
                TICKET_STATUS_CONFIG[t.status as keyof typeof TICKET_STATUS_CONFIG];
            return builtin?.label ?? t.status;
        }
        case 'ticket.priority':
            return t.priority;
        case 'ticket.priority_label':
            return TICKET_PRIORITY_CONFIG[t.priority]?.label ?? t.priority;
        case 'ticket.ticket_type':
            return t.ticket_type;
        case 'ticket.ticket_type_label':
            return TICKET_TYPE_CONFIG[t.ticket_type]?.label ?? t.ticket_type;

        case 'ticket.labels':
            return t.labels ?? [];
        case 'ticket.labels_text':
            return (t.labels ?? []).join(', ');
        case 'ticket.start_date':
            return t.start_date;
        case 'ticket.due_date':
            return t.due_date;
        case 'ticket.created_at':
            return t.created_at;
        case 'ticket.updated_at':
            return t.updated_at;

        case 'ticket.comments_count':
            return (t.comments ?? []).length;
        case 'ticket.comments_text':
            return (t.comments ?? [])
                .map((c) => `${c.author}: ${c.body}`)
                .join('\n\n');
        case 'ticket.is_overdue':
            return isTicketOverdue(t);
        case 'ticket.position':
            return t.position;

        case 'board.id':
            return b?.id ?? null;
        case 'board.name':
            return b?.name ?? null;
        case 'board.description':
            return b?.description ?? null;

        case 'app.workspace_name':
            return a?.workspace_name ?? '';
        case 'app.author_name':
            return a?.author_name ?? '';
        case 'app.version':
            return a?.version ?? '';
        case 'app.pushed_at':
            return new Date().toISOString();

        default:
            return undefined;
    }
}

// ── Binding helpers ──────────────────────────────────────────────────────────

/** Coerce a literal constant string according to its declared type. */
export function coerceConstant(
    raw: string | undefined,
    type: ConstantValueType = 'string',
): unknown {
    if (raw === undefined) return undefined;

    switch (type) {
        case 'null':
            return null;

        case 'number': {
            const n = Number(raw);
            return Number.isFinite(n) ? n : raw;
        }

        case 'integer': {
            const n = Number.parseInt(raw, 10);
            return Number.isFinite(n) ? n : raw;
        }

        case 'boolean':
            return raw === 'true' || raw === '1' || raw === 'yes';

        case 'object':
        case 'json':
        case 'array': {
            try {
                return JSON.parse(raw);
            } catch {
                return type === 'array' ? [] : {};
            }
        }

        // date / datetime / time / template are all transmitted as strings;
        // `template` additionally has its {{variable}} placeholders expanded
        // by the engine before sending.
        case 'date':
        case 'datetime':
        case 'time':
        case 'template':
        case 'string':
        default:
            return raw;
    }
}

// ── Editor scope configuration ───────────────────────────────────────────────

/** All source kinds, in the order they are offered in the editor. */
export const ALL_FIELD_SOURCES: FieldSourceKind[] = [
    'ticket',
    'board',
    'app',
    'constant',
    'variable',
    'mapped',
];

/** Catalog group a given source kind draws its fields from. */
export function groupForSource(kind: FieldSourceKind): CatalogGroup | null {
    switch (kind) {
        case 'ticket':
        case 'mapped':
            // Value mapping is aimed at the ticket's enum-ish fields.
            return 'ticket';
        case 'board':
            return 'board';
        case 'app':
            return 'app';
        default:
            return null;
    }
}

/** Every catalog key, grouped by namespace. */
export function allCatalogKeysByGroup(): Record<string, string[]> {
    const out: Record<string, string[]> = { ticket: [], board: [], app: [] };
    for (const f of FIELD_CATALOG) {
        out[f.group].push(f.key);
    }
    return out;
}

/** Configuration with everything switched on. */
export function defaultSourceConfig(): PushSourceConfig {
    return {
        enabled_sources: [...ALL_FIELD_SOURCES],
        enabled_fields: allCatalogKeysByGroup(),
        enabled_variables: [],
    };
}

/**
 * Parse a stored source config, filling in anything that is missing.
 *
 * `variables` is used to seed the variable allow-list: a config saved before
 * this option existed (or with the key absent) enables every defined variable,
 * while an explicitly empty list means "offer none".
 */
export function parseSourceConfig(
    raw: string | null | undefined,
    variables: PushVariableDef[] = [],
): PushSourceConfig {
    const allVariableKeys = variables.map((v) => v.key).filter(Boolean);

    const fallback: PushSourceConfig = {
        enabled_sources: [...ALL_FIELD_SOURCES],
        enabled_fields: allCatalogKeysByGroup(),
        enabled_variables: [...allVariableKeys],
    };

    if (!raw) return fallback;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return fallback;
    }
    if (!parsed || typeof parsed !== 'object') return fallback;

    const obj = parsed as Partial<PushSourceConfig>;

    const enabled_sources = Array.isArray(obj.enabled_sources)
        ? obj.enabled_sources.filter((s): s is FieldSourceKind =>
              ALL_FIELD_SOURCES.includes(s as FieldSourceKind),
          )
        : fallback.enabled_sources;

    const enabled_fields: Record<string, string[]> = { ...fallback.enabled_fields };
    if (obj.enabled_fields && typeof obj.enabled_fields === 'object') {
        for (const group of Object.keys(fallback.enabled_fields)) {
            const list = (obj.enabled_fields as Record<string, unknown>)[group];
            if (Array.isArray(list)) {
                // Keep only keys that actually exist in the catalog.
                enabled_fields[group] = list.filter(
                    (k): k is string =>
                        typeof k === 'string' &&
                        FIELD_CATALOG.some((f) => f.key === k),
                );
            }
        }
    }

    // Absent → every variable; present (even empty) → honour it verbatim.
    const enabled_variables = Array.isArray(obj.enabled_variables)
        ? obj.enabled_variables.filter((k): k is string => typeof k === 'string')
        : [...allVariableKeys];

    return { enabled_sources, enabled_fields, enabled_variables };
}

export function serializeSourceConfig(config: PushSourceConfig): string {
    return JSON.stringify(config);
}

/**
 * Catalog fields available for a source kind, honouring the scope config.
 * Returns [] for sources that do not draw from the catalog.
 */
export function availableFieldsForSource(
    kind: FieldSourceKind,
    config: PushSourceConfig,
): CatalogField[] {
    const group = groupForSource(kind);
    if (!group) return [];
    const allowed = config.enabled_fields[group] ?? [];
    return catalogByGroup(group).filter((f) => allowed.includes(f.key));
}

/** Every field currently switched on, across all namespaces. */
export function enabledFieldCount(config: PushSourceConfig): number {
    return Object.values(config.enabled_fields).reduce(
        (sum, list) => sum + list.length,
        0,
    );
}

/** Coerce a collected variable value according to its declared type. */
export function coerceVariableValue(
    raw: PushVariableValue | undefined,
    def: PushVariableDef | undefined,
): unknown {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    if (!def) return raw;

    switch (def.type) {
        case 'number': {
            const n = Number(raw);
            return Number.isFinite(n) ? n : raw;
        }
        case 'boolean':
            return raw === true || raw === 'true';
        case 'multiselect':
            return Array.isArray(raw) ? raw : raw === '' ? [] : [raw];
        case 'select':
        case 'text':
        case 'textarea':
        case 'date':
        default:
            return Array.isArray(raw) ? raw.join(',') : raw;
    }
}

/** True when a variable value counts as "not provided". */
export function isVariableEmpty(value: PushVariableValue | undefined): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

/** Generate the initial value map for a target's variable definitions. */
export function initialVariableValues(
    defs: PushVariableDef[],
): Record<string, PushVariableValue> {
    const out: Record<string, PushVariableValue> = {};
    for (const def of defs) {
        if (def.default_value !== undefined && def.default_value !== '') {
            out[def.key] =
                def.type === 'multiselect'
                    ? def.default_value.split(',').map((s) => s.trim()).filter(Boolean)
                    : def.type === 'boolean'
                      ? def.default_value === 'true'
                      : def.default_value;
        } else {
            out[def.key] =
                def.type === 'multiselect' ? [] : def.type === 'boolean' ? false : '';
        }
    }
    return out;
}

/** Serialise a binding list for storage. */
export function serializeBindings(bindings: FieldBinding[]): string {
    return JSON.stringify(bindings);
}

/** Parse a stored binding list defensively. */
export function parseBindings(raw: string | null | undefined): FieldBinding[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (b): b is FieldBinding =>
                !!b && typeof b === 'object' && typeof b.path === 'string',
        );
    } catch {
        return [];
    }
}

/** Parse a stored variable definition list defensively. */
export function parseVariables(raw: string | null | undefined): PushVariableDef[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (v): v is PushVariableDef =>
                !!v && typeof v === 'object' && typeof v.key === 'string',
        );
    } catch {
        return [];
    }
}

/** Render `options` as the newline-separated text used by the editor. */
export function optionsToText(options: PushVariableDef['options']): string {
    if (!options?.length) return '';
    return options
        .map((o) => (o.label === o.value ? o.value : `${o.label}=${o.value}`))
        .join('\n');
}

/** Parse the editor's newline-separated option text back into options. */
export function textToOptions(text: string): PushVariableDef['options'] {
    const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    if (lines.length === 0) return [];
    return lines.map((line) => {
        const idx = line.indexOf('=');
        if (idx === -1) return { label: line, value: line };
        const label = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        return { label: label || value, value };
    });
}
