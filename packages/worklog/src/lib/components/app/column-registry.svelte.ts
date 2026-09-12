import { CircleDash } from "carbon-icons-svelte";
import {
    TICKET_STATUS_CONFIG,
    type KanbanColumnConfig,
    type TicketStatus,
} from "./types";
import * as m from "$lib/paraglide/messages.js";

/**
 * Board-scoped column resolution.
 *
 * A board owns an ordered list of columns, and every board-scoped view
 * (Kanban, Table, Gantt, ticket preview, ticket card) must agree on what a
 * status is called, which colour it carries and which icon it shows. The
 * board page publishes the active board's columns here; views read through
 * these helpers instead of indexing the built-in status maps.
 *
 * Module-level `$state` keeps this reactive across components. Only one board
 * is active at a time, so a single registry is intentional.
 */

let _columns = $state<KanbanColumnConfig[]>([]);

function sameColumns(
    a: KanbanColumnConfig[],
    b: KanbanColumnConfig[],
): boolean {
    if (a.length !== b.length) return false;
    return a.every((column, i) => {
        const other = b[i];
        return (
            column.status === other.status &&
            column.kind === other.kind &&
            column.title === other.title &&
            column.note === other.note &&
            column.accentColor === other.accentColor &&
            column.collapsed === other.collapsed &&
            column.hidden === other.hidden
        );
    });
}

/** Publish the active board's columns. */
export function setBoardColumns(columns: KanbanColumnConfig[]) {
    // Avoid pointless reactivity churn when nothing actually changed.
    if (sameColumns(_columns, columns)) return;
    _columns = columns;
}

/** The active board's columns, in display order (hidden ones included). */
export function boardColumns(): KanbanColumnConfig[] {
    return _columns;
}

/** Every status the active board knows about, in column order. */
export function boardColumnStatuses(): TicketStatus[] {
    return _columns.map((column) => column.status);
}

export function findBoardColumn(status: TicketStatus): KanbanColumnConfig | undefined {
    return _columns.find((column) => column.status === status);
}

/** Fallback icon for a status with no built-in icon (a custom stage). */
export function customColumnIcon() {
    return CircleDash;
}

/**
 * The label to show for a status: the board column's custom name, the
 * built-in translated label, or — for a status this board knows nothing
 * about (e.g. synced from a board with different custom columns) — the raw
 * status so the ticket is never unlabelled.
 */
export function columnTitle(status: TicketStatus): string {
    const column = findBoardColumn(status);
    if (column?.title) return column.title;

    const builtin = TICKET_STATUS_CONFIG[status as keyof typeof TICKET_STATUS_CONFIG];
    if (builtin) return builtin.label;

    return column ? m.column_untitled() : status;
}

/** Colour key or CSS value for a status, or undefined to use the view's default. */
export function columnAccent(status: TicketStatus): string | undefined {
    return findBoardColumn(status)?.accentColor ?? undefined;
}

/** Whether the active board knows this status as one of its columns. */
export function isBoardColumnStatus(status: TicketStatus): boolean {
    return _columns.some((column) => column.status === status);
}
