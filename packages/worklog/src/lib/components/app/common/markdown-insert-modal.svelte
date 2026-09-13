<!--
  Popup editor for the block-level Markdown constructs.

  Bold, italic and headings are one-token edits, so the toolbar writes them
  straight into the text. A link, a code block, a list or a table is not: the
  user has to say *what* goes in it. Those open this dialog, which builds the
  Markdown from named fields and hands the finished text back to the editor —
  so the description is never left holding half-typed syntax.

  Lists and tables are *filled in*, not just shaped: a list is a stack of item
  rows you add to, and a table is a grid of real editable cells. The Markdown
  is generated from what was typed, never the other way round.
-->
<script lang="ts">
    import { tick, untrack } from "svelte";
    import {
        Button,
        Checkbox,
        Modal,
        TextArea,
        TextInput,
    } from "carbon-components-svelte";
    import { Add, Close } from "carbon-icons-svelte";

    import MarkdownViewer from "./markdown-viewer.svelte";
    import type { MarkdownInsertKind } from "$lib/utils/markdown-insert";
    import {
        MAX_TABLE_COLUMNS,
        MAX_TABLE_ROWS,
        addTableRow,
        buildMarkdownTable,
        createTableGrid,
        pasteTableBlock,
        removeTableColumn,
        removeTableRow,
        setTableCell,
        setTableColumns,
        setTableHeaderCell,
        setTableRows,
        visibleBodyRows,
        visibleHeaderCells,
        type TableAlign,
        type TableGrid,
    } from "$lib/utils/markdown-table";
    import * as m from "$lib/paraglide/messages.js";

    let {
        open = $bindable(false),
        kind = "link",
        selection = "",
        onInsert,
    }: {
        open: boolean;
        kind: MarkdownInsertKind;
        /** Current editor selection, used to prefill the fields. */
        selection?: string;
        onInsert: (markdown: string, block: boolean) => void;
    } = $props();

    const LANGUAGES = [
        "plaintext",
        "javascript",
        "typescript",
        "svelte",
        "python",
        "rust",
        "go",
        "java",
        "bash",
        "sql",
        "json",
        "yaml",
        "html",
        "css",
        "markdown",
    ];

    let container = $state<HTMLElement | null>(null);

    let linkText = $state("");
    let linkUrl = $state("");
    let linkTitle = $state("");

    let codeText = $state("");
    let codeLanguage = $state("plaintext");

    /** List items, one per row — the rows *are* the data. */
    let listItems = $state<string[]>([""]);

    /**
     * The table editor's data.
     *
     * All of it lives in one value, and every edit goes through the pure
     * helpers in `$lib/utils/markdown-table` — the resize rules are subtle
     * enough (see that module) that they are tested there rather than here.
     */
    let grid = $state<TableGrid>(createTableGrid());
    let tableHeader = $state(true);
    let tableAlign = $state<TableAlign>("default");

    let error = $state<string | null>(null);

    const heading = $derived(
        kind === "link"
            ? m.md_dialog_link_title()
            : kind === "code"
              ? m.md_dialog_code_title()
              : kind === "codeblock"
                ? m.md_dialog_codeblock_title()
                : kind === "bullet"
                  ? m.md_dialog_bullet_title()
                  : kind === "number"
                    ? m.md_dialog_number_title()
                    : m.md_dialog_table_title(),
    );

    const isList = $derived(kind === "bullet" || kind === "number");

    // Prefill from the selection each time the dialog opens: selecting a URL
    // then asking for a link should not make the user paste it twice, and a
    // selection that already looks like a list should become list rows.
    //
    // Only `open` and `selection` may re-run this. The body resets the table
    // grid, so letting it depend on grid state (it used to read the counts back
    // out to size the blank grid) made every resize undo itself on the spot.
    $effect(() => {
        const initial = selection;
        const isOpen = open;
        untrack(() => {
            if (!isOpen) return;

            error = null;
            linkText = initial.trim();
            linkUrl = "";
            linkTitle = "";
            codeText = initial;
            codeLanguage = "plaintext";

            const selectedLines = initial
                .split("\n")
                .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim())
                .filter(Boolean);
            listItems = selectedLines.length > 0 ? selectedLines : [""];

            grid = createTableGrid();
            tableHeader = true;
            tableAlign = "default";
        });
    });

    // ── List rows ───────────────────────────────────────────────────────────

    function setListItem(index: number, next: string) {
        listItems = listItems.map((item, i) => (i === index ? next : item));
    }

    async function addListItem(afterIndex: number) {
        listItems = [
            ...listItems.slice(0, afterIndex + 1),
            "",
            ...listItems.slice(afterIndex + 1),
        ];
        await tick();
        focusRow(afterIndex + 1);
    }

    function removeListItem(index: number) {
        // Always leave one row: an empty list editor has nowhere to type.
        const next = listItems.filter((_, i) => i !== index);
        listItems = next.length > 0 ? next : [""];
    }

    function handleListKeydown(event: KeyboardEvent, index: number) {
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            void addListItem(index);
        } else if (
            event.key === "Backspace" &&
            listItems[index] === "" &&
            listItems.length > 1
        ) {
            event.preventDefault();
            removeListItem(index);
            void tick().then(() => focusRow(Math.max(0, index - 1)));
        }
    }

    function focusRow(index: number) {
        const rows = container?.querySelectorAll<HTMLInputElement>("[data-list-row]");
        rows?.[index]?.focus();
    }

    /**
     * Spread a multi-line paste across rows.
     *
     * Entering items one row at a time is fine for two of them and tedious for
     * ten, and a pasted list (or a column copied out of a document) is the
     * obvious bulk path. A paste without a line break keeps the browser's
     * default behaviour.
     */
    async function handleListPaste(event: ClipboardEvent, index: number) {
        const text = event.clipboardData?.getData("text") ?? "";
        if (!text.includes("\n")) return;

        const lines = text
            .replace(/\r\n?/g, "\n")
            .split("\n")
            .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim())
            .filter(Boolean);
        if (lines.length === 0) return;

        event.preventDefault();

        // A row that already holds text keeps it: the paste lands after it
        // rather than overwriting work in progress.
        const current = listItems[index]?.trim();
        const before = listItems.slice(0, index);
        const after = listItems.slice(index + 1);
        const inserted = current ? [listItems[index], ...lines] : lines;
        listItems = [...before, ...inserted, ...(after.length > 0 ? after : [""])];

        await tick();
        focusRow(before.length + inserted.length);
    }

    // ── Table grid ──────────────────────────────────────────────────────────
    // Every edit delegates to the pure helpers in `$lib/utils/markdown-table`,
    // where the resize and windowing rules are unit-tested.

    /** A usable count, or null when the field holds nothing to act on. */
    function parseCount(raw: string): number | null {
        if (raw.trim() === "") return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    /**
     * Follow the column field as it is typed.
     *
     * An empty field is ignored rather than snapped to 1: the user is mid-edit
     * after clearing "12" to type "5", and writing a value back would move the
     * caret and turn the next keystroke into "15". Out-of-range numbers *are*
     * clamped, so the field corrects itself to the supported range.
     */
    function applyColumns(raw: string) {
        const parsed = parseCount(raw);
        if (parsed === null) return;
        grid = setTableColumns(grid, parsed);
    }

    /** Follow the row field as it is typed, on the same terms. */
    function applyRows(raw: string) {
        const parsed = parseCount(raw);
        if (parsed === null) return;
        grid = setTableRows(grid, parsed);
    }

    /** On leaving a field, an unusable value snaps back to the real count. */
    function restoreCount(
        event: Event & { currentTarget: HTMLInputElement },
        current: number,
    ) {
        if (parseCount(event.currentTarget.value) === null) {
            event.currentTarget.value = String(current);
        }
    }

    /** Add a row below the last visible one, then focus its first cell. */
    async function addBodyRow() {
        grid = addTableRow(grid);
        const added = grid.rows - 1;

        await tick();
        const cells = container?.querySelectorAll<HTMLInputElement>(
            `[data-cell^="${added}-"]`,
        );
        cells?.[0]?.focus();
    }

    function removeBodyRow(index: number) {
        grid = removeTableRow(grid, index);
    }

    function removeColumn(index: number) {
        grid = removeTableColumn(grid, index);
    }

    /** Visible column indexes, for the per-column controls. */
    function columnIndexes(): number[] {
        return Array.from({ length: grid.columns }, (_, i) => i);
    }

    /**
     * Spread a pasted block (spreadsheet cells, TSV, CSV-ish) across the grid.
     *
     * A paste without a line break or a tab keeps the browser's default
     * behaviour, so ordinary single-value pastes still work.
     */
    function handleCellPaste(
        event: ClipboardEvent,
        rowIndex: number,
        column: number,
    ) {
        const text = event.clipboardData?.getData("text") ?? "";
        if (!text.includes("\n") && !text.includes("\t")) return;

        const block = text
            .replace(/\r\n?/g, "\n")
            .replace(/\n+$/, "")
            .split("\n")
            .map((line) => line.split("\t"));
        if (block.length === 0) return;

        event.preventDefault();
        grid = pasteTableBlock(grid, block, rowIndex, column);
    }

    // ── Generated Markdown ──────────────────────────────────────────────────

    const generated = $derived.by(() => {
        switch (kind) {
            case "link": {
                if (!linkUrl.trim()) return "";
                const title = linkTitle.trim()
                    ? ` "${linkTitle.trim().replace(/"/g, '\\"')}"`
                    : "";
                return `[${linkText.trim() || linkUrl.trim()}](${linkUrl.trim()}${title})`;
            }
            case "code":
                return codeText ? `\`${codeText}\`` : "";
            case "codeblock": {
                const language = codeLanguage === "plaintext" ? "" : codeLanguage;
                return `\`\`\`${language}\n${codeText}\n\`\`\``;
            }
            case "bullet":
            case "number": {
                const items = listItems.map((item) => item.trim()).filter(Boolean);
                if (items.length === 0) return "";
                return items
                    .map((item, index) =>
                        kind === "number" ? `${index + 1}. ${item}` : `- ${item}`,
                    )
                    .join("\n");
            }
            case "table":
                return buildMarkdownTable(grid, tableAlign, tableHeader);
            default:
                return "";
        }
    });

    const isBlock = $derived(
        kind === "codeblock" || isList || kind === "table",
    );

    function handleSubmit() {
        if (!generated) {
            error =
                kind === "link"
                    ? m.md_error_url()
                    : kind === "codeblock" || kind === "code"
                      ? m.md_error_code()
                      : kind === "table"
                        ? m.md_error_table()
                        : m.md_error_items();
            return;
        }

        onInsert(generated, isBlock);
        open = false;
    }

    /**
     * Leave without inserting anything.
     *
     * Half-filled rows and cells are dropped on the way out: the dialog
     * rebuilds itself from the selection the next time it opens.
     */
    function handleCancel() {
        open = false;
    }
</script>

<!--
  The remove control for one column.

  Deliberately the same button as a row's: same size, same icon, same slot at
  the end of what it deletes. A column's slot is its header cell.
-->
{#snippet columnRemove(column: number)}
    <button
        type="button"
        class="md-icon-btn"
        title={m.md_remove_column()}
        aria-label={m.md_remove_column_n({ index: column + 1 })}
        disabled={grid.columns === 1}
        onclick={() => removeColumn(column)}
    >
        <Close size={14} />
    </button>
{/snippet}

<Modal
    bind:open
    size={kind === "table" ? "lg" : "sm"}
    modalHeading={heading}
    primaryButtonText={m.md_insert()}
    secondaryButtonText={m.modal_cancel()}
    primaryButtonDisabled={!generated}
    on:click:button--primary={handleSubmit}
    on:click:button--secondary={handleCancel}
>
    <div class="md-dialog" bind:this={container}>
        {#if error}
            <p class="md-error">{error}</p>
        {/if}

        {#if kind === "link"}
            <TextInput
                labelText={m.md_link_text()}
                placeholder={m.md_link_text_placeholder()}
                bind:value={linkText}
            />
            <TextInput
                labelText={m.md_link_url()}
                placeholder="https://example.com"
                bind:value={linkUrl}
            />
            <TextInput
                labelText={m.md_link_title_optional()}
                bind:value={linkTitle}
            />
        {:else if kind === "code"}
            <TextInput labelText={m.md_code_content()} bind:value={codeText} />
        {:else if kind === "codeblock"}
            <div class="md-language">
                <label class="md-field-label" for="md-language-select"
                    >{m.md_code_language()}</label
                >
                <select
                    id="md-language-select"
                    class="md-select"
                    bind:value={codeLanguage}
                >
                    {#each LANGUAGES as language (language)}
                        <option value={language}>{language}</option>
                    {/each}
                </select>
            </div>
            <TextArea
                labelText={m.md_code_content()}
                rows={8}
                bind:value={codeText}
            />
        {:else if isList}
            <!--
                One input per item. Enter appends a row below the current one,
                Backspace on an empty row removes it — the same muscle memory as
                any list editor, and it keeps each item a single line by
                construction.
            -->
            <div class="md-list">
                <span class="md-field-label">{m.md_list_items()}</span>
                {#each listItems as item, index (index)}
                    <div class="md-list-row">
                        <span class="md-list-marker">
                            {kind === "number" ? `${index + 1}.` : "•"}
                        </span>
                        <input
                            class="md-input md-list-input"
                            type="text"
                            data-list-row
                            value={item}
                            placeholder={m.md_list_item_placeholder()}
                            oninput={(e) =>
                                setListItem(index, e.currentTarget.value)}
                            onkeydown={(e) => handleListKeydown(e, index)}
                            onpaste={(e) => handleListPaste(e, index)}
                            aria-label={m.md_list_item({ index: index + 1 })}
                        />
                        <button
                            type="button"
                            class="md-icon-btn"
                            title={m.md_remove_row()}
                            aria-label={m.md_remove_row()}
                            disabled={listItems.length === 1}
                            onclick={() => removeListItem(index)}
                        >
                            <Close size={14} />
                        </button>
                    </div>
                {/each}
                <Button
                    size="small"
                    kind="ghost"
                    icon={Add}
                    onclick={() => addListItem(listItems.length - 1)}
                >
                    {m.md_add_row()}
                </Button>
            </div>
        {:else if kind === "table"}
            <!--
                The table editor is a grid of real cells. Column and row counts
                resize the grid and keep whatever is already typed, so the shape
                and the content are edited in one place.
            -->
            <div class="md-table-controls">
                <div class="md-number-field">
                    <label class="md-field-label" for="md-table-columns"
                        >{m.md_table_columns()}</label
                    >
                    <input
                        id="md-table-columns"
                        class="md-input"
                        type="number"
                        min="1"
                        max={MAX_TABLE_COLUMNS}
                        value={grid.columns}
                        oninput={(e) => applyColumns(e.currentTarget.value)}
                        onchange={(e) => restoreCount(e, grid.columns)}
                    />
                </div>
                <div class="md-number-field">
                    <label class="md-field-label" for="md-table-rows"
                        >{m.md_table_rows()}</label
                    >
                    <input
                        id="md-table-rows"
                        class="md-input"
                        type="number"
                        min="1"
                        max={MAX_TABLE_ROWS}
                        value={grid.rows}
                        oninput={(e) => applyRows(e.currentTarget.value)}
                        onchange={(e) => restoreCount(e, grid.rows)}
                    />
                </div>
                <div class="md-number-field">
                    <label class="md-field-label" for="md-table-align"
                        >{m.md_table_align()}</label
                    >
                    <select
                        id="md-table-align"
                        class="md-select md-select--full"
                        bind:value={tableAlign}
                    >
                        <option value="default">{m.md_align_default()}</option>
                        <option value="left">{m.md_align_left()}</option>
                        <option value="center">{m.md_align_center()}</option>
                        <option value="right">{m.md_align_right()}</option>
                    </select>
                </div>
            </div>

            <Checkbox labelText={m.md_table_header()} bind:checked={tableHeader} />

            <div class="md-grid-scroll">
                <div
                    class="md-grid"
                    style="--md-cols: {grid.columns}"
                >
                    {#if tableHeader}
                        <div class="md-grid-row">
                            {#each visibleHeaderCells(grid) as cellValue, column (column)}
                                <div class="md-header-cell">
                                    <input
                                        class="md-input md-cell md-cell--header"
                                        type="text"
                                        value={cellValue}
                                        placeholder={m.md_table_column_n({
                                            index: column + 1,
                                        })}
                                        oninput={(e) =>
                                            (grid = setTableHeaderCell(
                                                grid,
                                                column,
                                                e.currentTarget.value,
                                            ))}
                                        aria-label={m.md_table_header_cell({
                                            column: column + 1,
                                        })}
                                    />
                                    {@render columnRemove(column)}
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <!--
                            With the header switched off there is no header cell
                            to hold the control, and a column would then be
                            impossible to remove — so the buttons keep a row of
                            their own in the header's place.
                        -->
                        <div class="md-grid-row md-grid-row--tools">
                            {#each columnIndexes() as column (column)}
                                <div class="md-header-cell">
                                    {@render columnRemove(column)}
                                </div>
                            {/each}
                        </div>
                    {/if}

                    {#each visibleBodyRows(grid) as row, rowIndex (rowIndex)}
                        <div class="md-grid-row">
                            {#each row as cellValue, column (column)}
                                <input
                                    class="md-input md-cell"
                                    type="text"
                                    data-cell="{rowIndex}-{column}"
                                    value={cellValue}
                                    oninput={(e) =>
                                        (grid = setTableCell(
                                            grid,
                                            rowIndex,
                                            column,
                                            e.currentTarget.value,
                                        ))}
                                    onpaste={(e) =>
                                        handleCellPaste(e, rowIndex, column)}
                                    aria-label={m.md_table_cell({
                                        row: rowIndex + 1,
                                        column: column + 1,
                                    })}
                                />
                            {/each}
                            <button
                                type="button"
                                class="md-icon-btn"
                                title={m.md_remove_row()}
                                aria-label={m.md_remove_row()}
                                disabled={grid.rows === 1}
                                onclick={() => removeBodyRow(rowIndex)}
                            >
                                <Close size={14} />
                            </button>
                        </div>
                    {/each}
                </div>
            </div>

            <Button size="small" kind="ghost" icon={Add} onclick={addBodyRow}>
                {m.md_add_row()}
            </Button>
        {/if}

        {#if generated && kind !== "code"}
            <div class="md-preview">
                <span class="md-preview-label">{m.modal_preview()}</span>
                <div class="md-preview-body">
                    <MarkdownViewer content={generated} />
                </div>
            </div>
        {/if}
    </div>
</Modal>

<style>
    .md-dialog {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .md-error {
        margin: 0;
        padding: 0.5rem 0.75rem;
        font-size: 0.75rem;
        color: var(--cds-support-01, #da1e28);
        background: color-mix(
            in srgb,
            var(--cds-support-01, #da1e28) 10%,
            transparent
        );
        border-radius: 4px;
    }

    .md-field-label {
        display: block;
        margin-bottom: 0.25rem;
        font-size: 0.75rem;
        color: var(--cds-text-secondary, #525252);
    }

    .md-select,
    .md-input {
        box-sizing: border-box;
        width: 100%;
        height: 2rem;
        padding: 0 0.75rem;
        background: var(--cds-field-01, #f4f4f4);
        border: 1px solid var(--cds-ui-04, #8d8d8d);
        border-radius: 2px;
        font-family: inherit;
        font-size: 0.75rem;
        color: var(--cds-text-primary, #161616);
        outline: none;
    }

    .md-select:focus,
    .md-input:focus {
        outline: 2px solid var(--cds-interactive-01, #0f62fe);
        outline-offset: -2px;
    }

    /* ── List rows ─────────────────────────────────────────────────────────── */
    .md-list {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .md-list-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .md-list-marker {
        flex-shrink: 0;
        min-width: 1.25rem;
        font-size: 0.75rem;
        color: var(--cds-text-helper, #6f6f6f);
        text-align: right;
    }

    .md-list-input {
        flex: 1;
    }

    .md-icon-btn {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 2px;
        color: var(--cds-text-helper, #6f6f6f);
        cursor: pointer;
    }

    .md-icon-btn:hover:not([disabled]) {
        background: var(--cds-hover-ui, #e5e5e5);
        color: var(--cds-text-primary, #161616);
    }

    .md-icon-btn[disabled] {
        opacity: 0.4;
        cursor: not-allowed;
    }

    /* ── Table grid ────────────────────────────────────────────────────────── */
    .md-table-controls {
        display: flex;
        gap: 0.75rem;
    }

    .md-number-field {
        flex: 1;
        min-width: 0;
    }

    .md-grid-scroll {
        overflow-x: auto;
        padding-bottom: 0.25rem;
    }

    .md-grid {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: max-content;
    }

    .md-grid-row {
        display: grid;
        grid-template-columns: repeat(var(--md-cols), minmax(7rem, 1fr));
        align-items: center;
        gap: 0.25rem;
        /* Trailing slot for the row's remove button. */
        padding-right: 2rem;
        position: relative;
    }

    /* Only the row's own trailing button is pinned to the end of the row — the
       column buttons sit inside header cells and must stay in their cell. */
    .md-grid-row > .md-icon-btn {
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
    }

    .md-cell {
        padding: 0 0.5rem;
    }

    /* A header cell holds its label plus the control that removes the column,
       so the input shares the cell with the button. */
    .md-header-cell {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        min-width: 0;
    }

    .md-header-cell .md-input {
        flex: 1;
        min-width: 0;
    }

    /* Header switched off: the same buttons, right-aligned in their column. */
    .md-grid-row--tools .md-header-cell {
        justify-content: flex-end;
    }

    .md-cell--header {
        font-weight: 600;
        background: var(--cds-ui-02, #f4f4f4);
    }

    .md-preview {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.5rem 0.75rem;
        background: var(--cds-ui-02, #f4f4f4);
        border: 1px solid var(--cds-ui-03, #e0e0e0);
        border-radius: 4px;
        max-height: 12rem;
        overflow: auto;
    }

    .md-preview-label {
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--cds-text-helper, #6f6f6f);
    }

    .md-preview-body :global(.markdown-empty) {
        display: none;
    }
</style>
