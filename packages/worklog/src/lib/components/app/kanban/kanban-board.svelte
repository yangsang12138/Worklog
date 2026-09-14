<!-- src/lib/components/app/kanban/kanban-board.svelte -->
<script lang="ts">
    import { InlineNotification, Button } from "carbon-components-svelte";
    import { Settings, View, ViewOff } from "carbon-icons-svelte";
    import KanbanColumn from "./kanban-column.svelte";
    import KanbanColumnManager from "./kanban-column-manager.svelte";
    import TicketAddEditModal from "./ticket-add-edit-modal.svelte";
    import TicketDeleteConfirm from "./ticket-delete-confirm.svelte";
    import TicketPreviewSheet from "./ticket-preview-sheet.svelte";
    import { accentColor, builtinColumnNote, statusIcon } from "./column-defaults";
    import { getWorkspaceShellContext } from "$lib/hooks/workspace-shell-context";
    import { getTickets } from "$lib/hooks/tickets.svelte";
    import { getTicketSort } from "$lib/hooks/ticket-sort.svelte";
    import { getBoardColumns } from "$lib/hooks/board-columns.svelte";
    import {
        type Ticket,
        type TicketStatus,
        type Comment,
        TICKET_STATUS_CONFIG,
        isBuiltinStatus,
    } from "$lib/components/app/types";
    import {
        columnWeight,
        findColumn,
        visibleColumns,
    } from "$lib/db/columns-config";
    import { resolveAuthorName } from "$lib/app-config/app-config.svelte";
    import * as m from "$lib/paraglide/messages.js";

    type Column = {
        status: TicketStatus;
        label: string;
        note: string;
        collapsed: boolean;
        accentColor: string;
        icon: ReturnType<typeof statusIcon>;
        grow: number;
        tickets: Ticket[];
    };

    let { searchQuery = "" }: { searchQuery?: string } = $props();

    const shell = getWorkspaceShellContext();
    const getWorkspacePath = () => shell.workspace.path;
    const getBoardId = () => shell.boardsApi.active?.id ?? null;

    const ticketsHook = getTickets(getWorkspacePath, getBoardId);
    const sortHook = getTicketSort();
    const columnsApi = getBoardColumns(getWorkspacePath, getBoardId);

    let loadError = $state<string | null>(null);
    let actionError = $state<string | null>(null);
    let managerOpen = $state(false);

    // Loading is now handled by the parent component (+page.svelte)

    // ── Column definitions from the board's column config ──────────────────────
    // A column keeps the built-in status label unless it carries a custom name,
    // and falls back to the built-in remark unless it carries a custom one.
    const configColumns = $derived(visibleColumns(columnsApi.columns));

    /** Built-in translated label, or empty for a custom stage. */
    function builtinLabel(status: TicketStatus): string {
        return isBuiltinStatus(status)
            ? TICKET_STATUS_CONFIG[status].label
            : "";
    }

    let columns = $derived(
        configColumns.map((config): Column => {
            const columnTickets = ticketsHook.tickets.filter(
                (ticket) => ticket.status === config.status,
            );
            return {
                status: config.status,
                // A custom stage has no built-in text: it always carries its
                // own name, and falls back to the neutral stage icon.
                label: config.title ?? builtinLabel(config.status),
                note: config.note ?? builtinColumnNote(config.status),
                collapsed: config.collapsed,
                accentColor:
                    config.accentColor ??
                    (isBuiltinStatus(config.status)
                        ? TICKET_STATUS_CONFIG[config.status].accentColor
                        : "blue"),
                icon: statusIcon(config.status),
                grow: columnWeight(config),
                tickets: sortHook.sortTickets(columnTickets),
            };
        }),
    );

    const hiddenColumnList = $derived(
        columnsApi.columns.filter((column) => column.hidden),
    );

    const filteredColumns = $derived(
        columns.map((col) => ({
            ...col,
            tickets: searchQuery.trim()
                ? col.tickets.filter(
                      (t) =>
                          t.title
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase()) ||
                          t.description
                              ?.toLowerCase()
                              .includes(searchQuery.toLowerCase()) ||
                          t.labels?.some((tag) =>
                              tag
                                  .toLowerCase()
                                  .includes(searchQuery.toLowerCase()),
                          ),
                  )
                : col.tickets,
        })),
    );

    function statusLabel(status: TicketStatus): string {
        const config = findColumn(columnsApi.columns, status);
        return config?.title ?? builtinLabel(status) ?? status;
    }

    // ── DnD handlers ───────────────────────────────────────────────────────────
    function makeHandlers(targetStatus: TicketStatus) {
        return {
            consider(_e: CustomEvent) {
                actionError = null;
            },
            finalize(e: CustomEvent) {
                void (async () => {
                    try {
                        const detail = e.detail as {
                            info?: { id?: string };
                            items?: Array<{ id?: string; position?: number }>;
                        };
                        const movedTicketId = detail.info?.id;

                        if (!movedTicketId || !detail.items) {
                            return;
                        }

                        // finalize fires on multiple zones; only destination should persist.
                        const newIndex = detail.items.findIndex(
                            (item) => item.id === movedTicketId,
                        );

                        if (newIndex === -1) {
                            return;
                        }

                        const items = detail.items;
                        let newPosition = 0;

                        if (items.length === 1) {
                            newPosition = 1000;
                        } else if (newIndex === 0) {
                            newPosition = (items[1].position ?? 1000) - 100;
                        } else if (newIndex === items.length - 1) {
                            newPosition =
                                (items[newIndex - 1].position ?? 0) + 100;
                        } else {
                            const prev = items[newIndex - 1].position ?? 0;
                            const next = items[newIndex + 1].position ?? 0;
                            newPosition = (prev + next) / 2;
                        }

                        actionError = null;
                        await ticketsHook.update(movedTicketId, {
                            status: targetStatus,
                            position: newPosition,
                        });
                    } catch (error) {
                        actionError = String(error);
                    }
                })();
            },
        };
    }

    // ── Modal state (Add / Edit) ───────────────────────────────────────────────
    let modalOpen = $state(false);
    let editTicket = $state<Ticket | null>(null);
    let targetStatus = $state<TicketStatus>("todo");

    // ── Preview sheet state ───────────────────────────────────────────────────
    let previewOpen = $state(false);
    // Store only the ID so the sheet always reads the live ticket from the store
    let previewTicketId = $state<string | null>(null);
    const previewTicket = $derived(
        previewTicketId
            ? (ticketsHook.tickets.find((t) => t.id === previewTicketId) ??
                  null)
            : null,
    );

    function openPreviewSheet(ticket: Ticket) {
        previewTicketId = ticket.id;
        previewOpen = true;
    }

    function openAddModal(status: TicketStatus) {
        editTicket = null;
        targetStatus = status;
        actionError = null;
        modalOpen = true;
    }

    function openEditModal(ticket: Ticket) {
        editTicket = ticket;
        actionError = null;
        modalOpen = true;
    }

    async function handleSubmit(data: any) {
        const board_id = getBoardId();
        if (!board_id) return;
        actionError = null;
        if (data.id) {
            await ticketsHook.update(data.id, {
                title: data.title,
                description: data.description,
                priority: data.priority,
                ticket_type: data.ticketType,
                start_date: data.startDate || null,
                due_date: data.dueDate || null,
                labels: data.tags,
            });
        } else {
            await ticketsHook.create({
                board_id,
                title: data.title,
                description: data.description,
                status: data.status,
                priority: data.priority,
                ticket_type: data.ticketType,
                start_date: data.startDate || null,
                due_date: data.dueDate || null,
                labels: data.tags,
            });
        }
    }

    let deleteTicketTarget = $state<Ticket | null>(null);
    let deleteTicketModalOpen = $state(false);

    function promptDeleteTicket(id: string) {
        const t = ticketsHook.tickets.find((t) => t.id === id);
        if (t) {
            deleteTicketTarget = t;
            deleteTicketModalOpen = true;
        }
    }

    async function confirmDeleteTicket() {
        if (!deleteTicketTarget) return;
        try {
            actionError = null;
            await ticketsHook.remove(deleteTicketTarget.id);
        } catch (error) {
            actionError = String(error);
        } finally {
            deleteTicketModalOpen = false;
            deleteTicketTarget = null;
        }
    }

    async function handleStatusChange(id: string, status: TicketStatus) {
        try {
            actionError = null;
            await ticketsHook.update(id, { status });
        } catch (error) {
            actionError = String(error);
        }
    }

    async function handleAddComment(ticketId: string, body: string) {
        const workspacePath = shell.workspace.path;
        if (!workspacePath) return;

        // The author is app-level ("who is operating"), never workspace-level.
        const author = await resolveAuthorName();

        const comment: Comment = {
            author,
            body,
            timestamp: new Date().toISOString(),
        };

        await ticketsHook.addComment(ticketId, comment);
    }

    // ── Stats (exclude backlog from progress) ─────────────────────────────────
    // Counts come from the DB aggregates, not from the (paginated) loaded
    // tickets, so hidden and partly-loaded columns still report real totals.
    const BUILTIN_DONE: TicketStatus = "done";
    const BUILTIN_BACKLOG: TicketStatus = "backlog";

    const activeTickets = $derived(
        columnsApi.columns
            .filter((column) => column.status !== BUILTIN_BACKLOG)
            .reduce(
                (sum, column) => sum + (ticketsHook.counts[column.status] ?? 0),
                0,
            ),
    );
    const doneCount = $derived(ticketsHook.counts[BUILTIN_DONE] ?? 0);
    const progress = $derived(
        activeTickets > 0 ? Math.round((doneCount / activeTickets) * 100) : 0,
    );
    const backlogCount = $derived(ticketsHook.counts[BUILTIN_BACKLOG] ?? 0);

    // Listen for create-ticket events from the command palette / shortcuts
    $effect(() => {
        const handler = () => openAddModal("todo");
        window.addEventListener("worklog:create-ticket", handler);
        return () =>
            window.removeEventListener("worklog:create-ticket", handler);
    });
</script>

<!-- ── Board Shell ─────────────────────────────────────────────────────────── -->
<div class="board-shell">
    <!-- Stats strip -->
    <div class="board-stats-strip">
        <span class="stats-text"
            >{m.kanban_stats_done({
                done: doneCount,
                total: activeTickets,
            })}</span
        >
        <div class="progress-bar">
            <div class="progress-fill" style="width: {progress}%"></div>
        </div>
        {#if backlogCount > 0}
            <span class="stats-text stats-backlog"
                >{m.kanban_stats_backlog({ count: backlogCount })}</span
            >
        {/if}

        <span class="stats-spacer"></span>

        <!-- Column manager entry point -->
        <Button
            kind="ghost"
            size="small"
            icon={Settings}
            onclick={() => (managerOpen = true)}
            title={m.column_manager_aria()}
        >
            {m.column_manager_title()}
        </Button>
    </div>

    {#if searchQuery && filteredColumns.every((c) => c.tickets.length === 0)}
        <InlineNotification
            kind="info"
            title={m.kanban_no_results_title()}
            subtitle={m.kanban_no_results_subtitle({ query: searchQuery })}
            hideCloseButton
        />
    {/if}

    {#if loadError}
        <InlineNotification
            kind="error"
            title={m.kanban_load_error_title()}
            subtitle={loadError}
            hideCloseButton
        />
    {/if}

    {#if actionError}
        <InlineNotification
            kind="error"
            title={m.kanban_action_error_title()}
            subtitle={actionError}
            hideCloseButton
        />
    {/if}

    {#if columnsApi.saveError}
        <InlineNotification
            kind="error"
            title={m.column_save_error_title()}
            subtitle={columnsApi.saveError}
            on:close={() => columnsApi.clearSaveError()}
        />
    {/if}

    <!-- Columns -->
    <div
        class="board-columns"
        class:scroll-locked={previewOpen}
        role="main"
        aria-label={m.kanban_board_aria()}
    >
        {#if columns.length === 0 && !columnsApi.loading}
            <div class="all-hidden-state">
                <ViewOff size={32} />
                <h3>{m.column_all_hidden_title()}</h3>
                <p>{m.column_all_hidden_desc()}</p>
                <Button kind="tertiary" size="small" onclick={() => (managerOpen = true)}>
                    {m.column_manager_title()}
                </Button>
            </div>
        {:else}
            {#each filteredColumns as col (col.status)}
                {@const handlers = makeHandlers(col.status)}
                <KanbanColumn
                    label={col.label}
                    status={col.status}
                    tickets={col.tickets}
                    note={col.note}
                    collapsed={col.collapsed}
                    totalCount={ticketsHook.counts[col.status]}
                    accentColor={col.accentColor}
                    isLoading={ticketsHook.loading}
                    onconsider={handlers.consider}
                    onfinalize={handlers.finalize}
                    onloadMore={ticketsHook.loadMore}
                    onAddTicket={openAddModal}
                    onEditTicket={openEditModal}
                    onDeleteTicket={promptDeleteTicket}
                    onStatusChange={handleStatusChange}
                    onPreviewTicket={openPreviewSheet}
                    onToggleCollapse={(status) => void columnsApi.toggleCollapsed(status)}
                    icon={col.icon}
                    grow={col.collapsed ? 0 : col.grow}
                />
            {/each}
        {/if}

        <!-- Hidden columns stay reachable without opening the manager -->
        {#if hiddenColumnList.length > 0}
            <aside class="hidden-columns-card">
                <div class="hidden-columns-header">
                    <ViewOff size={16} />
                    <span>{m.column_hidden_strip({ count: hiddenColumnList.length })}</span>
                </div>
                <p class="hidden-columns-hint">{m.column_hidden_strip_hint()}</p>
                <div class="hidden-columns-list">
                    {#each hiddenColumnList as column (column.status)}
                        <button
                            type="button"
                            class="hidden-column-item"
                            onclick={() => void columnsApi.toggleHidden(column.status)}
                            title={column.note ?? builtinColumnNote(column.status)}
                        >
                            <span>{statusLabel(column.status)}</span>
                            <View size={14} />
                        </button>
                    {/each}
                </div>
            </aside>
        {/if}
    </div>
</div>

<!-- ── Column Manager ───────────────────────────────────────────────────────── -->
<KanbanColumnManager
    bind:open={managerOpen}
    columns={columnsApi.columns}
    counts={ticketsHook.counts}
    onAddCustom={(title) => void columnsApi.addCustomColumn(title)}
    onRemove={(status) => void columnsApi.removeColumn(status)}
    onSetTitle={(status, title) => void columnsApi.setTitle(status, title)}
    onSetNote={(status, note) => void columnsApi.setNote(status, note)}
    onReset={(status) => void columnsApi.resetColumn(status)}
    onToggleCollapsed={(status) => void columnsApi.toggleCollapsed(status)}
    onToggleHidden={(status) => void columnsApi.toggleHidden(status)}
    onMove={(status, delta) => void columnsApi.moveColumn(status, delta)}
    onSetWidthShare={(status, weight) =>
        void columnsApi.setWidthShare(status, weight)}
    onResetWidthShares={() => void columnsApi.resetWidthShares()}
/>

<!-- ── Add / Edit Modal ──────────────────────────────────────────────────────── -->
<TicketAddEditModal
    bind:open={modalOpen}
    ticket={editTicket}
    defaultStatus={targetStatus}
    onSubmit={handleSubmit}
/>

<TicketDeleteConfirm
    bind:open={deleteTicketModalOpen}
    ticketTitle={deleteTicketTarget?.title ?? ""}
    onConfirm={confirmDeleteTicket}
/>

<!-- ── Ticket Preview Sheet ──────────────────────────────────────────────────── -->
<TicketPreviewSheet
    bind:open={previewOpen}
    ticket={previewTicket}
    onEdit={(t) => {
        previewOpen = false;
        openEditModal(t);
    }}
    onDelete={(id) => {
        previewOpen = false;
        promptDeleteTicket(id);
    }}
    onStatusChange={handleStatusChange}
    onAddComment={handleAddComment}
/>

<style>
    .board-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--cds-ui-background);
    }

    /* Columns scroll area */
    .board-columns {
        display: flex;
        gap: 1rem;
        padding: 1rem;
        overflow-x: auto;
        overflow-y: hidden;
        flex: 1;
        min-height: 0;

        /* Nice momentum scroll on macOS/iOS */
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
        scrollbar-color: var(--cds-ui-04) transparent;
    }

    .board-columns::-webkit-scrollbar {
        height: 6px;
    }
    .board-columns::-webkit-scrollbar-track {
        background: transparent;
    }
    .board-columns::-webkit-scrollbar-thumb {
        background: var(--cds-ui-04);
        border-radius: 3px;
    }

    /* Hide scrollbar when preview sheet is open — Webkit renders native
       scrollbars above position:fixed elements, so we must remove them. */
    .board-columns.scroll-locked {
        overflow: hidden;
    }

    /* Stats strip */
    .board-stats-strip {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.375rem 1rem;
        border-bottom: 1px solid var(--cds-ui-03);
        flex-shrink: 0;
        background: var(--cds-ui-background);
    }

    .stats-text {
        font-size: 0.75rem;
        color: var(--cds-text-02);
        white-space: nowrap;
    }

    .stats-backlog {
        opacity: 0.7;
    }

    .stats-spacer {
        flex: 1;
    }

    .progress-bar {
        width: 100px;
        height: 4px;
        background: var(--cds-ui-03);
        border-radius: 2px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background: var(--cds-support-02);
        border-radius: 2px;
        transition: width 0.4s ease;
    }

    /* ── All columns hidden ─────────────────────────────────────────────── */
    .all-hidden-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        width: 100%;
        text-align: center;
        color: var(--cds-text-02);
    }

    .all-hidden-state h3 {
        margin: 0;
        font-size: 1rem;
        color: var(--cds-text-01);
    }

    .all-hidden-state p {
        margin: 0 0 0.5rem;
        font-size: 0.8125rem;
    }

    /* ── Hidden columns card ─────────────────────────────────────────────── */
    .hidden-columns-card {
        flex: 0 0 220px;
        align-self: flex-start;
        border: 1px dashed var(--cds-ui-04);
        border-radius: 2px;
        padding: 0.75rem;
        background: transparent;
    }

    .hidden-columns-header {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--cds-text-02);
        margin-bottom: 0.25rem;
    }

    .hidden-columns-hint {
        font-size: 0.6875rem;
        color: var(--cds-text-02);
        margin: 0 0 0.5rem;
        opacity: 0.8;
    }

    .hidden-columns-list {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .hidden-column-item {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.25rem 0.375rem;
        font-size: 0.75rem;
        color: var(--cds-text-01);
        border-radius: 2px;
        cursor: pointer;
    }

    .hidden-column-item:hover {
        background: var(--cds-hover-ui);
    }

    .hidden-column-item:focus-visible {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: -2px;
    }
</style>
