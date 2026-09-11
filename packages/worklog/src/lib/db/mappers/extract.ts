import type Database from '@tauri-apps/plugin-sql';
import { WorkspaceRepo, BoardRepo, SettingsRepo, TicketRepo } from '../index';
import type { WorklogSnapshot, BoardSnapshot } from './types';
import { EXPORT_VERSION } from './types';

/**
 * Reads the entire database state into an in-memory WorklogSnapshot.
 * This is the single source of truth for all export and sync operations.
 */
export async function extractSnapshot(db: Database): Promise<WorklogSnapshot> {
    const workspaceMeta = await WorkspaceRepo.getWorkspaceMeta(db);
    const appSettings = await SettingsRepo.getSettings(db);
    const boards = [
        ...await BoardRepo.listBoards(db),
        ...await BoardRepo.listBoards(db, { archived: true }),
    ];

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
        app_settings: appSettings,
        boards: boardSnapshots,
    };
}
