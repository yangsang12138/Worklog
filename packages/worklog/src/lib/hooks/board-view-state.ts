import type { ColumnViewStateMap } from '$lib/db/columns-config';

/**
 * Per-board **view** state — how a board looks on this machine only.
 *
 * Collapsed columns, hidden columns and planned column widths are not team
 * agreements: they say "I put this column away on my screen". They used to be
 * stored inside `boards.columns_config`, which is a *synced* field — the
 * workspace snapshot writes boards into `.worklog/sync/` and that folder is
 * pushed to teammates — so every personal layout tweak became a shared edit and
 * a merge conflict nobody could resolve meaningfully.
 *
 * So they live here instead: per board, per machine, never exported.
 *
 * Losing this store costs a layout preference and no information, which is why
 * localStorage is an acceptable home (unlike, say, the catalogs, which tickets
 * refer to by id and which must therefore be materialised into the workspace).
 * The same reasoning applies to the sibling per-board view preferences that
 * already live here — ticket sort order and the last visited tab.
 */

const KEY_PREFIX = 'worklog:board-view:columns:';

interface StoredBoardViewState {
    /** Bumped if the shape ever changes; absent means the first shape. */
    version?: number;
    columns: ColumnViewStateMap;
}

function storage(): Storage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        // Storage can be unavailable (private mode, disabled); a board still
        // renders with its default layout.
        return null;
    }
}

function keyFor(boardId: string): string {
    return `${KEY_PREFIX}${boardId}`;
}

/**
 * Whether this machine has already decided this board's layout.
 *
 * The difference between "no record" and "a record with nothing in it" is what
 * makes the one-time migration safe: an empty record means the user expanded
 * and unhid everything *after* the split, and must not be re-seeded from the
 * legacy values still sitting in the database.
 */
export function hasColumnViewState(boardId: string): boolean {
    const store = storage();
    if (!store) return false;
    try {
        return store.getItem(keyFor(boardId)) !== null;
    } catch {
        return false;
    }
}

export function loadColumnViewState(boardId: string): ColumnViewStateMap {
    const store = storage();
    if (!store) return {};

    try {
        const raw = store.getItem(keyFor(boardId));
        if (!raw) return {};
        const parsed = JSON.parse(raw) as StoredBoardViewState;
        const columns = parsed?.columns;
        if (!columns || typeof columns !== 'object') return {};
        return columns;
    } catch {
        return {};
    }
}

export function saveColumnViewState(
    boardId: string,
    columns: ColumnViewStateMap,
): void {
    const store = storage();
    if (!store) return;

    try {
        const payload: StoredBoardViewState = { version: 1, columns };
        store.setItem(keyFor(boardId), JSON.stringify(payload));
    } catch {
        // A failed write only costs the preference; never break the board.
    }
}

/** Forget a board's layout — used when the board itself is deleted. */
export function clearColumnViewState(boardId: string): void {
    const store = storage();
    if (!store) return;
    try {
        store.removeItem(keyFor(boardId));
    } catch {
        // Nothing to do.
    }
}
