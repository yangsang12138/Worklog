import type { Board, CreateBoardInput } from '$lib/components/app/types';
import { getDb, BoardRepo } from '$lib/db';

let _boards = $state<Board[]>([]);
let _archivedBoards = $state<Board[]>([]);
let _active = $state<Board | null>(null);
let _loading = $state(false);

// Workspace the state above belongs to. Switching workspaces must not leak
// boards (or the active board) from the previous workspace into any view.
let _loadedPath: string | null = null;

export function getBoards(getWorkspacePath: () => string | null) {
    function requireWorkspacePath(): string {
        const path = getWorkspacePath();
        if (!path) throw new Error('No workspace selected');
        return path;
    }

    async function load() {
        const workspacePath = getWorkspacePath();
        if (!workspacePath) {
            _boards = [];
            _archivedBoards = [];
            _active = null;
            _loadedPath = null;
            return;
        }

        // Drop state from the previous workspace before loading the new one so
        // views keyed off `active` never query tickets in the wrong database.
        if (_loadedPath !== workspacePath) {
            _loadedPath = workspacePath;
            _boards = [];
            _archivedBoards = [];
            _active = null;
        }

        _loading = true;
        try {
            const db = await getDb(workspacePath);
            // Load active boards only
            _boards = await BoardRepo.listBoards(db, { limit: 50, archived: false });
            // Auto-select first board if none active
            if (!_active && _boards.length > 0) {
                _active = _boards[0];
            }
        } finally {
            _loading = false;
        }
    }

    async function loadMore() {
        const workspacePath = getWorkspacePath();
        if (!workspacePath) return;

        const db = await getDb(workspacePath);
        const batch = await BoardRepo.listBoards(db, {
            limit: 50,
            offset: _boards.length,
            archived: false,
        });

        _boards = [..._boards, ...batch];
    }

    async function loadArchived() {
        const workspacePath = getWorkspacePath();
        if (!workspacePath) return;

        const db = await getDb(workspacePath);
        _archivedBoards = await BoardRepo.listBoards(db, { archived: true });
    }

    async function create(input: CreateBoardInput) {
        const workspacePath = requireWorkspacePath();
        const db = await getDb(workspacePath);
        const board = await BoardRepo.createBoard(db, input);
        _boards = [..._boards, board];
        _active = board; // auto-activate newly created board
        return board;
    }

    async function remove(id: string) {
        const workspacePath = requireWorkspacePath();
        const db = await getDb(workspacePath);
        await BoardRepo.deleteBoard(db, id);
        _boards = _boards.filter(b => b.id !== id);
        _archivedBoards = _archivedBoards.filter(b => b.id !== id);
        // If deleted board was active, fall back to first remaining
        if (_active?.id === id) {
            _active = _boards[0] ?? null;
        }
    }

    async function archive(id: string) {
        const workspacePath = requireWorkspacePath();
        const db = await getDb(workspacePath);
        const updated = await BoardRepo.archiveBoard(db, id);
        if (!updated) throw new Error('Board not found');

        // Move from active list to archived list
        _boards = _boards.filter(b => b.id !== id);
        _archivedBoards = [..._archivedBoards, updated];

        // If archived board was active, fall back to first remaining
        if (_active?.id === id) {
            _active = _boards[0] ?? null;
        }

        return updated;
    }

    async function unarchive(id: string) {
        const workspacePath = requireWorkspacePath();
        const db = await getDb(workspacePath);
        const updated = await BoardRepo.unarchiveBoard(db, id);
        if (!updated) throw new Error('Board not found');

        // Move from archived list back to active list
        _archivedBoards = _archivedBoards.filter(b => b.id !== id);
        _boards = [..._boards, updated];

        return updated;
    }

    async function rename(id: string, name: string, description: string) {
        const workspacePath = requireWorkspacePath();
        const db = await getDb(workspacePath);
        const updated = await BoardRepo.renameBoard(db, id, name, description);
        if (!updated) throw new Error('Board not found');

        _boards = _boards.map((board) =>
            board.id === id ? updated : board,
        );

        if (_active?.id === id) {
            _active = updated;
        }

        return updated;
    }

    function setActive(board: Board) {
        _active = board;
    }

    return {
        get boards() { return _boards },
        get archivedBoards() { return _archivedBoards },
        get active() { return _active },
        get loading() { return _loading },
        load, loadMore, loadArchived, create, remove, archive, unarchive, rename, setActive
    };
}
