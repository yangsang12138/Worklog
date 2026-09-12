<!-- src/lib/components/app/kanban/kanban-column-manager.svelte -->
<script lang="ts">
    import { Modal, Button, ContentSwitcher, Switch, Tag } from "carbon-components-svelte";
    import {
        Add,
        TrashCan,
        ChevronRight,
        ChevronLeft,
        ChevronUp,
        ChevronDown,
        View,
        ViewOff,
        Reset,
    } from "carbon-icons-svelte";
    import {
        TICKET_STATUS_CONFIG,
        type KanbanColumnConfig,
        type TicketStatus,
    } from "$lib/components/app/types";
    import {
        MAX_WIDTH_SHARE,
        MIN_WIDTH_SHARE,
        canRemoveColumn,
        computeShares,
        hasOverrides,
        isBuiltinColumn,
    } from "$lib/db/columns-config";
    import { accentColor, builtinColumnNote, statusIcon } from "./column-defaults";
    import * as m from "$lib/paraglide/messages.js";

    /**
     * Column manager — two sheets over one compact list.
     *
     *   列管理   — add / remove / rename / annotate / collapse / hide / reorder
     *   列宽占比 — plan how much of the board width each column takes
     *
     * The four built-in stages are permanent (reorderable, renameable,
     * collapsible, hideable — never removable); custom stages own their own
     * status and can be removed once empty.
     *
     * Every change persists immediately; the modal only closes.
     */
    let {
        open = $bindable(false),
        columns,
        counts = {},
        onAddCustom,
        onRemove,
        onSetTitle,
        onSetNote,
        onReset,
        onToggleCollapsed,
        onToggleHidden,
        onMove,
        onSetWidthShare,
        onResetWidthShares,
    }: {
        open: boolean;
        columns: KanbanColumnConfig[];
        counts?: Record<string, number>;
        onAddCustom?: (title: string) => void;
        onRemove?: (status: TicketStatus) => void;
        onSetTitle?: (status: TicketStatus, title: string) => void;
        onSetNote?: (status: TicketStatus, note: string) => void;
        onReset?: (status: TicketStatus) => void;
        onToggleCollapsed?: (status: TicketStatus) => void;
        onToggleHidden?: (status: TicketStatus) => void;
        onMove?: (status: TicketStatus, delta: number) => void;
        onSetWidthShare?: (status: TicketStatus, weight: number) => void;
        onResetWidthShares?: () => void;
    } = $props();

    /** Which sheet is showing: 0 = columns, 1 = width plan. */
    let sheet = $state(0);
    let newColumnName = $state("");

    /** In-flight slider values, so dragging previews live with a single write. */
    let widthDrafts = $state<Record<string, number>>({});

    const effectiveColumns = $derived(
        Object.keys(widthDrafts).length === 0
            ? columns
            : columns.map((column) =>
                  widthDrafts[column.status] !== undefined
                      ? { ...column, widthShare: widthDrafts[column.status] }
                      : column,
              ),
    );

    const shares = $derived(computeShares(effectiveColumns));

    function handleWidthInput(status: TicketStatus, value: number) {
        widthDrafts = { ...widthDrafts, [status]: value };
    }

    function handleWidthCommit(status: TicketStatus, value: number) {
        const next = { ...widthDrafts };
        delete next[status];
        widthDrafts = next;
        onSetWidthShare?.(status, value);
    }

    function shareOf(status: TicketStatus) {
        return shares.find((share) => share.status === status);
    }

    function builtinLabel(column: KanbanColumnConfig): string {
        const config =
            TICKET_STATUS_CONFIG[
                column.status as keyof typeof TICKET_STATUS_CONFIG
            ];
        return config?.label ?? "";
    }

    function columnName(column: KanbanColumnConfig): string {
        return column.title ?? builtinLabel(column) ?? m.column_untitled();
    }

    /**
     * Why this column cannot be removed — null when removal is allowed.
     *
     * Built-in columns are permanent board stages and are never offered a
     * remove action, so the row explains what to do instead.
     */
    function removeBlockedReason(column: KanbanColumnConfig): string | null {
        if (isBuiltinColumn(column)) return m.column_builtin_no_remove_hint();

        const count = counts[column.status] ?? 0;
        if (canRemoveColumn(columns, column.status, count)) return null;
        return m.column_remove_blocked_tickets({ count });
    }

    function commitTitle(column: KanbanColumnConfig, event: Event) {
        const value = (event.currentTarget as HTMLInputElement).value;
        if (value.trim() === (column.title ?? "").trim()) return;
        onSetTitle?.(column.status, value);
    }

    function commitNote(column: KanbanColumnConfig, event: Event) {
        const value = (event.currentTarget as HTMLInputElement).value;
        if (value.trim() === (column.note ?? "").trim()) return;
        onSetNote?.(column.status, value);
    }

    function blurOnEnter(e: KeyboardEvent) {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
    }

    function submitNewColumn() {
        const name = newColumnName.trim();
        if (name.length === 0) return;
        onAddCustom?.(name);
        newColumnName = "";
    }
</script>

<Modal
    bind:open
    modalHeading={m.column_manager_title()}
    primaryButtonText={m.column_manager_done()}
    on:click:button--primary={() => (open = false)}
    size="lg"
>
    <div class="sheet-switch">
        <ContentSwitcher bind:selectedIndex={sheet} size="sm">
            <Switch text={m.column_sheet_manage()} />
            <Switch text={m.column_sheet_width()} />
        </ContentSwitcher>
    </div>

    {#if sheet === 0}
        <!-- ══ Sheet 1 — columns ═══════════════════════════════════════════ -->
        <p class="sheet-hint">{m.column_manager_subtitle()}</p>

        <div class="add-row">
            <input
                class="add-input"
                type="text"
                placeholder={m.column_add_custom_placeholder()}
                aria-label={m.column_add_custom_placeholder()}
                bind:value={newColumnName}
                onkeydown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        submitNewColumn();
                    }
                }}
            />
            <Button
                kind="tertiary"
                size="small"
                icon={Add}
                disabled={newColumnName.trim().length === 0}
                on:click={submitNewColumn}
            >
                {m.column_add_custom_action()}
            </Button>
        </div>

        <div class="list-header">
            <span></span>
            <span class="col-name">{m.column_name_label()}</span>
            <span class="col-note">{m.column_note_label()}</span>
            <span class="col-count">{m.column_count_label()}</span>
            <span class="col-actions"></span>
        </div>

        <ul class="column-list">
            {#each columns as column, index (column.status)}
                {@const builtin = isBuiltinColumn(column)}
                {@const count = counts[column.status] ?? 0}
                {@const blockedReason = removeBlockedReason(column)}
                {@const StatusIcon = statusIcon(column.status)}
                {@const noteText = column.note ?? builtinColumnNote(column.status)}

                <li class="row" class:row--off={column.hidden}>
                    <span
                        class="row-icon"
                        style="color: {accentColor(column.accentColor)}"
                    >
                        <StatusIcon size={16} />
                    </span>

                    <span class="col-name">
                        <input
                            class="cell-input"
                            type="text"
                            value={column.title ?? ""}
                            placeholder={builtin
                                ? builtinLabel(column)
                                : m.column_untitled()}
                            aria-label={m.column_name_label()}
                            onblur={(e) => commitTitle(column, e)}
                            onkeydown={blurOnEnter}
                        />
                        {#if !builtin}
                            <Tag size="sm" type="teal"
                                >{m.column_badge_custom()}</Tag
                            >
                        {/if}
                        {#if column.collapsed}
                            <span class="row-state"
                                >· {m.column_state_collapsed()}</span
                            >
                        {/if}
                        {#if column.hidden}
                            <span class="row-state"
                                >· {m.column_state_hidden()}</span
                            >
                        {/if}
                    </span>

                    <span class="col-note">
                        <input
                            class="cell-input"
                            type="text"
                            value={column.note ?? ""}
                            placeholder={noteText ||
                                m.column_note_placeholder()}
                            aria-label={m.column_note_label()}
                            onblur={(e) => commitNote(column, e)}
                            onkeydown={blurOnEnter}
                        />
                    </span>

                    <span class="col-count"
                        >{m.column_ticket_count({ count })}</span
                    >

                    <span class="col-actions">
                        <button
                            type="button"
                            class="icon-btn"
                            disabled={index === 0}
                            title={m.column_action_move_left()}
                            aria-label={m.column_move_left_aria({
                                label: columnName(column),
                            })}
                            onclick={() => onMove?.(column.status, -1)}
                        >
                            <ChevronUp size={16} />
                        </button>
                        <button
                            type="button"
                            class="icon-btn"
                            disabled={index === columns.length - 1}
                            title={m.column_action_move_right()}
                            aria-label={m.column_move_right_aria({
                                label: columnName(column),
                            })}
                            onclick={() => onMove?.(column.status, 1)}
                        >
                            <ChevronDown size={16} />
                        </button>
                        <button
                            type="button"
                            class="icon-btn"
                            title={column.collapsed
                                ? m.column_action_expand()
                                : m.column_action_collapse()}
                            aria-label={column.collapsed
                                ? m.column_expand_action_aria({
                                      label: columnName(column),
                                  })
                                : m.column_collapse_action_aria({
                                      label: columnName(column),
                                  })}
                            onclick={() => onToggleCollapsed?.(column.status)}
                        >
                            {#if column.collapsed}
                                <ChevronRight size={16} />
                            {:else}
                                <ChevronLeft size={16} />
                            {/if}
                        </button>
                        <button
                            type="button"
                            class="icon-btn"
                            title={column.hidden
                                ? m.column_action_show()
                                : m.column_action_hide()}
                            aria-label={column.hidden
                                ? m.column_show_action_aria({
                                      label: columnName(column),
                                  })
                                : m.column_hide_action_aria({
                                      label: columnName(column),
                                  })}
                            onclick={() => onToggleHidden?.(column.status)}
                        >
                            {#if column.hidden}
                                <View size={16} />
                            {:else}
                                <ViewOff size={16} />
                            {/if}
                        </button>
                        {#if builtin && hasOverrides(column)}
                            <button
                                type="button"
                                class="icon-btn"
                                title={m.column_reset_default()}
                                aria-label={m.column_reset_action_aria({
                                    label: columnName(column),
                                })}
                                onclick={() => onReset?.(column.status)}
                            >
                                <Reset size={16} />
                            </button>
                        {/if}
                        {#if !builtin}
                            <button
                                type="button"
                                class="icon-btn icon-btn--danger"
                                disabled={!!blockedReason}
                                title={blockedReason ?? m.column_action_remove()}
                                aria-label={m.column_remove_action_aria({
                                    label: columnName(column),
                                })}
                                onclick={() => onRemove?.(column.status)}
                            >
                                <TrashCan size={16} />
                            </button>
                        {/if}
                    </span>
                </li>
            {/each}
        </ul>

        <p class="sheet-footnote">{m.column_builtin_no_remove_hint()}</p>
    {:else}
        <!-- ══ Sheet 2 — width plan ════════════════════════════════════════ -->
        <p class="sheet-hint">{m.column_width_hint()}</p>

        <div class="width-list">
            {#each columns as column (column.status)}
                {@const share = shareOf(column.status)}
                {@const StatusIcon = statusIcon(column.status)}
                <div class="width-row" class:width-row--off={!share?.counts}>
                    <span
                        class="row-icon"
                        style="color: {accentColor(column.accentColor)}"
                    >
                        <StatusIcon size={16} />
                    </span>
                    <span class="width-name">{columnName(column)}</span>

                    {#if share?.counts}
                        <input
                            class="width-range"
                            type="range"
                            min={MIN_WIDTH_SHARE}
                            max={MAX_WIDTH_SHARE}
                            step="0.25"
                            value={share.weight}
                            aria-label={m.column_width_label({
                                label: columnName(column),
                            })}
                            oninput={(e) =>
                                handleWidthInput(
                                    column.status,
                                    Number(e.currentTarget.value),
                                )}
                            onchange={(e) =>
                                handleWidthCommit(
                                    column.status,
                                    Number(e.currentTarget.value),
                                )}
                        />
                        <span class="width-bar" aria-hidden="true">
                            <span
                                class="width-bar-fill"
                                style="width: {share.percent}%; background: {accentColor(
                                    column.accentColor,
                                )}"
                            ></span>
                        </span>
                        <span class="width-percent"
                            >{Math.round(share.percent)}%</span
                        >
                    {:else}
                        <span class="width-excluded">
                            {column.hidden
                                ? m.column_width_excluded_hidden()
                                : m.column_width_excluded_collapsed()}
                        </span>
                    {/if}
                </div>
            {/each}
        </div>

        <div class="width-footnote">
            <span>{m.column_width_min_note()}</span>
            <Button
                kind="ghost"
                size="small"
                icon={Reset}
                on:click={() => {
                    widthDrafts = {};
                    onResetWidthShares?.();
                }}
            >
                {m.column_width_reset()}
            </Button>
        </div>
    {/if}
</Modal>

<style>
    .sheet-switch {
        margin-bottom: 1rem;
    }

    .sheet-hint {
        font-size: 0.8125rem;
        line-height: 1.4;
        color: var(--cds-text-02);
        margin: 0 0 0.75rem;
    }

    .sheet-footnote {
        font-size: 0.75rem;
        font-style: italic;
        color: var(--cds-text-02);
        margin: 0.5rem 0 0;
    }

    /* ── Add row ───────────────────────────────────────────────────────── */
    .add-row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0.75rem;
    }

    .add-input {
        flex: 1;
        height: 2rem;
        padding: 0 0.75rem;
        font-family: inherit;
        font-size: 0.8125rem;
        color: var(--cds-text-01);
        background: var(--cds-field-01);
        border: none;
        border-bottom: 1px solid var(--cds-ui-04);
    }

    .add-input:focus {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: -2px;
    }

    .add-input::placeholder {
        color: var(--cds-text-placeholder);
    }

    /* ── Column list ───────────────────────────────────────────────────── */
    /* One boxed list with hairline dividers: a single clear boundary instead
       of a stack of cards, so the eye has far less to parse. */
    .list-header,
    .row {
        display: grid;
        grid-template-columns: 1.5rem minmax(9rem, 1.1fr) minmax(8rem, 1.3fr) 5.5rem auto;
        align-items: center;
        gap: 0.5rem;
    }

    .list-header {
        padding: 0 0.5rem 0.25rem;
        font-size: 0.6875rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--cds-text-02);
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .column-list {
        list-style: none;
        margin: 0;
        padding: 0;
        border: 1px solid var(--cds-ui-03);
        border-top: none;
    }

    .row {
        padding: 0.125rem 0.5rem;
        min-height: 2.25rem;
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .row:last-child {
        border-bottom: none;
    }

    .row:hover {
        background: var(--cds-hover-ui);
    }

    .row--off .col-name,
    .row--off .col-note,
    .row--off .col-count {
        opacity: 0.55;
    }

    .row-icon {
        display: flex;
        align-items: center;
    }

    .col-name {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        min-width: 0;
    }

    .col-note,
    .col-count {
        min-width: 0;
    }

    .col-count {
        font-size: 0.75rem;
        color: var(--cds-text-02);
        white-space: nowrap;
    }

    /* Inputs read as plain text until touched — no boxes to parse. */
    .cell-input {
        flex: 1;
        min-width: 0;
        height: 1.75rem;
        padding: 0 0.25rem;
        font-family: inherit;
        font-size: 0.8125rem;
        color: var(--cds-text-01);
        background: transparent;
        border: none;
        border-bottom: 1px solid transparent;
    }

    .cell-input:hover {
        border-bottom-color: var(--cds-ui-04);
    }

    .cell-input:focus {
        outline: none;
        border-bottom-color: var(--cds-focus, #0f62fe);
    }

    .cell-input::placeholder {
        color: var(--cds-text-placeholder);
        font-style: italic;
    }

    .row-state {
        font-size: 0.6875rem;
        color: var(--cds-text-02);
        white-space: nowrap;
    }

    .col-actions {
        display: flex;
        align-items: center;
        gap: 0.125rem;
        justify-content: flex-end;
    }

    .icon-btn {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 2px;
        cursor: pointer;
        color: var(--cds-text-02);
        flex-shrink: 0;
    }

    .icon-btn:hover:not(:disabled) {
        color: var(--cds-text-01);
        background: var(--cds-ui-03);
    }

    .icon-btn:focus-visible {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: -2px;
    }

    .icon-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .icon-btn--danger:hover:not(:disabled) {
        color: var(--cds-support-01);
    }

    /* ── Width plan ────────────────────────────────────────────────────── */
    .width-list {
        border: 1px solid var(--cds-ui-03);
    }

    .width-row {
        display: grid;
        grid-template-columns: 1.5rem minmax(7rem, 1fr) minmax(8rem, 2fr) minmax(6rem, 2fr) 3rem;
        align-items: center;
        gap: 0.5rem;
        padding: 0.375rem 0.5rem;
        min-height: 2.25rem;
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .width-row:last-child {
        border-bottom: none;
    }

    .width-row--off {
        opacity: 0.6;
    }

    .width-name {
        font-size: 0.8125rem;
        color: var(--cds-text-01);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .width-range {
        width: 100%;
        accent-color: var(--cds-interactive-01);
        cursor: pointer;
    }

    .width-bar {
        display: block;
        height: 0.5rem;
        background: var(--cds-ui-03);
        overflow: hidden;
    }

    .width-bar-fill {
        display: block;
        height: 100%;
        transition: width 0.15s ease;
    }

    .width-percent {
        font-size: 0.75rem;
        color: var(--cds-text-02);
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    .width-excluded {
        grid-column: 3 / span 3;
        font-size: 0.75rem;
        font-style: italic;
        color: var(--cds-text-02);
    }

    .width-footnote {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-top: 0.5rem;
        font-size: 0.75rem;
        color: var(--cds-text-02);
    }

    @media (max-width: 42rem) {
        .list-header,
        .row,
        .width-row {
            grid-template-columns: 1.5rem 1fr auto;
        }

        .col-note,
        .width-range,
        .width-bar {
            grid-column: 2 / span 2;
        }

        .list-header {
            display: none;
        }
    }
</style>
