import type Database from '@tauri-apps/plugin-sql';
import { getDb } from '$lib/db';
import { BoardRepo, WorkspaceRepo } from '$lib/db';
import { authorNameNow, loadAppConfig } from '$lib/app-config/app-config.svelte';
import type { Ticket } from '$lib/components/app/types';
import type {
    PushTarget,
    PushRecord,
    PushResult,
    PushContext,
    PushVariableValues,
    PushPreview,
    CreatePushTargetInput,
    UpdatePushTargetInput,
} from './types';
import { PushTargetRepo } from './push-target.repo';
import { PushRecordRepo, type PushRecordFilter } from './push-record.repo';
import { PushEngine } from './push-engine';
import { parseVariables } from './field-catalog';

/** Build-time app version injected by Vite's `define` (see vite.config.js). */
declare const __APP_VERSION__: string | undefined;

function readAppVersion(): string {
    try {
        // eslint-disable-next-line no-undef
        return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
    } catch {
        return '';
    }
}

/**
 * Reactive hook for remote push functionality.
 *
 * Exposes the target list, the push history, and the operations used by the
 * push dialog. All payload construction lives in PushEngine so that previews
 * and real pushes can never drift apart.
 */
export function getPushHook(getWorkspacePath: () => string | null) {
    // ── Reactive State ────────────────────────────────────────────────────────
    let _targets = $state<PushTarget[]>([]);
    let _records = $state<PushRecord[]>([]);
    let _loading = $state(false);
    let _pushing = $state(false);

    // ── Helpers ──────────────────────────────────────────────────────────────
    async function requireDb(): Promise<Database> {
        const path = getWorkspacePath();
        if (!path) throw new Error('No workspace selected');
        return getDb(path);
    }

    /**
     * Assemble the ticket + board + app context used to resolve field bindings.
     */
    async function buildContext(db: Database, ticket: Ticket): Promise<PushContext> {
        let board: PushContext['board'] = null;
        let app: PushContext['app'] = {};

        try {
            const b = await BoardRepo.getBoardById(db, ticket.board_id);
            if (b) {
                board = {
                    id: b.id,
                    name: b.name,
                    description: b.description,
                };
            }
        } catch (e) {
            console.error('[push-hook] Failed to load board context:', e);
        }

        // Author is an app-level value; workspace DB no longer stores identity.
        await loadAppConfig();
        app.author_name = authorNameNow();

        try {
            const meta = await WorkspaceRepo.getWorkspaceMeta(db);
            app.workspace_name = meta?.name ?? '';
        } catch {
            // workspace_meta is optional context
        }

        app.version = readAppVersion();

        return { ticket, board, app };
    }

    // ── Targets ──────────────────────────────────────────────────────────────

    async function loadTargets() {
        _loading = true;
        try {
            const db = await requireDb();
            _targets = await PushTargetRepo.list(db);
        } catch (e) {
            console.error('[push-hook] Failed to load targets:', e);
        } finally {
            _loading = false;
        }
    }

    async function createTarget(input: CreatePushTargetInput): Promise<PushTarget> {
        const db = await requireDb();
        const target = await PushTargetRepo.create(db, input);
        _targets = [..._targets, target];
        return target;
    }

    async function updateTarget(id: string, input: UpdatePushTargetInput): Promise<void> {
        const db = await requireDb();
        const updated = await PushTargetRepo.update(db, id, input);
        if (updated) {
            _targets = _targets.map((t) => (t.id === id ? updated : t));
        }
    }

    async function deleteTarget(id: string): Promise<void> {
        const db = await requireDb();
        await PushRecordRepo.deleteByTarget(db, id);
        await PushTargetRepo.delete(db, id);
        _targets = _targets.filter((t) => t.id !== id);
    }

    // ── Records ──────────────────────────────────────────────────────────────

    async function loadRecords(filter: PushRecordFilter = {}) {
        _loading = true;
        try {
            const db = await requireDb();
            _records = await PushRecordRepo.list(db, filter);
        } catch (e) {
            console.error('[push-hook] Failed to load records:', e);
        } finally {
            _loading = false;
        }
    }

    // ── Preview ──────────────────────────────────────────────────────────────

    /**
     * Build the request preview for a ticket/target/variable combination.
     * Returns null when the target cannot be resolved.
     */
    async function previewPush(
        ticket: Ticket,
        target: PushTarget,
        variableValues: PushVariableValues,
    ): Promise<PushPreview | null> {
        try {
            const db = await requireDb();
            const ctx = await buildContext(db, ticket);
            const engine = new PushEngine(db);
            return engine.buildPreview(target, ctx, variableValues);
        } catch (e) {
            console.error('[push-hook] Failed to build preview:', e);
            return null;
        }
    }

    /** Variable definitions declared on a target. */
    function targetVariables(target: PushTarget | null | undefined) {
        return target ? parseVariables(target.variables) : [];
    }

    // ── Execute Push ─────────────────────────────────────────────────────────

    async function pushTicket(
        ticket: Ticket,
        targetId: string,
        variableValues: PushVariableValues = {},
    ): Promise<PushResult> {
        const db = await requireDb();
        const target = await PushTargetRepo.getById(db, targetId);
        if (!target) throw new Error(`Push target ${targetId} not found`);
        if (!target.enabled) throw new Error(`Push target "${target.name}" is disabled`);

        _pushing = true;
        try {
            const ctx = await buildContext(db, ticket);
            const engine = new PushEngine(db);
            const result = await engine.push(ctx, target, variableValues);

            if (ticket.board_id && !result.record?.error_message?.startsWith('Missing required')) {
                await loadRecords({ board_id: ticket.board_id });
            }

            return result;
        } finally {
            _pushing = false;
        }
    }

    async function retryPush(
        record: PushRecord,
        ticket: Ticket,
        variableValues: PushVariableValues = {},
    ): Promise<PushResult> {
        return pushTicket(ticket, record.target_id, variableValues);
    }

    // ── Return API ───────────────────────────────────────────────────────────

    return {
        // State
        get targets() { return _targets; },
        get records() { return _records; },
        get loading() { return _loading; },
        get pushing() { return _pushing; },

        // Target operations
        loadTargets,
        createTarget,
        updateTarget,
        deleteTarget,

        // Record operations
        loadRecords,

        // Preview + variables
        previewPush,
        targetVariables,

        // Push execution
        pushTicket,
        retryPush,
    };
}
