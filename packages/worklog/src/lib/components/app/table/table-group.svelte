<script lang="ts">
    import {
        Tag,
        OverflowMenu,
        OverflowMenuItem,
    } from "carbon-components-svelte";
    import { Calendar, Bookmark } from "carbon-icons-svelte";
    import { getTableState, typeIconMap } from "./table-state.svelte";
    import { getWorkspaceShellContext } from "$lib/hooks/workspace-shell-context";
    import {
        type TicketType,
        type Ticket,
    } from "$lib/components/app/types";
    import {
        priorityColor,
        priorityIcon,
        priorityLabel,
    } from "$lib/components/app/priority-registry.svelte";
    import { tagColorHex } from "$lib/components/app/tag-registry.svelte";
    import * as m from "$lib/paraglide/messages.js";

    const context = getWorkspaceShellContext();
    const ticketTypesApi = context?.ticketTypesApi;

    const state = getTableState();

    let {
        group,
        onEdit,
        onDelete,
    }: {
        group: {
            status: string;
            label: string;
            icon: any;
            accentColor: string;
            tickets: Ticket[];
        };
        onEdit: (id: string) => void;
        onDelete: (id: string) => void;
    } = $props();

    function copyId(ticketId: string) {
        if (navigator.clipboard) {
            void navigator.clipboard.writeText(ticketId);
        }
    }

</script>

<div class="status-group" style="--accent: {group.accentColor}">
    <!-- Group header — matches kanban column header pattern -->
    <div class="group-header">
        <div class="group-header-left">
            <span class="group-accent-bar"></span>
            {#if group.icon}
                <group.icon size={16} />
            {/if}
            <strong class="group-label">{group.label}</strong>
            <span class="group-count">{group.tickets.length}</span>
        </div>
    </div>

    {#if group.tickets.length > 0}
        <div class="group-table-wrap">
            <table class="custom-table">
                <thead>
                    <tr>
                        <th class="th-priority-stripe" aria-hidden="true"></th>
                        <th class="th-title">{m.table_title()}</th>
                        <th class="th-priority">{m.table_priority()}</th>
                        <th class="th-type">{m.table_type()}</th>
                        <th class="th-labels">{m.table_labels()}</th>
                        <th class="th-due">{m.table_due_date()}</th>
                        <th class="th-created">{m.table_created()}</th>
                        <th class="th-actions"></th>
                    </tr>
                </thead>
                <tbody>
                    {#each group.tickets as ticket (ticket.id)}
                        {@const PriorityIcon = priorityIcon(ticket.priority)}
                        {@const customType = ticketTypesApi?.types?.find(
                            (t) => t.id === ticket.ticket_type,
                        )}
                        {@const TypeIcon =
                            (customType?.icon &&
                                typeIconMap[customType.icon as TicketType]) ||
                            typeIconMap[ticket.ticket_type as TicketType] ||
                            Bookmark}
                        {@const due = state.formatDueDate(
                            ticket.due_date,
                            ticket.status === "done",
                        )}
                        <tr
                            class="table-row"
                            style="--row-prio-color: {priorityColor(
                                ticket.priority,
                            )};"
                        >
                            <td class="td-priority-stripe" aria-hidden="true">
                                <span class="priority-stripe-inner"></span>
                            </td>
                            <td class="td-title">
                                <div class="cell-title">
                                    <span class="cell-title-text"
                                        >{ticket.title}</span
                                    >
                                    <span class="cell-title-id"
                                        >{ticket.id}</span
                                    >
                                </div>
                            </td>
                            <td class="td-priority">
                                <div class="cell-priority">
                                    {#if PriorityIcon}
                                        <PriorityIcon size={14} />
                                    {/if}
                                    <Tag
                                        style="background-color: {priorityColor(
                                            ticket.priority,
                                        )}; color: white;"
                                        size="sm"
                                    >
                                        {priorityLabel(ticket.priority)}
                                    </Tag>
                                </div>
                            </td>
                            <td class="td-type">
                                <div class="cell-type">
                                    {#if TypeIcon}
                                        <TypeIcon size={14} />
                                    {/if}
                                    <Tag
                                        style="background-color: {customType?.color ||
                                            '#525252'}; color: white;"
                                        size="sm"
                                    >
                                        {customType?.name || ticket.ticket_type}
                                    </Tag>
                                </div>
                            </td>
                            <td class="td-labels">
                                <div class="cell-labels">
                                    {#if Array.isArray(ticket.labels) && ticket.labels.length > 0}
                                        {#each ticket.labels.slice(0, 3) as label}
                                            {@const labelColor =
                                                tagColorHex(label)}
                                            <Tag
                                                type="outline"
                                                size="sm"
                                                style={labelColor
                                                    ? `border-color: ${labelColor}; color: ${labelColor};`
                                                    : undefined}
                                                >{label}</Tag
                                            >
                                        {/each}
                                        {#if ticket.labels.length > 3}
                                            <span class="labels-more"
                                                >+{ticket.labels.length -
                                                    3}</span
                                            >
                                        {/if}
                                    {:else}
                                        <span class="cell-muted">—</span>
                                    {/if}
                                </div>
                            </td>
                            <td class="td-due">
                                <div
                                    class="cell-due"
                                    class:overdue={due.overdue}
                                >
                                    <Calendar size={14} />
                                    <span>{due.text}</span>
                                </div>
                            </td>
                            <td class="td-created">
                                <span class="cell-date"
                                    >{state.formatRelativeDate(
                                        ticket.created_at,
                                    )}</span
                                >
                            </td>
                            <td class="td-actions">
                                <div class="cell-actions">
                                    <OverflowMenu flipped size="sm">
                                        <OverflowMenuItem
                                            text={m.table_copy_id()}
                                            on:click={() => copyId(ticket.id)}
                                        />
                                        <OverflowMenuItem
                                            text={m.table_edit_ticket()}
                                            on:click={() => onEdit(ticket.id)}
                                        />
                                        <OverflowMenuItem
                                            danger
                                            text={m.table_delete()}
                                            on:click={() => onDelete(ticket.id)}
                                        />
                                    </OverflowMenu>
                                </div>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {:else}
        <div class="group-empty">
            <span>{m.kanban_column_empty()}</span>
        </div>
    {/if}
</div>

<style>
    .status-group {
        margin-bottom: 0;
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .status-group:last-child {
        border-bottom: none;
    }

    /* ── Group Header (kanban-column style) ──────────────────────────────── */
    .group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.625rem 1rem;
        background: var(--cds-ui-01);
        border-bottom: 1px solid var(--cds-ui-03);
        user-select: none;
    }

    .group-header-left {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .group-accent-bar {
        width: 3px;
        height: 16px;
        border-radius: 2px;
        background: var(--accent);
        flex-shrink: 0;
    }

    .group-header-left :global(svg) {
        color: var(--accent);
        flex-shrink: 0;
    }

    .group-label {
        font-size: 0.8125rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--cds-text-01);
        margin: 0;
    }

    .group-count {
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--cds-text-02);
        background: var(--cds-ui-03);
        padding: 0 0.375rem;
        border-radius: 8px;
        min-width: 1.25rem;
        text-align: center;
        line-height: 1.25rem;
    }

    /* ── Custom Table ────────────────────────────────────────────────────── */
    .group-table-wrap {
        overflow: visible;
    }

    .custom-table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-body, "IBM Plex Sans", sans-serif);
    }

    .custom-table thead {
        background: var(--cds-ui-background);
    }

    .custom-table thead th {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--cds-text-02);
        padding: 0.5rem 0.625rem;
        text-align: left;
        border-bottom: 1px solid var(--cds-ui-03);
        white-space: nowrap;
    }

    /* ── Rows with priority stripe ───────────────────────────────────────── */
    .table-row {
        transition: background 0.1s ease;
    }

    .table-row:hover {
        background: var(--cds-hover-ui);
    }

    .table-row td {
        padding: 0.5rem 0.625rem;
        border-bottom: 1px solid
            color-mix(in srgb, var(--cds-ui-03) 50%, transparent);
        vertical-align: middle;
        font-size: 0.8125rem;
        color: var(--cds-text-01);
    }

    /* Priority stripe column */
    .td-priority-stripe {
        width: 4px;
        padding: 0 !important;
        overflow: visible;
        position: relative;
    }

    .priority-stripe-inner {
        display: block;
        position: absolute;
        inset: 2px 0 2px 0;
        width: 4px;
        border-radius: 2px;
        background: var(--row-prio-color, var(--cds-ui-03));
    }

    .th-priority-stripe {
        width: 4px;
        padding: 0 !important;
    }

    /* ── Cell Contents ───────────────────────────────────────────────────── */
    .cell-title {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
    }

    .cell-title-text {
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--cds-text-01);
        line-height: 1.3;
    }

    .cell-title-id {
        font-size: 0.6875rem;
        color: var(--cds-text-placeholder);
        font-family: var(--cds-code-01-font-family, "IBM Plex Mono", monospace);
    }

    .cell-priority {
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .cell-priority :global(svg) {
        flex-shrink: 0;
        color: var(--cds-text-02);
    }

    .cell-type {
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .cell-type :global(svg) {
        flex-shrink: 0;
        color: var(--cds-text-02);
    }

    .cell-labels {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-wrap: wrap;
    }

    .labels-more {
        font-size: 0.6875rem;
        color: var(--cds-text-02);
        font-weight: 500;
    }

    .cell-due {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
        color: var(--cds-text-02);
    }

    .cell-due :global(svg) {
        flex-shrink: 0;
        color: var(--cds-text-02);
    }

    .cell-due.overdue {
        color: var(--cds-support-01);
        font-weight: 500;
    }

    .cell-due.overdue :global(svg) {
        color: var(--cds-support-01);
    }

    .cell-date {
        font-size: 0.8125rem;
        color: var(--cds-text-02);
    }

    .cell-muted {
        color: var(--cds-text-placeholder);
    }

    .cell-actions {
        display: flex;
        justify-content: flex-end;
        overflow: visible;
    }

    .td-actions {
        overflow: visible;
    }

    /* ── Empty State ─────────────────────────────────────────────────────── */
    .group-empty {
        padding: 0.75rem 1rem 0.75rem 2.5rem;
        font-size: 0.75rem;
        color: var(--cds-text-placeholder);
        font-style: italic;
    }
</style>
