<script lang="ts">
    import { InlineNotification } from "carbon-components-svelte";
    import { getTickets } from "$lib/hooks/tickets.svelte";
    import { getWorkspaceShellContext } from "$lib/hooks/workspace-shell-context";
    import type { Ticket, TicketStatus } from "$lib/components/app/types";
    import { type Comment } from "$lib/components/app/types";
    // Extracted Components
    import GanttToolbar from "./gantt-toolbar.svelte";
    import GanttColHeaders from "./gantt-col-headers.svelte";
    import GanttLabels from "./gantt-labels.svelte";
    import GanttCanvas from "./gantt-canvas.svelte";
    import GanttTooltip from "./gantt-tooltip.svelte";
    import { GanttState, setGanttState } from "./gantt-state.svelte";

    // Modals
    import TicketAddEditModal from "../kanban/ticket-add-edit-modal.svelte";
    import TicketDeleteConfirm from "../kanban/ticket-delete-confirm.svelte";
    import TicketPreviewSheet from "../kanban/ticket-preview-sheet.svelte";
    import { resolveAuthorName } from "$lib/app-config/app-config.svelte";
    import * as m from "$lib/paraglide/messages.js";

    let { searchQuery = "" }: { searchQuery?: string } = $props();

    const shell = getWorkspaceShellContext();
    const { ticketTypesApi } = shell;
    const getWorkspacePath = () => shell.workspace.path;
    const getBoardId = () => shell.boardsApi.active?.id ?? null;
    const ticketsHook = getTickets(getWorkspacePath, getBoardId);

    let actionError = $state<string | null>(null);

    // Initialize State Context — pass searchQuery getter so parent drives filtering
    const gantt = new GanttState(
        ticketsHook,
        ticketTypesApi,
        () => searchQuery,
    );
    setGanttState(gantt);

    // Auto-scroll to today on mount
    let hasScrolledToToday = false;
    $effect(() => {
        const _offset = gantt.todayOffset;
        const _canvas = gantt.canvasRef;

        if (!_canvas || _offset <= 0 || hasScrolledToToday) return;

        const tryScroll = () => {
            if (!gantt.canvasRef || gantt.canvasRef.clientWidth === 0) {
                setTimeout(tryScroll, 50);
                return;
            }
            hasScrolledToToday = true;
            const viewportWidth = gantt.canvasRef.clientWidth;
            gantt.canvasRef.scrollLeft = Math.max(
                0,
                _offset - viewportWidth / 3,
            );
            if (gantt.rightPanelRef)
                gantt.rightPanelRef.scrollLeft = gantt.canvasRef.scrollLeft;
        };

        requestAnimationFrame(tryScroll);
    });

    // Modals State
    let editModalOpen = $state(false);
    let editTicket = $state<Ticket | null>(null);
    let deleteModalOpen = $state(false);
    let deleteTarget = $state<Ticket | null>(null);

    function handleBarClick(ticket: Ticket) {
        previewTicketId = ticket.id;
        previewOpen = true;
    }

    async function submitTicket(data: any) {
        const boardId = getBoardId();
        if (!boardId) return;
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
                board_id: boardId,
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

    async function confirmDelete() {
        if (deleteTarget) {
            await ticketsHook.remove(deleteTarget.id);
            deleteTarget = null;
        }
    }

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

    async function handleStatusChange(id: string, status: TicketStatus) {
        try {
            actionError = null;
            await ticketsHook.update(id, { status });
        } catch (error) {
            actionError = String(error);
        }
    }

    function openEditModal(ticket: Ticket) {
        editTicket = ticket;
        actionError = null;
        editModalOpen = true;
    }
    let deleteTicketTarget = $state<Ticket | null>(null);

    function promptDeleteTicket(id: string) {
        const t = ticketsHook.tickets.find((t) => t.id === id);
        if (t) {
            deleteTicketTarget = t;
            deleteModalOpen = true;
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
</script>

<div class="gantt-shell">
    <GanttToolbar />

    {#if gantt.filteredTickets.length === 0}
        <div class="gantt-empty">
            <InlineNotification
                kind="info"
                title={m.gantt_no_tickets()}
                subtitle={searchQuery
                    ? m.kanban_no_results_subtitle({ query: searchQuery })
                    : m.gantt_create_tickets()}
                hideCloseButton
            />
        </div>
    {:else}
        <div class="gantt-grid">
            <div class="gantt-corner">
                <span>{m.gantt_corner_ticket()}</span>
            </div>

            <GanttColHeaders />
            <GanttLabels />
            <GanttCanvas onTicketClick={handleBarClick} />
        </div>
    {/if}

    <GanttTooltip />
</div>

<!-- Modals -->
<TicketAddEditModal
    bind:open={editModalOpen}
    ticket={editTicket}
    onSubmit={submitTicket}
/>

<TicketDeleteConfirm
    bind:open={deleteModalOpen}
    ticketTitle={deleteTarget?.title ?? ""}
    onConfirm={confirmDelete}
/>

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
    .gantt-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--cds-ui-background);
        overflow: hidden;
    }

    .gantt-empty {
        padding: 1rem;
    }

    .gantt-grid {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: 220px 1fr;
        grid-template-rows: 48px 1fr;
    }

    .gantt-corner {
        grid-row: 1;
        grid-column: 1;
        display: flex;
        align-items: flex-end;
        padding: 0 0.75rem 0.375rem;
        background: var(--cds-ui-01);
        border-bottom: 1px solid var(--cds-ui-03);
        border-right: 1px solid var(--cds-ui-03);
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--cds-text-02);
        z-index: 4;
    }
</style>
