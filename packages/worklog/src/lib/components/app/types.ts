/**
 * The four fixed stages every board starts with.
 *
 * A ticket's status is *not* limited to these: a board can define custom
 * columns, and those carry their own generated status values. Code that needs
 * a label, colour or icon for a status must resolve it through the board's
 * column configuration rather than indexing these maps directly.
 */
export type BuiltinTicketStatus = "backlog" | "todo" | "in_progress" | "done";

/** A built-in status, or a custom column's generated status id. */
export type TicketStatus = BuiltinTicketStatus | (string & {});

/**
 * The three levels every workspace starts with.
 *
 * Like a status, a ticket's priority is *not* limited to these: priorities are
 * user-definable rows, and a custom level carries a generated id. Code that
 * needs a label, colour or order must resolve it through the priority registry
 * rather than indexing these maps directly.
 */
export type BuiltinTicketPriority = "p1" | "p2" | "p3";
export type TicketPriority = BuiltinTicketPriority | (string & {});
export type TicketType = "feature" | "bug" | "chore" | "improvement" | "epic" | "spike" | "story" | "task" | "subtask" | "incident" | "design" | "documentation";

export type SyncState = "up_to_date" | "pending_changes" | "syncing";

import * as m from "$lib/paraglide/messages.js";

// ── Ticket Type Config ─────────────────────────────────────────────────────
// Centralized display config for ticket types, statuses, and priorities.
// Carbon icon components are imported by consumers — we reference by string key here.

export interface TicketTypeConfig {
    label: string;
    /** Carbon Tag type color */
    tagColor: "teal" | "blue" | "magenta" | "purple" | "cyan" | "green" | "red" | "warm-gray" | "cool-gray" | "high-contrast";
}

export const TICKET_TYPE_CONFIG: Record<TicketType, TicketTypeConfig> = {
    feature: { get label() { return m.ticket_type_feature(); }, tagColor: "teal" },
    bug: { get label() { return m.ticket_type_bug(); }, tagColor: "red" },
    chore: { get label() { return m.ticket_type_chore(); }, tagColor: "warm-gray" },
    improvement: { get label() { return m.ticket_type_improvement(); }, tagColor: "cyan" },
    epic: { get label() { return m.ticket_type_epic(); }, tagColor: "purple" },
    spike: { get label() { return m.ticket_type_spike(); }, tagColor: "magenta" },
    story: { get label() { return m.ticket_type_story(); }, tagColor: "blue" },
    task: { get label() { return m.ticket_type_task(); }, tagColor: "cool-gray" },
    subtask: { get label() { return m.ticket_type_subtask(); }, tagColor: "cool-gray" },
    incident: { get label() { return m.ticket_type_incident(); }, tagColor: "high-contrast" },
    design: { get label() { return m.ticket_type_design(); }, tagColor: "magenta" },
    documentation: { get label() { return m.ticket_type_documentation(); }, tagColor: "green" },
};

export const TICKET_TYPE_OPTIONS: TicketType[] = ["feature", "bug", "chore", "improvement", "epic", "spike", "story", "task", "subtask", "incident", "design", "documentation"];

export interface TicketStatusConfig {
    label: string;
    accentColor: string;
}

export const TICKET_STATUS_CONFIG: Record<BuiltinTicketStatus, TicketStatusConfig> = {
    backlog: { get label() { return m.status_backlog(); }, accentColor: "magenta" },
    todo: { get label() { return m.status_todo(); }, accentColor: "teal" },
    in_progress: { get label() { return m.status_in_progress(); }, accentColor: "blue" },
    done: { get label() { return m.status_done(); }, accentColor: "green" },
};

export const TICKET_STATUS_ORDER: BuiltinTicketStatus[] = ["backlog", "todo", "in_progress", "done"];

/** True when a status belongs to one of the four fixed stages. */
export function isBuiltinStatus(status: string): status is BuiltinTicketStatus {
    return TICKET_STATUS_ORDER.includes(status as BuiltinTicketStatus);
}

// ── Kanban Columns ─────────────────────────────────────────────────────────
// A board's columns are an ordered per-board list.
//
//   内置 (builtin) — the four fixed stages. Always present, never removable;
//                    they can be renamed, annotated, collapsed, hidden and
//                    reordered.
//   自定义 (custom) — a stage the user added. It owns its own generated status
//                    value, so tickets can sit in it. Removable once empty.
//
// `title` and `note` are *overrides*: null means "use the built-in default"
// (i18n label / built-in note), which is why a built-in column keeps following
// the UI language until it is renamed.

export type KanbanColumnKind = "builtin" | "custom";

export interface KanbanColumnConfig {
    /**
     * Which tickets this column holds — also the column's identity. Built-in
     * columns use their fixed status; custom columns use a generated id.
     */
    status: TicketStatus;
    kind: KanbanColumnKind;
    /** Custom name — null keeps the built-in status label. */
    title: string | null;
    /** Custom remark — null keeps the built-in default note. */
    note: string | null;
    /** Custom accent key — null keeps the built-in status accent. */
    accentColor: string | null;
    /**
     * Planned share of the board's width, as a relative weight. null means
     * "not planned yet" and behaves as 1, so an untouched board divides its
     * width evenly.
     */
    widthShare: number | null;
    /** Collapsed to a narrow rail: still on the board, still a drop target. */
    collapsed: boolean;
    /** Hidden from the board entirely — managed from the column manager. */
    hidden: boolean;
}

/** Accents offered to custom columns; assigned in order as they are created. */
export const CUSTOM_COLUMN_ACCENTS = [
    "teal",
    "purple",
    "cyan",
    "magenta",
    "blue",
    "green",
] as const;

export interface TicketPriorityConfig {
    label: string;
    tagColor: "green" | "teal" | "red";
}

/**
 * Fallback display config for the built-in levels.
 *
 * Only a starting point: the seeded `ticket_priorities` rows are what the UI
 * normally reads, so these labels apply when a level is missing from the
 * catalog (e.g. a ticket synced from a workspace that never seeded it).
 */
export const TICKET_PRIORITY_CONFIG: Record<BuiltinTicketPriority, TicketPriorityConfig> = {
    p3: { get label() { return m.modal_priority_low(); }, tagColor: "green" },
    p2: { get label() { return m.modal_priority_medium(); }, tagColor: "teal" },
    p1: { get label() { return m.modal_priority_high(); }, tagColor: "red" },
};

export interface Project {
    id: string;
    name: string;
    localChanges: number;
    lastSyncedAt: string;
}

export interface CommandAction {
    id: string;
    label: string;
    subtitle: string;
    shortcut: string;
    /** Category for grouping in the palette (e.g. "Navigation", "Actions") */
    category?: string;
    /** Carbon icon component to display next to the label */
    icon?: any;
    run: () => void;
}



export type SyncMode = "local" | "git";

export interface WorkspaceMeta {
    name: string;
    schema_version: number;
    sync_mode: SyncMode;
    created_at: string;
}

export interface AppSettings {
    author_name: string;
    default_branch: string;
    autosave_seconds: number;
    created_at: string;
    updated_at: string;
}

export type UpdateAppSettingsInput = Partial<
    Pick<AppSettings, "author_name" | "default_branch" | "autosave_seconds">
>;

export type TabType = "kanban" | "table" | "timeline" | "calendar" | "docs" | "push";

// Default tabs for a new board — only Kanban is enabled
// Users opt in to additional views
// Kanban is always listed first and cannot be disabled
export const DEFAULT_BOARD_TABS: TabType[] = ["kanban"];

// All available tab types
export const ALL_BOARD_TABS: TabType[] = [
    "kanban",
    "table",
    "timeline",
    "calendar",
    "docs",
    "push",
];

export interface Board {
    id: string;
    name: string;
    description: string;
    tabs_config: string;
    /** JSON-encoded KanbanColumnConfig[] — empty string means "built-in defaults". */
    columns_config: string;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface Comment {
    author: string;
    body: string;
    timestamp: string;
}

export interface Ticket {
    id: string;
    board_id: string;
    title: string;
    description: string;
    status: TicketStatus;
    priority: TicketPriority;
    ticket_type: TicketType;
    position: number;
    due_date: string | null;
    start_date: string | null;
    labels: string[];
    comments: Comment[];
    created_at: string;
    updated_at: string;
}

// Input types — no id, no timestamps (generated internally)
export type CreateBoardInput = Pick<Board, "name" | "description">;
export type CreateTicketInput = Pick<
    Ticket,
    "board_id" | "title" | "description" | "labels"
> &
    Partial<Pick<Ticket, "status" | "priority" | "ticket_type" | "position" | "due_date" | "start_date">>;
export type UpdateTicketInput = Partial<
    Pick<
        Ticket,
        | "title"
        | "description"
        | "status"
        | "priority"
        | "ticket_type"
        | "position"
        | "due_date"
        | "start_date"
        | "labels"
        | "comments"
    >
>;
