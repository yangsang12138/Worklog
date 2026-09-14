/**
 * Pure helpers for the per-board Kanban column configuration.
 *
 * This module deliberately has **no runtime imports** (the types below are
 * type-only and erased at build time) so it can be unit-tested with plain
 * Node and reused by the repository layer without pulling in the DB.
 *
 * Storage shape — `boards.columns_config` holds a JSON array of
 * `KanbanColumnConfig` **in display order**. An empty string means "never
 * customised" and resolves to the four built-in columns.
 *
 * Invariants enforced by `normalizeColumns`:
 *   - the stored order is preserved (column order is user-editable)
 *   - all four built-in columns are always present
 *   - a status appears at most once (first occurrence wins)
 *   - `kind` is derived from the status, never trusted from storage
 */

import type {
    BuiltinTicketStatus,
    KanbanColumnConfig,
    TicketStatus,
} from '../components/app/types';

/** A built-in column definition with every override absent. */
export function defaultColumn(status: BuiltinTicketStatus): KanbanColumnConfig {
    return {
        status,
        kind: 'builtin',
        title: null,
        note: null,
        accentColor: null,
        widthShare: null,
        collapsed: false,
        hidden: false,
    };
}

/** The default column set: every built-in stage, in canonical order. */
export function defaultColumns(
    order: readonly BuiltinTicketStatus[],
): KanbanColumnConfig[] {
    return order.map(defaultColumn);
}

/** True for the four fixed stages — these can never be removed. */
export function isBuiltinColumn(column: KanbanColumnConfig): boolean {
    return column.kind === 'builtin';
}

/** True once a built-in column's name or remark has been overridden. */
export function hasOverrides(column: KanbanColumnConfig): boolean {
    return column.title !== null || column.note !== null;
}

/** Status id for a new custom column: `CST-` + 6 uppercase alphanumerics. */
export function newCustomStatus(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `CST-${suffix}`;
}

/** A width weight must be a positive, finite number; anything else is "unset". */
function normalizeShare(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }
    return value;
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Coerce arbitrary parsed JSON into a valid column list.
 *
 * `order` is the set of built-in statuses: it decides what counts as built-in
 * and supplies any built-in column missing from the stored list.
 */
export function normalizeColumns(
    parsed: unknown,
    order: readonly BuiltinTicketStatus[],
): KanbanColumnConfig[] {
    if (!Array.isArray(parsed)) return defaultColumns(order);

    const seen = new Set<string>();
    const columns: KanbanColumnConfig[] = [];

    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;

        const raw = entry as Partial<KanbanColumnConfig>;
        const status = raw.status;
        if (typeof status !== 'string' || status.length === 0) continue;
        if (seen.has(status)) continue;

        seen.add(status);
        const builtin = order.includes(status as BuiltinTicketStatus);
        columns.push({
            status,
            // Never trust the stored kind: it is a function of the status.
            kind: builtin ? 'builtin' : 'custom',
            title: normalizeText(raw.title),
            note: normalizeText(raw.note),
            accentColor: normalizeText(raw.accentColor),
            // View state is read from a stored config for backward
            // compatibility only — it is never written back (see
            // `serializeBoardColumns`). Retention here keeps old workspaces
            // rendering the layout their user chose until the values have been
            // lifted into the local store.
            widthShare: normalizeShare(raw.widthShare),
            collapsed: raw.collapsed === true,
            hidden: raw.hidden === true,
        });
    }

    // Built-in stages are permanent: a config written before they were
    // protected, or hand-edited, still gets them back. Each one is inserted at
    // its canonical position relative to the built-ins already present, so an
    // otherwise-sane order is not reshuffled.
    const missing = order.filter((status) => !seen.has(status));
    for (const status of missing) {
        const rank = order.indexOf(status);
        const at = columns.findIndex(
            (column) =>
                column.kind === 'builtin' &&
                order.indexOf(column.status as BuiltinTicketStatus) > rank,
        );
        if (at === -1) {
            columns.push(defaultColumn(status));
        } else {
            columns.splice(at, 0, defaultColumn(status));
        }
    }

    return columns;
}

/**
 * Parse the raw `columns_config` column. Anything unusable (empty string,
 * malformed JSON, wrong shape) resolves to the default column set so a board
 * is never left without columns.
 *
 * View state found in an older stored config is still honoured here (see
 * `normalizeColumns`) so an unmigrated workspace keeps the collapsed/hidden
 * columns its user chose; `legacyViewStateFromStored` is what lifts those
 * values into the local view-state store that now owns them.
 */
export function parseBoardColumns(
    raw: string | null | undefined,
    order: readonly BuiltinTicketStatus[],
): KanbanColumnConfig[] {
    if (!raw) return defaultColumns(order);
    try {
        return normalizeColumns(JSON.parse(raw), order);
    } catch {
        return defaultColumns(order);
    }
}

/**
 * Serialise a column list for storage in `boards.columns_config`.
 *
 * **Domain only** — the stored record has no view-state keys at all.
 * `collapsed`, `hidden` and `widthShare` are how the board looks on one
 * machine, not a team agreement: `columns_config` is part of the synced
 * workspace snapshot, so storing them here turned every personal layout tweak
 * into a shared edit and a needless merge conflict. They live in the per-board
 * view-state store instead (`$lib/hooks/board-view-state`), and an older stored
 * config that still carries them is read once and lifted there.
 */
export function serializeBoardColumns(columns: KanbanColumnConfig[]): string {
    return JSON.stringify(columns.map(toDomainColumn));
}

// ── View state (local, per board, never synced) ───────────────────────────
// Collapsed / hidden / planned width. Everything here is safe to lose: the
// worst case is that the board looks like its default layout again.

/** What one column looks like on this machine. Absent keys mean "the default". */
export interface ColumnViewState {
    collapsed?: boolean;
    hidden?: boolean;
    widthShare?: number | null;
}

/** View state per status, for one board. */
export type ColumnViewStateMap = Record<string, ColumnViewState>;

/** The shape actually written to `boards.columns_config`. */
type StoredColumnConfig = Pick<
    KanbanColumnConfig,
    'status' | 'kind' | 'title' | 'note' | 'accentColor'
>;

/** The part of a column that belongs in the synced config. */
function toDomainColumn(column: KanbanColumnConfig): StoredColumnConfig {
    return {
        status: column.status,
        kind: column.kind,
        title: column.title,
        note: column.note,
        accentColor: column.accentColor,
    };
}

/**
 * Collect the view state of a column list.
 *
 * Only non-default values are recorded, so "I expanded everything again" is
 * stored as an empty map rather than eight explicit falses.
 */
export function extractViewState(
    columns: KanbanColumnConfig[],
): ColumnViewStateMap {
    const state: ColumnViewStateMap = {};

    for (const column of columns) {
        const view: ColumnViewState = {};
        if (column.collapsed) view.collapsed = true;
        if (column.hidden) view.hidden = true;
        if (column.widthShare !== null) view.widthShare = column.widthShare;
        if (Object.keys(view).length > 0) state[column.status] = view;
    }

    return state;
}

/**
 * Overlay stored view state onto a column list.
 *
 * Unknown statuses are ignored, so a column deleted on another machine (or by
 * an import) cannot resurrect itself through the local store.
 */
export function applyViewState(
    columns: KanbanColumnConfig[],
    state: ColumnViewStateMap | null | undefined,
): KanbanColumnConfig[] {
    if (!state) return columns;

    return columns.map((column) => {
        const view = state[column.status];
        if (!view) return column;

        return {
            ...column,
            collapsed: view.collapsed === true,
            hidden: view.hidden === true,
            widthShare:
                view.widthShare === undefined
                    ? column.widthShare
                    : normalizeShare(view.widthShare),
        };
    });
}

/**
 * View state still embedded in a stored config, from before the split.
 *
 * Used once per board, when this machine has no view state for it yet, so a
 * user's existing collapsed/hidden columns survive the change instead of
 * snapping back to the default layout on first load.
 */
export function legacyViewStateFromStored(
    raw: string | null | undefined,
): ColumnViewStateMap {
    if (!raw) return {};

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (!Array.isArray(parsed)) return {};

    const state: ColumnViewStateMap = {};

    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;

        const raw_ = entry as Partial<KanbanColumnConfig>;
        const status = raw_.status;
        if (typeof status !== 'string' || status.length === 0) continue;

        const view: ColumnViewState = {};
        if (raw_.collapsed === true) view.collapsed = true;
        if (raw_.hidden === true) view.hidden = true;
        const share = normalizeShare(raw_.widthShare);
        if (share !== null) view.widthShare = share;

        if (Object.keys(view).length > 0) state[status] = view;
    }

    return state;
}

export function visibleColumns(columns: KanbanColumnConfig[]): KanbanColumnConfig[] {
    return columns.filter((column) => !column.hidden);
}

export function hiddenColumns(columns: KanbanColumnConfig[]): KanbanColumnConfig[] {
    return columns.filter((column) => column.hidden);
}

export function findColumn(
    columns: KanbanColumnConfig[],
    status: TicketStatus,
): KanbanColumnConfig | undefined {
    return columns.find((column) => column.status === status);
}

/** Every status the board knows about, in column order. */
export function columnStatuses(columns: KanbanColumnConfig[]): TicketStatus[] {
    return columns.map((column) => column.status);
}

/** Pick the accent for a new custom column, cycling the palette. */
export function nextCustomAccent(
    columns: KanbanColumnConfig[],
    palette: readonly string[],
): string {
    const used = columns.filter((column) => column.kind === 'custom').length;
    return palette[used % palette.length];
}

/**
 * Append a new custom column — a brand new stage that owns its own status.
 * The name is required; the note is optional.
 */
export function addCustomColumn(
    columns: KanbanColumnConfig[],
    title: string,
    palette: readonly string[],
    note?: string | null,
): KanbanColumnConfig[] {
    const name = title.trim();
    if (name.length === 0) return columns;

    const status = newCustomStatus();
    return [
        ...columns,
        {
            status,
            kind: 'custom',
            title: name,
            note: normalizeText(note),
            accentColor: nextCustomAccent(columns, palette),
            widthShare: null,
            collapsed: false,
            hidden: false,
        },
    ];
}

/**
 * Remove a column. Only custom columns can be removed, and only once empty —
 * see `canRemoveColumn`.
 */
export function removeColumn(
    columns: KanbanColumnConfig[],
    status: TicketStatus,
): KanbanColumnConfig[] {
    return columns.filter(
        (column) => !(column.status === status && column.kind === 'custom'),
    );
}

/**
 * Removing must never lose tickets: built-in stages are permanent, and a
 * custom column can only go once nothing is left in it.
 */
export function canRemoveColumn(
    columns: KanbanColumnConfig[],
    status: TicketStatus,
    ticketCount: number,
): boolean {
    const column = findColumn(columns, status);
    if (!column || column.kind !== 'custom') return false;
    return ticketCount === 0;
}

/** Merge a partial change into one column. */
export function patchColumn(
    columns: KanbanColumnConfig[],
    status: TicketStatus,
    patch: Partial<Omit<KanbanColumnConfig, 'status' | 'kind'>>,
): KanbanColumnConfig[] {
    return columns.map((column) =>
        column.status === status ? { ...column, ...patch, status } : column,
    );
}

/** Drop the name/remark/accent overrides so the column follows its default. */
export function resetColumn(
    columns: KanbanColumnConfig[],
    status: TicketStatus,
): KanbanColumnConfig[] {
    return patchColumn(columns, status, {
        title: null,
        note: null,
        accentColor: null,
    });
}

/**
 * Move a column one position left (`delta` -1) or right (+1). Built-in
 * columns may be reordered too — only their removal is forbidden.
 */
export function moveColumn(
    columns: KanbanColumnConfig[],
    status: TicketStatus,
    delta: number,
): KanbanColumnConfig[] {
    const index = columns.findIndex((column) => column.status === status);
    if (index === -1) return columns;

    const target = index + delta;
    if (target < 0 || target >= columns.length) return columns;

    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

// ── Column width planning ─────────────────────────────────────────────────

/** Smallest and largest weight the planner allows. */
export const MIN_WIDTH_SHARE = 0.25;
export const MAX_WIDTH_SHARE = 6;

export interface ColumnShare {
    status: TicketStatus;
    /** The relative weight used for layout (never null — defaults to 1). */
    weight: number;
    /** This column's slice of the board width, 0–100. */
    percent: number;
    /**
     * False when the column is hidden or collapsed: it still appears in the
     * planner but takes no part in the layout maths.
     */
    counts: boolean;
}

/** Clamp a requested weight into the allowed range. */
export function clampShare(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.min(MAX_WIDTH_SHARE, Math.max(MIN_WIDTH_SHARE, value));
}

/** The weight used for layout: the planned one, or 1 when unplanned. */
export function columnWeight(column: KanbanColumnConfig): number {
    return column.widthShare ?? 1;
}

/**
 * Distribute the board width across the columns that actually occupy space —
 * hidden columns are not laid out, and a collapsed column is a fixed-width
 * rail rather than a share of the row.
 *
 * The percentages always total 100 across the participating columns.
 */
export function computeShares(columns: KanbanColumnConfig[]): ColumnShare[] {
    const participants = columns.filter(
        (column) => !column.hidden && !column.collapsed,
    );
    const total = participants.reduce(
        (sum, column) => sum + columnWeight(column),
        0,
    );

    return columns.map((column) => {
        const counts = !column.hidden && !column.collapsed;
        return {
            status: column.status,
            weight: columnWeight(column),
            percent:
                counts && total > 0
                    ? (columnWeight(column) / total) * 100
                    : 0,
            counts,
        };
    });
}

/** Set the planned width weight for a column. */
export function setWidthShare(
    columns: KanbanColumnConfig[],
    status: TicketStatus,
    weight: number,
): KanbanColumnConfig[] {
    return patchColumn(columns, status, { widthShare: clampShare(weight) });
}

/** Clear every planned width so the board divides its width evenly again. */
export function resetWidthShares(
    columns: KanbanColumnConfig[],
): KanbanColumnConfig[] {
    // Return the same array when there is nothing to clear, so callers can use
    // identity to skip a pointless write.
    if (columns.every((column) => column.widthShare === null)) return columns;
    return columns.map((column) => ({ ...column, widthShare: null }));
}

/**
 * The label to render for a status: the column's custom name when set,
 * otherwise the caller-supplied built-in label.
 */
export function resolveColumnTitle(
    columns: KanbanColumnConfig[],
    status: TicketStatus,
    builtinLabel: string,
): string {
    return findColumn(columns, status)?.title ?? builtinLabel;
}
