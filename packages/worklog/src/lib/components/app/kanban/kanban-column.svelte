<!-- src/lib/components/app/kanban/kanban-column.svelte -->
<script lang="ts">
    import { dndzone } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import { Button, Tag, InlineLoading } from "carbon-components-svelte";
    import { Add, ChevronLeft, ChevronRight } from "carbon-icons-svelte";
    import KanbanTicketCard from "./kanban-ticket-card.svelte";
    import type { Ticket, TicketStatus } from "$lib/components/app/types";
    import * as m from "$lib/paraglide/messages.js";

    let {
        label,
        status,
        tickets,
        note = "",
        collapsed = false,
        icon,
        grow = 1,
        totalCount = 0,
        accentColor = "blue",
        isLoading = false,
        onconsider,
        onfinalize,
        onloadMore,
        onAddTicket,
        onEditTicket,
        onDeleteTicket,
        onStatusChange,
        onPreviewTicket,
        onToggleCollapse,
    }: {
        label: string;
        status: TicketStatus;
        tickets: Ticket[];
        /** Effective remark — the custom one, or the built-in default. */
        note?: string;
        collapsed?: boolean;
        /** Column icon, resolved by the board (custom stages get their own). */
        icon: any;
        /** Planned width weight; the board's width is split in these ratios. */
        grow?: number;
        totalCount?: number;
        accentColor?: string;
        isLoading?: boolean;
        onconsider: (e: CustomEvent) => void;
        onfinalize: (e: CustomEvent) => void;
        onloadMore?: (status: TicketStatus) => void;
        onAddTicket?: (status: TicketStatus) => void;
        onEditTicket?: (ticket: Ticket) => void;
        onDeleteTicket?: (id: string) => void;
        onStatusChange?: (id: string, status: TicketStatus) => void;
        onPreviewTicket?: (ticket: Ticket) => void;
        onToggleCollapse?: (status: TicketStatus) => void;
    } = $props();

    let loadingMore = $state(false);
    const hasMore = $derived(tickets.length < totalCount);

    function setupObserver(node: HTMLElement) {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !loadingMore && !isLoading) {
                    void (async () => {
                        loadingMore = true;
                        await onloadMore?.(status);
                        loadingMore = false;
                    })();
                }
            },
            { threshold: 0.1 }
        );

        observer.observe(node);
        return {
            destroy() {
                observer.disconnect();
            },
        };
    }

    const flipDurationMs = 180;

    // Color map for the column header accent
    const colorVarMap: Record<string, string> = {
        blue: "var(--cds-interactive-01)",
        green: "var(--cds-support-02)",
        yellow: "var(--cds-support-03)",
        red: "var(--cds-support-01)",
        magenta: "#e5399e",
        teal: "var(--cds-support-04)",
    };

    const StatusIcon = $derived(icon);

    const headerColor = $derived(
        colorVarMap[accentColor] ?? colorVarMap["blue"],
    );

    // dndzone expects the zone list to be updated from event payloads.
    let zoneItems = $state<Ticket[]>([]);

    $effect(() => {
        zoneItems = tickets;
    });

    function handleConsider(e: CustomEvent) {
        const detail = e.detail as { items?: Ticket[] };
        zoneItems = detail.items ?? zoneItems;
        onconsider(e);
    }

    function handleFinalize(e: CustomEvent) {
        const detail = e.detail as { items?: Ticket[] };
        zoneItems = detail.items ?? zoneItems;
        onfinalize(e);
    }
</script>

{#if collapsed}
    <!-- ── Collapsed rail — still on the board, no drop target ──────────── -->
    <section
        class="kanban-column kanban-column--collapsed"
        style="--accent: {headerColor}"
        aria-label={m.kanban_column_aria_label({ label })}
    >
        <button
            type="button"
            class="rail"
            onclick={() => onToggleCollapse?.(status)}
            title={note || m.column_action_expand()}
            aria-label={m.column_expand_action_aria({ label })}
            aria-expanded="false"
        >
            <span class="rail-icon"><StatusIcon size={16} /></span>
            <span class="rail-label">{label}</span>
            <span class="rail-count">{zoneItems.length}</span>
            <span class="rail-chevron"><ChevronRight size={16} /></span>
        </button>
    </section>
{:else}
    <section
        class="kanban-column"
        style="--column-grow: {grow}"
        aria-label={m.kanban_column_aria_label({ label })}
    >
        <!-- Column header -->
        <header class="column-header" style="--accent: {headerColor}">
            <div class="column-title-row">
                <div class="column-title-group">
                    <StatusIcon size={16} class="column-status-icon" />
                    <h3 class="column-label">{label}</h3>
                </div>
                <div class="column-header-actions">
                    <Tag size="sm" type="outline">{zoneItems.length}</Tag>
                    <button
                        type="button"
                        class="column-icon-btn"
                        onclick={() => onToggleCollapse?.(status)}
                        title={m.column_action_collapse()}
                        aria-label={m.column_collapse_action_aria({ label })}
                        aria-expanded="true"
                    >
                        <ChevronLeft size={16} />
                    </button>
                </div>
            </div>
            {#if note}
                <p class="column-note" title={note}>{note}</p>
            {/if}
            <div class="column-accent-bar"></div>
        </header>

        <!-- Drop zone -->
        <div
            class="drop-zone"
            use:dndzone={{
                items: zoneItems,
                flipDurationMs,
                type: "kanban-ticket",
            }}
            onconsider={handleConsider}
            onfinalize={handleFinalize}
            role="list"
            aria-label={m.kanban_column_tickets_aria_label({ label })}
        >
            {#if isLoading}
                <div class="column-loading">
                    <InlineLoading description={m.kanban_column_loading()} />
                </div>
            {:else}
                {#each zoneItems as ticket (ticket.id)}
                    <div
                        animate:flip={{ duration: flipDurationMs }}
                        class="ticket-wrapper"
                        role="listitem"
                    >
                        <KanbanTicketCard
                            {ticket}
                            onEdit={onEditTicket}
                            onDelete={onDeleteTicket}
                            {onStatusChange}
                            onPreview={onPreviewTicket}
                        />
                    </div>
                {/each}

                <!-- Intersection sentinel -->
                <div use:setupObserver class="sentinel"></div>

                {#if loadingMore}
                    <div class="column-loading-more">
                        <InlineLoading description={m.kanban_column_loading_more()} />
                    </div>
                {/if}

                {#if zoneItems.length === 0}
                    <div class="empty-state" aria-hidden="true">
                        <span class="empty-state-text">{m.kanban_column_empty()}</span>
                    </div>
                {/if}
            {/if}
        </div>

        <!-- Add todo button -->
        <div class="column-footer">
            <Button
                kind="ghost"
                size="small"
                icon={Add}
                on:click={() => onAddTicket?.(status)}
            >
                {m.kanban_column_add_ticket()}
            </Button>
        </div>
    </section>
{/if}

<style>
    /* Width is planned per board.
     *
     * `flex-basis: 0` makes the *whole* row's free space available, which is
     * then handed out strictly in the ratios of `--column-grow`, so the plan in
     * the column manager really governs the layout.
     *
     * The floor must stay far below an even split: at a large floor every
     * column is pinned to it and the weights cannot be seen at all. This is a
     * last-resort guard for very small windows — the planner already limits how
     * thin a share can get (MIN_WIDTH_SHARE), so a deliberate narrow column is
     * honoured. */
    .kanban-column {
        display: flex;
        flex-direction: column;
        background: var(--cds-ui-background);
        border: 1px solid var(--cds-ui-03);
        flex: var(--column-grow, 1) 1 0;
        min-width: 5rem;
        border-radius: 2px;
        overflow: hidden;
        /* Fill parent height */
        align-self: stretch;
    }

    /* ── Collapsed rail ─────────────────────────────────────────────────── */
    /* A collapsed column is a fixed rail — it takes no share of the width. */
    .kanban-column--collapsed {
        width: 3rem;
        flex: 0 0 3rem;
        min-width: 3rem;
        border-left: 3px solid var(--accent);
    }

    .rail {
        all: unset;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        height: 100%;
        padding: 0.75rem 0.25rem;
        cursor: pointer;
        color: var(--cds-text-01);
        background: var(--cds-ui-01);
    }

    .rail:hover {
        background: var(--cds-hover-ui);
    }

    .rail:focus-visible {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: -2px;
    }

    .rail-icon {
        display: flex;
        color: var(--accent);
        flex-shrink: 0;
    }

    /* Vertical label — truncated rather than wrapped so the rail stays slim */
    .rail-label {
        writing-mode: vertical-rl;
        font-size: 0.8125rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        max-height: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-height: 0;
    }

    .rail-count {
        font-size: 0.75rem;
        color: var(--cds-text-02);
        flex-shrink: 0;
    }

    .rail-chevron {
        display: flex;
        color: var(--cds-text-02);
        flex-shrink: 0;
        margin-top: auto;
    }

    /* Header */
    .column-header {
        padding: 0.875rem 1rem 0;
        background: var(--cds-ui-01);
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .column-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .column-title-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
    }

    .column-title-group :global(svg) {
        color: var(--accent);
        flex-shrink: 0;
    }

    .column-label {
        font-size: 0.8125rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--cds-text-01);
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .column-header-actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-shrink: 0;
    }

    .column-icon-btn {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 2px;
        cursor: pointer;
        color: var(--cds-text-02);
    }

    .column-icon-btn:hover {
        color: var(--cds-text-01);
        background: var(--cds-hover-ui);
    }

    .column-icon-btn:focus-visible {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: -2px;
    }

    /* Column remark — built-in default or the user's own */
    .column-note {
        font-size: 0.6875rem;
        line-height: 1.35;
        color: var(--cds-text-02);
        margin: 0 0 0.5rem;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .column-accent-bar {
        height: 3px;
        background: var(--accent);
        margin: 0 -1rem;
        border-radius: 0;
    }

    /* Drop zone — fills remaining height */
    .drop-zone {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem;
        min-height: 120px;
        overflow-y: auto;
        /* Hide scrollbar */
        scrollbar-width: none; /* Firefox */
        -ms-overflow-style: none;  /* IE and Edge */
    }

    .drop-zone::-webkit-scrollbar {
        display: none; /* Chrome, Safari and Opera */
    }

    .ticket-wrapper {
        outline: none;
    }

    /* Empty state */
    .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 80px;
    }

    .empty-state-text {
        font-size: 0.75rem;
        color: var(--cds-text-placeholder);
        font-style: italic;
    }

    .column-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
    }

    /* Footer */
    .column-footer {
        padding: 0.5rem;
        border-top: 1px solid var(--cds-ui-03);
        background: var(--cds-ui-01);
    }

    .column-footer :global(.bx--btn--ghost) {
        width: 100%;
        max-width: 100%;
        justify-content: flex-start;
        color: var(--cds-text-02);
    }

    .column-footer :global(.bx--btn--ghost:hover) {
        color: var(--cds-text-01);
        background: var(--cds-hover-ui);
    }
    .sentinel {
        height: 1px;
        width: 100%;
        pointer-events: none;
    }

    .column-loading-more {
        padding: 0.5rem;
        display: flex;
        justify-content: center;
    }
</style>
