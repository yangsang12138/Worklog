import { ArrowDown, ArrowRight, ArrowUp, Flag } from "carbon-icons-svelte";
import {
    TICKET_PRIORITY_CONFIG,
    type BuiltinTicketPriority,
    type TicketPriority,
} from "./types";
import type { TicketPriorityRecord } from "$lib/db/repositories/ticket-priority.repo";

/**
 * Workspace-wide priority resolution.
 *
 * Priority levels are user-defined rows, but a ticket stores only the id. Every
 * view (card, table, Gantt, preview, push payload, sorting) needs the same
 * answer for "what is this level called and what colour is it", so the shell
 * publishes the catalog here and views read through these helpers.
 *
 * A level missing from the catalog falls back to the built-in p1/p2/p3 labels —
 * a ticket synced from another workspace must never render unlabelled, and an
 * unknown id still shows something meaningful.
 *
 * Module-level `$state` keeps this reactive across components. Only one
 * workspace is active at a time, so a single registry is intentional.
 */

let _priorities = $state<TicketPriorityRecord[]>([]);

/** Publish the active workspace's priority levels. */
export function setTicketPriorities(priorities: TicketPriorityRecord[]) {
    _priorities = priorities;
}

/** Every level, in display order (highest first). */
export function priorityOptions(): TicketPriorityRecord[] {
    return _priorities;
}

export function findPriority(id: TicketPriority | string) {
    return _priorities.find((priority) => priority.id === id);
}

/**
 * Fallback config for a built-in level.
 *
 * Returns null for a custom id, and for a built-in the workspace deleted — an
 * unknown id must degrade to showing the id itself rather than crashing.
 */
function builtinConfig(id: string) {
    if (!Object.prototype.hasOwnProperty.call(TICKET_PRIORITY_CONFIG, id)) {
        return null;
    }
    // Reads through a getter so the label follows the UI language.
    return TICKET_PRIORITY_CONFIG[id as BuiltinTicketPriority];
}

/** The label to show for a priority id. */
export function priorityLabel(id: TicketPriority | string): string {
    return findPriority(id)?.name ?? builtinConfig(id)?.label ?? id;
}

/**
 * CSS colour for a priority id.
 *
 * Custom levels carry a hex colour; built-ins fall back to the colour that
 * matches their Carbon tag type, so an unseeded workspace still looks right.
 */
export function priorityColor(id: TicketPriority | string): string {
    const stored = findPriority(id)?.color;
    if (stored) return stored;

    switch (builtinConfig(id)?.tagColor) {
        case "red":
            return "#da1e28";
        case "green":
            return "#044317";
        case "teal":
            return "#005d5d";
        default:
            return "#525252";
    }
}

/**
 * Sort weight for a priority id — lower sorts first, i.e. most urgent first.
 *
 * Unknown ids sort last so they never masquerade as the top priority.
 */
export function priorityWeight(id: TicketPriority | string): number {
    const rank = findPriority(id)?.rank;
    if (typeof rank === "number") return rank;

    const builtinRank: Record<string, number> = { p1: 10, p2: 20, p3: 30 };
    return builtinRank[id] ?? 1000;
}

/**
 * The icon that marks a priority.
 *
 * The three built-ins keep their direction arrows; a custom level gets a
 * neutral flag rather than borrowing an arrow that implies a position it may
 * not hold.
 */
export function priorityIcon(id: TicketPriority | string) {
    switch (id) {
        case "p1":
            return ArrowUp;
        case "p2":
            return ArrowRight;
        case "p3":
            return ArrowDown;
        default:
            return Flag;
    }
}

/** The id a new ticket should start on: the default level, else the first. */
export function defaultPriorityId(): string {
    const fallback = _priorities.find((priority) => priority.is_default) ?? _priorities[0];
    return fallback?.id ?? "p2";
}
