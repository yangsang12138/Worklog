import type Database from '@tauri-apps/plugin-sql';
import {
    EventRepo,
    type EntityType,
    type EventType,
    type CreateEventInput,
} from '$lib/db';
import type { EventRecord } from '$lib/db/repositories/event.repo';
import {
    authorNameNow,
    loadAppConfig,
} from '$lib/app-config/app-config.svelte';

// ── Types ───────────────────────────────────────────────────────────────────

export type TicketLifecycleEventType =
    | 'ticket_created'
    | 'ticket_updated'
    | 'ticket_deleted'
    | 'ticket_moved'
    | 'ticket_archived'
    | 'ticket_restored';

export type BoardLifecycleEventType =
    | 'board_created'
    | 'board_updated'
    | 'board_deleted'
    | 'board_archived'
    | 'board_restored';

export type LifecycleEventType = TicketLifecycleEventType | BoardLifecycleEventType;

export interface LifecycleEventPayload {
    /** Snapshot of the entity state before the change (null for creates) */
    before: Record<string, unknown> | null;
    /** Snapshot of the entity state after the change (null for deletes) */
    after: Record<string, unknown> | null;
    /** Optional human-readable description */
    description?: string;
}

// ── Actor ───────────────────────────────────────────────────────────────────
// The actor is an app-level value (this person), so there is nothing to cache
// per database connection: it is read straight from the app config.

/**
 * Resolve the actor name for lifecycle events.
 *
 * Previously read `app_settings.author_name` from the workspace DB — i.e. the
 * actor changed when you switched workspaces, and the value was synced to
 * teammates. Identity is app-level now.
 */
async function resolveActor(): Promise<string> {
    await loadAppConfig();
    return authorNameNow() || 'unknown';
}

// ── Emit ────────────────────────────────────────────────────────────────────

/**
 * Emit a lifecycle event to the append-only events table.
 * Returns the created EventRecord, or null on failure.
 */
export async function emitEvent(
    db: Database,
    input: {
        entity_type: EntityType;
        entity_id: string;
        event_type: LifecycleEventType;
        payload: LifecycleEventPayload;
    },
): Promise<EventRecord | null> {
    try {
        const actor = await resolveActor();
        const eventInput: CreateEventInput = {
            entity_type: input.entity_type,
            entity_id: input.entity_id,
            event_type: input.event_type as EventType,
            payload: input.payload as unknown as Record<string, unknown>,
            actor,
        };
        return await EventRepo.insertEvent(db, eventInput);
    } catch (error) {
        console.error('Failed to emit event:', error);
        return null;
    }
}

// ── Convenience helpers ─────────────────────────────────────────────────────

export const TicketEvents = {
    created(db: Database, ticketId: string, after: Record<string, unknown>) {
        return emitEvent(db, {
            entity_type: 'ticket',
            entity_id: ticketId,
            event_type: 'ticket_created',
            payload: { before: null, after },
        });
    },

    updated(
        db: Database,
        ticketId: string,
        before: Record<string, unknown> | null,
        after: Record<string, unknown>,
    ) {
        return emitEvent(db, {
            entity_type: 'ticket',
            entity_id: ticketId,
            event_type: 'ticket_updated',
            payload: { before, after },
        });
    },

    deleted(db: Database, ticketId: string, before: Record<string, unknown>) {
        return emitEvent(db, {
            entity_type: 'ticket',
            entity_id: ticketId,
            event_type: 'ticket_deleted',
            payload: { before, after: null },
        });
    },

    moved(
        db: Database,
        ticketId: string,
        fromStatus: string,
        toStatus: string,
        extra?: Record<string, unknown>,
    ) {
        return emitEvent(db, {
            entity_type: 'ticket',
            entity_id: ticketId,
            event_type: 'ticket_moved',
            payload: {
                before: { status: fromStatus, ...extra },
                after: { status: toStatus, ...extra },
            },
        });
    },

    archived(db: Database, ticketId: string, before: Record<string, unknown>) {
        return emitEvent(db, {
            entity_type: 'ticket',
            entity_id: ticketId,
            event_type: 'ticket_archived',
            payload: { before, after: { ...before, archived: true } },
        });
    },

    restored(db: Database, ticketId: string, after: Record<string, unknown>) {
        return emitEvent(db, {
            entity_type: 'ticket',
            entity_id: ticketId,
            event_type: 'ticket_restored',
            payload: {
                before: { ...after, archived: true },
                after,
            },
        });
    },
};

export const BoardEvents = {
    created(db: Database, boardId: string, after: Record<string, unknown>) {
        return emitEvent(db, {
            entity_type: 'board',
            entity_id: boardId,
            event_type: 'board_created',
            payload: { before: null, after },
        });
    },

    updated(
        db: Database,
        boardId: string,
        before: Record<string, unknown> | null,
        after: Record<string, unknown>,
    ) {
        return emitEvent(db, {
            entity_type: 'board',
            entity_id: boardId,
            event_type: 'board_updated',
            payload: { before, after },
        });
    },

    deleted(db: Database, boardId: string, before: Record<string, unknown>) {
        return emitEvent(db, {
            entity_type: 'board',
            entity_id: boardId,
            event_type: 'board_deleted',
            payload: { before, after: null },
        });
    },

    archived(db: Database, boardId: string, before: Record<string, unknown>) {
        return emitEvent(db, {
            entity_type: 'board',
            entity_id: boardId,
            event_type: 'board_archived',
            payload: { before, after: { ...before, archived_at: new Date().toISOString() } },
        });
    },

    restored(db: Database, boardId: string, after: Record<string, unknown>) {
        return emitEvent(db, {
            entity_type: 'board',
            entity_id: boardId,
            event_type: 'board_restored',
            payload: { before: null, after },
        });
    },
};
