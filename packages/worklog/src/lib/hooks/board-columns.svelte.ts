import type { KanbanColumnConfig, TicketStatus } from '$lib/components/app/types';
import { CUSTOM_COLUMN_ACCENTS } from '$lib/components/app/types';
import { getDb, BoardRepo, TicketRepo } from '$lib/db';
import {
    addCustomColumn as addCustomColumnToList,
    applyViewState,
    extractViewState,
    findColumn,
    legacyViewStateFromStored,
    moveColumn as moveColumnInList,
    patchColumn,
    removeColumn as removeColumnFromList,
    resetColumn as resetColumnInList,
    resetWidthShares as resetWidthShares_,
    setWidthShare as setWidthShareInList,
} from '$lib/db/columns-config';
import {
    hasColumnViewState,
    loadColumnViewState,
    saveColumnViewState,
} from '$lib/hooks/board-view-state';

/**
 * Reactive hook for per-board Kanban column configuration.
 *
 * Owns the board's ordered column list: the four permanent built-in stages
 * plus any custom stages the user added, along with their names, remarks,
 * accents and view state.
 *
 * The list is one object at runtime but has **two owners on disk**, and every
 * write below is routed accordingly:
 *
 *   | fields                              | owner     | why                     |
 *   |-------------------------------------|-----------|-------------------------|
 *   | status, kind, title, note,          | workspace | the team shares the     |
 *   | accentColor, order                  | (DB)      | board's stages and names |
 *   | collapsed, hidden, widthShare       | this      | my layout, my screen    |
 *   |                                     | machine   |                         |
 *
 * The workspace half is a synced field, so keeping the layout half out of it is
 * what stops two people's column widths from fighting in git.
 *
 * State is module-level: the board page and the Kanban view both call this
 * hook and must observe the same configuration. Only one board is active at a
 * time, so a singleton is intentional (same pattern as `tickets.svelte.ts`).
 */

let _columns = $state<KanbanColumnConfig[]>([]);
let _loading = $state(false);
let _lastLoadedBoardId = $state<string | null>(null);
/**
 * Set when a column change could not be written. Without this the optimistic
 * update would just silently snap back and the action would look ignored.
 */
let _saveError = $state<string | null>(null);

export function getBoardColumns(
    getWorkspacePath: () => string | null,
    getBoardId: () => string | null,
) {
    /**
     * View state for a board, migrating a pre-split config on first sight.
     *
     * Only runs when this machine has no record for the board at all, so a user
     * who un-collapses everything after the split does not get the old values
     * resurrected on the next load.
     */
    function resolveViewState(boardId: string, rawStoredConfig: string) {
        if (hasColumnViewState(boardId)) {
            return loadColumnViewState(boardId);
        }

        const adopted = legacyViewStateFromStored(rawStoredConfig);
        // Record the decision even when there was nothing to adopt, so the
        // legacy values are never considered again.
        saveColumnViewState(boardId, adopted);
        return adopted;
    }

    // ── Load ────────────────────────────────────────────────────────────────
    async function load() {
        const workspacePath = getWorkspacePath();
        const boardId = getBoardId();

        if (!workspacePath || !boardId) {
            _columns = [];
            _lastLoadedBoardId = null;
            return;
        }

        // Skip if the same board is already loaded
        if (boardId === _lastLoadedBoardId) return;

        _loading = true;
        try {
            const db = await getDb(workspacePath);
            // Read the board row rather than just the parsed columns: the raw
            // string is what the one-time view-state migration needs.
            const board = await BoardRepo.getBoardById(db, boardId);
            const rawConfig = board?.columns_config ?? '';

            const domain = BoardRepo.parseColumns(rawConfig);
            _columns = applyViewState(
                domain,
                resolveViewState(boardId, rawConfig),
            );
            _lastLoadedBoardId = boardId;
        } catch (e) {
            console.error('[board-columns] Failed to load column config:', e);
            _columns = [];
        } finally {
            _loading = false;
        }
    }

    /** Reload even for the same board — useful after direct DB changes. */
    async function reload() {
        _lastLoadedBoardId = null;
        await load();
    }

    // ── Persist ─────────────────────────────────────────────────────────────
    /**
     * Push a new column list to both owners. Optimistically updates local state
     * first so edits feel instant, then reconciles with what was stored.
     *
     * The database only ever receives the domain half — `BoardRepo` serialises
     * with `serializeBoardColumns`, which strips view state.
     */
    async function persist(next: KanbanColumnConfig[]) {
        const workspacePath = getWorkspacePath();
        const boardId = getBoardId();
        if (!workspacePath || !boardId) {
            _saveError = 'No workspace or board selected';
            return;
        }

        const previous = _columns;
        _columns = next;

        try {
            const db = await getDb(workspacePath);
            const updated = await BoardRepo.updateBoardColumns(db, boardId, next);

            // The layout is local, so it is written here rather than in the DB
            // write above — and it must be recorded whatever the DB returned.
            const viewState = extractViewState(next);
            saveColumnViewState(boardId, viewState);

            if (updated) {
                _columns = applyViewState(
                    BoardRepo.parseColumns(updated.columns_config),
                    viewState,
                );
            }
            _saveError = null;
        } catch (e) {
            console.error('[board-columns] Failed to save column config:', e);
            _columns = previous;
            _saveError = e instanceof Error ? e.message : String(e);
        }
    }

    /**
     * Apply a view-state-only change: local state plus the local store, no
     * database write at all.
     *
     * Collapsing a column is not an edit to the board — it used to cost a write
     * into the synced `columns_config`, which is what made personal layout
     * changes show up as workspace changes.
     */
    async function persistViewState(next: KanbanColumnConfig[]) {
        const boardId = getBoardId();
        _columns = next;
        if (boardId) saveColumnViewState(boardId, extractViewState(next));
    }

    // ── Custom columns ──────────────────────────────────────────────────────
    /** Add a new custom stage. Returns its status, or null if it was rejected. */
    async function addCustomColumn(title: string): Promise<TicketStatus | null> {
        const next = addCustomColumnToList(_columns, title, CUSTOM_COLUMN_ACCENTS);
        if (next.length === _columns.length) return null;

        const created = next[next.length - 1];
        await persist(next);
        return _saveError ? null : created.status;
    }

    /**
     * Remove a custom column.
     *
     * Only custom columns can be removed, and only once empty — removing one
     * while it still holds tickets would strand them. The UI disables the
     * action in that case; this guard makes the invariant hold even if a
     * caller skips the check.
     */
    async function removeColumn(status: TicketStatus) {
        const column = findColumn(_columns, status);
        if (!column || column.kind !== 'custom') return;

        const workspacePath = getWorkspacePath();
        const boardId = getBoardId();
        if (!workspacePath || !boardId) return;

        try {
            const db = await getDb(workspacePath);
            const count = await TicketRepo.countTicketsByStatus(db, boardId, status);
            if (count > 0) {
                console.error(
                    `[board-columns] Refusing to remove "${status}": ${count} tickets still in it.`,
                );
                return;
            }
        } catch (e) {
            console.error('[board-columns] Failed to verify column is empty:', e);
            return;
        }

        await persist(removeColumnFromList(_columns, status));
    }

    // ── Name / remark / accent ──────────────────────────────────────────────
    /** Set a custom column name. Pass an empty string to fall back to built-in. */
    async function setTitle(status: TicketStatus, title: string) {
        const trimmed = title.trim();
        const column = findColumn(_columns, status);
        // A custom column has no built-in label to fall back to, so an empty
        // name would leave it unlabelled — keep the previous one instead.
        if (column?.kind === 'custom' && trimmed.length === 0) return;

        await persist(
            patchColumn(_columns, status, { title: trimmed.length > 0 ? trimmed : null }),
        );
    }

    /** Set a custom remark. Pass an empty string to fall back to built-in. */
    async function setNote(status: TicketStatus, note: string) {
        const trimmed = note.trim();
        await persist(
            patchColumn(_columns, status, { note: trimmed.length > 0 ? trimmed : null }),
        );
    }

    /** Drop the name/remark/accent overrides so the column follows its default. */
    async function resetColumn(status: TicketStatus) {
        await persist(resetColumnInList(_columns, status));
    }

    // ── View state ──────────────────────────────────────────────────────────
    // Local-only: these never reach the database (see `persistViewState`).
    /** Collapse to a narrow rail / expand back to a full column. */
    async function toggleCollapsed(status: TicketStatus) {
        const column = findColumn(_columns, status);
        if (!column) return;
        await persistViewState(
            patchColumn(_columns, status, { collapsed: !column.collapsed }),
        );
    }

    /** Hide from the board entirely / show again. */
    async function toggleHidden(status: TicketStatus) {
        const column = findColumn(_columns, status);
        if (!column) return;
        await persistViewState(
            patchColumn(_columns, status, { hidden: !column.hidden }),
        );
    }

    // ── Width planning ──────────────────────────────────────────────────────
    /** Set a column's planned share of the board width. Local-only. */
    async function setWidthShare(status: TicketStatus, weight: number) {
        await persistViewState(setWidthShareInList(_columns, status, weight));
    }

    /** Clear every planned width so the board divides its width evenly again. */
    async function resetWidthShares() {
        const next = resetWidthShares_(_columns);
        if (next === _columns) return;
        await persistViewState(next);
    }

    /** Move a column one slot left (-1) or right (+1). */
    async function moveColumn(status: TicketStatus, delta: number) {
        const next = moveColumnInList(_columns, status, delta);
        if (next === _columns) return;
        await persist(next);
    }

    function columnFor(status: TicketStatus): KanbanColumnConfig | undefined {
        return findColumn(_columns, status);
    }

    function clearSaveError() {
        _saveError = null;
    }

    return {
        get columns() { return _columns; },
        get loading() { return _loading; },
        get saveError() { return _saveError; },
        load,
        reload,
        addCustomColumn,
        removeColumn,
        setTitle,
        setNote,
        resetColumn,
        toggleCollapsed,
        toggleHidden,
        moveColumn,
        setWidthShare,
        resetWidthShares,
        columnFor,
        clearSaveError,
    };
}
