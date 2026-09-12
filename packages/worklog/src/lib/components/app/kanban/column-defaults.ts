import {
    CheckmarkFilled,
    InProgress as InProgressIcon,
    Pending,
    TaskComplete,
} from "carbon-icons-svelte";
import { CircleDash } from "carbon-icons-svelte";
import type { TicketStatus } from "$lib/components/app/types";
import { isBuiltinStatus } from "$lib/components/app/types";
import * as m from "$lib/paraglide/messages.js";

/**
 * Built-in text and iconography for Kanban columns.
 *
 * A column with no override falls back to these. Keeping the text behind
 * functions (rather than frozen constants) means it follows the active UI
 * language, which is why the stored config only holds *overrides*.
 *
 * Custom columns have no built-in text or icon: they always carry their own
 * name, and fall back to a neutral stage icon.
 */

/** The icon representing a status, shared by the column and its manager. */
export function statusIcon(status: TicketStatus) {
    switch (status) {
        case "backlog":
            return Pending;
        case "todo":
            return TaskComplete;
        case "in_progress":
            return InProgressIcon;
        case "done":
            return CheckmarkFilled;
        default:
            // A custom stage — a neutral marker rather than a wrong icon.
            return CircleDash;
    }
}

/** The built-in default remark for a column (empty for custom stages). */
export function builtinColumnNote(status: TicketStatus): string {
    if (!isBuiltinStatus(status)) return "";

    switch (status) {
        case "backlog":
            return m.column_note_backlog();
        case "todo":
            return m.column_note_todo();
        case "in_progress":
            return m.column_note_in_progress();
        case "done":
            return m.column_note_done();
    }
}

/** The remark to render: the custom one when set, otherwise the built-in. */
export function columnNote(
    note: string | null | undefined,
    status: TicketStatus,
): string {
    return note ?? builtinColumnNote(status);
}

/** Accent keys understood by the accent map below. */
export const COLUMN_ACCENTS: Record<string, string> = {
    blue: "var(--cds-interactive-01)",
    green: "var(--cds-support-02)",
    yellow: "var(--cds-support-03)",
    red: "var(--cds-support-01)",
    magenta: "#e5399e",
    teal: "var(--cds-support-04)",
    purple: "#a56eff",
    cyan: "#33b1ff",
    "warm-gray": "#a8a8a8",
};

/** Resolve an accent key (or raw CSS value) to something renderable. */
export function accentColor(accent: string | null | undefined): string {
    if (!accent) return COLUMN_ACCENTS.blue;
    return COLUMN_ACCENTS[accent] ?? accent;
}
