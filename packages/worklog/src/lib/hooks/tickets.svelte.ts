import type { Ticket, CreateTicketInput, UpdateTicketInput, Comment } from '$lib/components/app/types';
import { getDb, TicketRepo, BoardRepo } from '$lib/db';
import {
    getUndoRedo,
    registerMutationHandler,
    registerEventPersistence,
    type UndoRedoEvent,
} from '$lib/hooks/undo-redo.svelte';
import { TicketEvents } from '$lib/hooks/events.svelte';


// ── Module-level shared state ──────────────────────────────────────────────
// All consumers share the same reactive _tickets array, so mutations in one
// view (e.g. Kanban reorder) are reflected in every other view (e.g. Overview).
//
// Two load modes:
//   board mode (getBoardId returns a string) — paginated per-status loading
//   all mode   (getBoardId returns null)     — loads every ticket in the workspace
//
// The mode is determined by whether a boardId getter is supplied at call time.

type TicketsMode = 'board' | 'all';

let _tickets = $state<Ticket[]>([]);
let _counts = $state<Record<string, number>>({});
let _loading = $state(false);
let _mode = $state<TicketsMode | null>(null);

// Module-level workspace path getter used by the undo/redo handler.
// Updated each time getTickets() is called so the handler always has
// a live path even after the registering consumer dismounts.
let _getWorkspacePath: () => string | null = () => null;

// ── Undo/redo mutation handler (registered once) ───────────────────────────
let _handlerRegistered = false;

function ensureHandlerRegistered(getPath: () => string | null) {
    if (_handlerRegistered) return;
    _handlerRegistered = true;

    // Register the mutation handler for applying inversions
    registerMutationHandler(async (event: UndoRedoEvent) => {
        const path = _getWorkspacePath();
        if (!path) throw new Error('Cannot undo/redo: no workspace selected');

        const db = await getDb(path);

        switch (event.type) {
            case 'ticket:update': {
                if (!event.after) throw new Error('Invalid undo event: missing after state');
                await TicketRepo.updateTicket(db, event.ticketId, event.after as UpdateTicketInput);
                const updated = await TicketRepo.getTicketById(db, event.ticketId);
                if (updated) {
                    const idx = _tickets.findIndex((t) => t.id === event.ticketId);
                    if (idx !== -1) {
                        _tickets[idx] = updated;
                    }
                }
                break;
            }
            case 'ticket:create': {
                if (!event.after) throw new Error('Invalid undo event: missing after state');
                const created = await TicketRepo.createTicket(db, event.after as unknown as CreateTicketInput);
                _tickets = [..._tickets, created].sort((a, b) => a.position - b.position);
                if (_counts[created.status]) {
                    _counts[created.status] = (_counts[created.status] ?? 0) + 1;
                }
                break;
            }
            case 'ticket:delete': {
                await TicketRepo.deleteTicket(db, event.ticketId);
                const deleted = _tickets.find((t) => t.id === event.ticketId);
                _tickets = _tickets.filter((t) => t.id !== event.ticketId);
                if (deleted?.status) {
                    _counts[deleted.status] = Math.max(0, (_counts[deleted.status] ?? 0) - 1);
                }
                break;
            }
        }
    });

    // Register event persistence — when undo-redo pushes/undoes/redoes,
    // a corresponding lifecycle event is written to the events table.
    registerEventPersistence(async (event: UndoRedoEvent, direction: 'push' | 'undo' | 'redo') => {
        const path = _getWorkspacePath();
        if (!path) return;

        try {
            const db = await getDb(path);

            switch (event.type) {
                case 'ticket:create':
                    if (direction === 'push') {
                        await TicketEvents.created(db, event.ticketId, event.after ?? {});
                    } else if (direction === 'undo') {
                        await TicketEvents.deleted(db, event.ticketId, event.after ?? {});
                    } else {
                        await TicketEvents.created(db, event.ticketId, event.after ?? {});
                    }
                    break;
                case 'ticket:delete':
                    if (direction === 'push') {
                        await TicketEvents.deleted(db, event.ticketId, event.before ?? {});
                    } else if (direction === 'undo') {
                        await TicketEvents.created(db, event.ticketId, event.before ?? {});
                    } else {
                        await TicketEvents.deleted(db, event.ticketId, event.before ?? {});
                    }
                    break;
                case 'ticket:update':
                    if (direction === 'push') {
                        // The push was already handled by the direct emit in update()/move()
                    } else {
                        await TicketEvents.updated(db, event.ticketId, event.after, event.before ?? {});
                    }
                    break;
            }
        } catch (err) {
            console.error('Event persistence failed:', err);
        }
    });
}

/**
 * Unified ticket hook — shared singleton that combines board-scoped
 * and all-tickets modes. Mutations from any consumer are reflected
 * everywhere.
 *
 * Pass a boardId getter to load board-scoped tickets (paginated by status).
 * Omit it (or return null) to load all tickets across the workspace.
 *
 * Example — board scope:
 *   const tickets = getTickets(() => path, () => boardId);
 *
 * Example — all scope:
 *   const tickets = getTickets(() => path);
 */
export function getTickets(
    getWorkspacePath: () => string | null,
    getBoardId?: () => string | null,
) {
    const hasBoardScope = !!getBoardId;

    // Keep the handler's path getter live
    _getWorkspacePath = getWorkspacePath;
    ensureHandlerRegistered(getWorkspacePath);

    function requireWorkspacePath(): string {
        const path = getWorkspacePath();
        if (!path) throw new Error('No workspace selected');
        return path;
    }

    // ── Local undo-redo instance ──────────────────────────────────────────
    const _undoRedo = getUndoRedo();

    // ── Load ────────────────────────────────────────────────────────────────
    async function load() {
        const workspacePath = getWorkspacePath();
        const boardId = hasBoardScope ? getBoardId!() : null;

        // Clear existing tickets immediately to avoid flashing old data
        _tickets = [];
        _counts = {};

        if (!workspacePath) return;

        // In board mode, also require a board ID
        if (hasBoardScope && !boardId) return;

        _mode = hasBoardScope ? 'board' : 'all';
        _loading = true;
        try {
            const db = await getDb(workspacePath);

            if (hasBoardScope && boardId) {
                // ── Board-scoped: paginated per column ───────────────────────
                // Statuses come from the board's column configuration, not a
                // fixed list — a board can own custom stages.
                const columns = await BoardRepo.getBoardColumns(db, boardId);
                const statuses = columns.map((column) => column.status);
                const [batchResults, countResults] = await Promise.all([
                    Promise.all(statuses.map(s => TicketRepo.listTickets(db, boardId, { status: s, limit: 20 }))),
                    Promise.all(statuses.map(s => TicketRepo.countTicketsByStatus(db, boardId, s)))
                ]);

                _tickets = batchResults.flat();
                _counts = Object.fromEntries(statuses.map((s, i) => [s, countResults[i]]));
            } else {
                // ── All tickets: full workspace ──────────────────────────────
                _tickets = await TicketRepo.listAllTickets(db);
            }
        } finally {
            _loading = false;
        }
    }

    // ── Load More (board scope only) ────────────────────────────────────────
    async function loadMore(status: string) {
        const workspacePath = getWorkspacePath();
        const boardId = hasBoardScope ? getBoardId!() : null;
        if (!workspacePath || !boardId) return;

        const currentCount = _tickets.filter(t => t.status === status).length;
        const total = _counts[status] ?? 0;

        if (currentCount >= total) return;

        const db = await getDb(workspacePath);
        const batch = await TicketRepo.listTickets(db, boardId, {
            status,
            limit: 20,
            offset: currentCount
        });

        // Append new tickets and sort them by position
        _tickets = [..._tickets, ...batch].sort((a, b) => a.position - b.position);
    }

    // ── Create ──────────────────────────────────────────────────────────────
    async function create(input: CreateTicketInput) {
        const workspacePath = requireWorkspacePath();
        const db = await getDb(workspacePath);
        const ticket = await TicketRepo.createTicket(db, input);
        _tickets = [..._tickets, ticket].sort((a, b) => a.position - b.position);
        if (ticket.status) {
            _counts[ticket.status] = (_counts[ticket.status] ?? 0) + 1;
        }

        _undoRedo.push({
            type: 'ticket:create',
            ticketId: ticket.id,
            before: null,
            after: { ...ticket } as unknown as Record<string, unknown>,
            description: `Create ticket ${ticket.id}`,
            timestamp: Date.now(),
        });

        // Emit lifecycle event
        TicketEvents.created(db, ticket.id, { ...ticket } as unknown as Record<string, unknown>)
            .catch((err) => console.error('Failed to emit ticket_created event:', err));

        return ticket;
    }

    // ── Update ──────────────────────────────────────────────────────────────
    async function update(id: string, input: UpdateTicketInput) {
        const workspacePath = requireWorkspacePath();
        const db = await getDb(workspacePath);
        const oldTicket = _tickets.find(t => t.id === id);
        const ticket = await TicketRepo.updateTicket(db, id, input);

        _tickets = _tickets.map(t => t.id === id ? ticket : t).sort((a, b) => a.position - b.position);

        // Track status change for lifecycle event emission
        const statusChanged = oldTicket && input.status && oldTicket.status !== input.status;

        // Update counts if status changed
        if (statusChanged) {
            _counts[oldTicket!.status] = Math.max(0, (_counts[oldTicket!.status] ?? 0) - 1);
            _counts[input.status!] = (_counts[input.status!] ?? 0) + 1;
        }

        // Push undo event — capture only the fields that actually changed
        if (oldTicket) {
            const changedFields: Record<string, unknown> = {};
            const inputKeys = Object.keys(input) as (keyof UpdateTicketInput)[];
            for (const key of inputKeys) {
                const oldVal = oldTicket[key as keyof Ticket];
                const newVal = input[key];
                // Only record if the value actually changed
                if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                    changedFields[key as string] = oldVal as unknown as Record<string, unknown>;
                }
            }

            if (Object.keys(changedFields).length > 0) {
                _undoRedo.push({
                    type: 'ticket:update',
                    ticketId: id,
                    before: changedFields,
                    after: { ...input } as unknown as Record<string, unknown>,
                    description: `Update ticket ${id}`,
                    timestamp: Date.now(),
                });

                // Emit lifecycle events — distinguish moves from regular updates
                if (statusChanged) {
                    TicketEvents.moved(db, id, oldTicket.status, input.status!, {
                        position: input.position,
                    }).catch((err) => console.error('Failed to emit ticket_moved event:', err));
                } else {
                    TicketEvents.updated(db, id, changedFields, { ...input } as unknown as Record<string, unknown>)
                        .catch((err) => console.error('Failed to emit ticket_updated event:', err));
                }
            }
        }

        return ticket;
    }

    // ── Add Comment ─────────────────────────────────────────────────────────
    async function addComment(id: string, comment: Comment) {
        const ticket = _tickets.find(t => t.id === id);
        if (!ticket) throw new Error(`Ticket ${id} not found`);

        const updatedComments: Comment[] = [...ticket.comments, comment];
        return update(id, { comments: updatedComments });
    }

    // ── Remove ──────────────────────────────────────────────────────────────
    async function remove(id: string) {
        const workspacePath = requireWorkspacePath();
        const ticket = _tickets.find(t => t.id === id);
        const db = await getDb(workspacePath);
        await TicketRepo.deleteTicket(db, id);
        _tickets = _tickets.filter(t => t.id !== id);
        if (ticket?.status) {
            _counts[ticket.status] = Math.max(0, (_counts[ticket.status] ?? 0) - 1);
        }

        if (ticket) {
            _undoRedo.push({
                type: 'ticket:delete',
                ticketId: id,
                before: { ...ticket } as unknown as Record<string, unknown>,
                after: null,
                description: `Delete ticket ${id}`,
                timestamp: Date.now(),
            });

            // Emit lifecycle event
            TicketEvents.deleted(db, id, { ...ticket } as unknown as Record<string, unknown>)
                .catch((err) => console.error('Failed to emit ticket_deleted event:', err));
        }
    }

    return {
        get tickets() { return _tickets },
        get counts() { return _counts },
        get loading() { return _loading },
        get mode() { return _mode },
        load, loadMore, create, update, addComment, remove
    };
}

// ── Backward-compatible alias ───────────────────────────────────────────────
// useAllTickets(getWorkspacePath) === getTickets(getWorkspacePath)
/** @deprecated Use `getTickets(path)` instead. Will be removed in a future release. */
export function useAllTickets(getWorkspacePath: () => string | null) {
    return getTickets(getWorkspacePath);
}
