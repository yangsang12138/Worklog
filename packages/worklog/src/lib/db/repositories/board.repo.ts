import type Database from '@tauri-apps/plugin-sql';
import type {
    Board,
    CreateBoardInput,
    KanbanColumnConfig,
    TabType,
    TicketStatus,
} from '$lib/components/app/types';
import { TICKET_STATUS_ORDER, ALL_BOARD_TABS } from '$lib/components/app/types';
import {
    parseBoardColumns,
    serializeBoardColumns,
} from '$lib/db/columns-config';
import { generateId } from '$lib/utils';

export async function listBoards(
    db: Database,
    options: { limit?: number; offset?: number; archived?: boolean } = {}
): Promise<Board[]> {
    const archived = options.archived ?? false;
    const whereClause = archived
        ? `archived_at IS NOT NULL`
        : `archived_at IS NULL`;

    let query = `SELECT * FROM boards WHERE ${whereClause} ORDER BY created_at ASC`;
    const params: any[] = [];

    if (options.limit !== undefined) {
        query += ` LIMIT ?`;
        params.push(options.limit);
    }
    if (options.offset !== undefined) {
        query += ` OFFSET ?`;
        params.push(options.offset);
    }

    return db.select<Board[]>(query, params);
}

export async function getBoardById(db: Database, id: string): Promise<Board | null> {
    const rows = await db.select<Board[]>(
        `SELECT * FROM boards WHERE id = ?`, [id]
    );
    return rows[0] ?? null;
}

export async function createBoard(db: Database, input: CreateBoardInput): Promise<Board> {
    const board: Board = {
        id: generateId('BRD'),
        name: input.name,
        description: input.description ?? '',
        tabs_config: JSON.stringify(['kanban']),
        columns_config: '',
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    await db.execute(
        `INSERT INTO boards (id, name, description, tabs_config, columns_config, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [board.id, board.name, board.description, board.tabs_config, board.columns_config, board.archived_at, board.created_at, board.updated_at]
    );

    return board;
}

export async function deleteBoard(db: Database, id: string): Promise<void> {
    // Tickets cascade-deleted automatically via FK
    await db.execute(`DELETE FROM boards WHERE id = ?`, [id]);
}

export async function archiveBoard(db: Database, id: string): Promise<Board | null> {
    const archivedAt = new Date().toISOString();
    await db.execute(
        `UPDATE boards SET archived_at = ?, updated_at = ? WHERE id = ?`,
        [archivedAt, archivedAt, id]
    );
    return getBoardById(db, id);
}

export async function unarchiveBoard(db: Database, id: string): Promise<Board | null> {
    const updatedAt = new Date().toISOString();
    await db.execute(
        `UPDATE boards SET archived_at = NULL, updated_at = ? WHERE id = ?`,
        [updatedAt, id]
    );
    return getBoardById(db, id);
}

export async function renameBoard(
    db: Database,
    id: string,
    name: string,
    description: string,
): Promise<Board | null> {
    const updatedAt = new Date().toISOString();

    await db.execute(
        `UPDATE boards
         SET name = ?, description = ?, updated_at = ?
         WHERE id = ?`,
        [name, description, updatedAt, id],
    );

    return getBoardById(db, id);
}

/**
 * Parse the tabs_config JSON column safely.
 * Returns the default tabs if the value is empty, null, or malformed.
 */
export function parseBoardTabs(raw: string | null | undefined): TabType[] {
    if (!raw) return ['kanban'];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
            // Filter to only valid TabType values
            return parsed.filter((t: string) => ALL_BOARD_TABS.includes(t as TabType));
        }
    } catch {
        // Malformed JSON — fall back to default
    }
    return ['kanban'];
}

/**
 * Get the enabled tabs for a board.
 * Returns the parsed tabs_config, falling back to default if missing/broken.
 */
export async function getBoardTabs(db: Database, id: string): Promise<TabType[]> {
    const board = await getBoardById(db, id);
    return parseBoardTabs(board?.tabs_config);
}

/**
 * Update the enabled tabs for a board.
 * Ensures 'kanban' is always present in the list.
 */
export async function updateBoardTabs(
    db: Database,
    id: string,
    tabs: TabType[],
): Promise<Board | null> {
    // Ensure kanban is always present
    const safeTabs = tabs.includes('kanban') ? tabs : ['kanban', ...tabs];
    const tabsConfig = JSON.stringify(safeTabs);
    const updatedAt = new Date().toISOString();

    await db.execute(
        `UPDATE boards SET tabs_config = ?, updated_at = ? WHERE id = ?`,
        [tabsConfig, updatedAt, id],
    );

    return getBoardById(db, id);
}

// ── Kanban column configuration ───────────────────────────────────────────
// Column membership, names, remarks and view state are stored per board as a
// JSON array. `columns_config === ''` means "never customised" and resolves to
// the four built-in columns.

/**
 * Parse the `columns_config` JSON column safely.
 * Falls back to the built-in default columns when empty or malformed.
 */
export function parseColumns(raw: string | null | undefined): KanbanColumnConfig[] {
    return parseBoardColumns(raw, TICKET_STATUS_ORDER);
}

/** Get the resolved column configuration for a board. */
export async function getBoardColumns(
    db: Database,
    id: string,
): Promise<KanbanColumnConfig[]> {
    const board = await getBoardById(db, id);
    return parseColumns(board?.columns_config);
}

/** Persist a board's column configuration. */
export async function updateBoardColumns(
    db: Database,
    id: string,
    columns: KanbanColumnConfig[],
): Promise<Board | null> {
    const updatedAt = new Date().toISOString();

    await db.execute(
        `UPDATE boards SET columns_config = ?, updated_at = ? WHERE id = ?`,
        [serializeBoardColumns(columns), updatedAt, id],
    );

    return getBoardById(db, id);
}
