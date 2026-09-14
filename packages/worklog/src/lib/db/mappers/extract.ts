import type Database from '@tauri-apps/plugin-sql';
import {
    WorkspaceRepo,
    BoardRepo,
    TicketRepo,
    TicketTypeRepo,
    TicketPriorityRepo,
    TagRepo,
} from '../index';
import type {
    WorklogSnapshot,
    BoardSnapshot,
    CatalogSnapshot,
} from './types';
import { EXPORT_VERSION } from './types';

/**
 * Reads the entire database state into an in-memory WorklogSnapshot.
 * This is the single source of truth for all export and sync operations.
 *
 * Identity/credentials are intentionally absent: they are app-level values, and
 * this snapshot is written into a git-synced folder.
 *
 * The attribute catalogs are present for the opposite reason: a ticket refers to
 * its type, priority and tags by id, so without the definitions a synced or
 * exported workspace would carry ids nothing can resolve.
 */
export async function extractSnapshot(db: Database): Promise<WorklogSnapshot> {
    const workspaceMeta = await WorkspaceRepo.getWorkspaceMeta(db);
    const boards = await BoardRepo.listBoards(db);

    // Build per-board snapshots with their tickets
    const boardSnapshots: BoardSnapshot[] = [];

    for (const board of boards) {
        const tickets = await TicketRepo.listTickets(db, board.id);
        boardSnapshots.push({ board, tickets });
    }

    return {
        export_version: EXPORT_VERSION,
        exported_at: new Date().toISOString(),
        workspace_meta: workspaceMeta,
        boards: boardSnapshots,
        catalogs: await extractCatalogs(db),
    };
}

/** The workspace's attribute catalogs, in portable form. */
async function extractCatalogs(db: Database): Promise<CatalogSnapshot> {
    const read = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => {
        try {
            return await fn();
        } catch {
            // A workspace from before these tables existed has nothing to carry.
            return [];
        }
    };

    const types = await read(() => TicketTypeRepo.getAll(db));
    const priorities = await read(() => TicketPriorityRepo.getAll(db));
    const tags = await read(() => TagRepo.getAll(db));

    return {
        types: types.map((row) => ({
            id: row.id,
            name: row.name,
            color: row.color,
            icon: row.icon,
            is_default: Boolean(row.is_default),
        })),
        priorities: priorities.map((row) => ({
            id: row.id,
            name: row.name,
            color: row.color,
            rank: row.rank,
            is_default: Boolean(row.is_default),
        })),
        tags: tags.map((row) => ({
            id: row.id,
            name: row.name,
            color: row.color,
        })),
    };
}
