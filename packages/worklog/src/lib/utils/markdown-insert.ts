/**
 * The Markdown constructs the description editor builds in a dialog.
 *
 * Shared between the toolbar that opens the dialog and the dialog itself, so
 * the two can never drift apart over which kinds exist.
 */
export type MarkdownInsertKind =
    | "link"
    | "code"
    | "codeblock"
    | "bullet"
    | "number"
    | "table";
