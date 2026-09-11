import type { Board, Ticket } from '$lib/components/app/types';
import type { WorklogSnapshot, BoardSnapshot } from './types';
import { validateSnapshot } from './validate-snapshot';

/**
 * Parses a single combined JSON string back into a WorklogSnapshot.
 */
export function parseSnapshotFromSingleJson(content: string): WorklogSnapshot {
    const data = JSON.parse(content);

    // Handle both old export format (flat tickets array) and new format (board snapshots)
    if (data.boards && data.boards.length > 0 && 'board' in data.boards[0]) {
        // New format: boards are already BoardSnapshot[]
        return {
            export_version: data.export_version ?? data.version ?? 1,
            exported_at: data.exported_at ?? new Date().toISOString(),
            workspace_meta: data.workspace_meta ?? null,
            app_settings: data.app_settings ?? null,
            boards: data.boards as BoardSnapshot[],
        };
    }

    // Old format: boards is Board[] and tickets is a separate flat array
    if (data.tickets && Array.isArray(data.tickets)) {
        const boardsRaw: Board[] = data.boards ?? [];
        const ticketsRaw: Ticket[] = data.tickets;

        const boardSnapshots: BoardSnapshot[] = boardsRaw.map((board: Board) => ({
            board,
            tickets: ticketsRaw.filter((t: Ticket) => t.board_id === board.id),
        }));

        return {
            export_version: data.export_version ?? data.version ?? 1,
            exported_at: data.exported_at ?? new Date().toISOString(),
            workspace_meta: data.workspace_meta ?? null,
            app_settings: data.app_settings ?? null,
            boards: boardSnapshots,
        };
    }

    // Fallback
    return {
        export_version: data.export_version ?? 1,
        exported_at: data.exported_at ?? new Date().toISOString(),
        workspace_meta: data.workspace_meta ?? null,
        app_settings: data.app_settings ?? null,
        boards: [],
    };
}

/**
 * Parses a folder of JSON files into a WorklogSnapshot.
 * @param files Map of relative filename → file content string
 */
export function parseSnapshotFromFolder(files: Map<string, string>): WorklogSnapshot {
    const metadataRaw = files.get('metadata.json');
    const workspaceRaw = files.get('workspace.json');
    const settingsRaw = files.get('settings.json');
    if (!metadataRaw) throw new Error('Missing metadata.json: remote is not a Worklog snapshot');

    const metadata = metadataRaw ? JSON.parse(metadataRaw) : {};
    const workspaceMeta = workspaceRaw ? JSON.parse(workspaceRaw) : null;
    const appSettings = settingsRaw ? JSON.parse(settingsRaw) : null;

    const boardSnapshots: BoardSnapshot[] = [];

    // Find all board JSON files in boards/ directory
    for (const [filename, content] of files.entries()) {
        if (filename.startsWith('boards/') && filename.endsWith('.json')) {
            const parsed = JSON.parse(content);

            if (parsed.board) {
                boardSnapshots.push({
                    board: parsed.board,
                    tickets: parsed.tickets ?? [],
                });
            } else {
                throw new Error(`Invalid board snapshot: ${filename}`);
            }
        }
    }

    return validateSnapshot({
        export_version: metadata.export_version ?? 1,
        exported_at: metadata.exported_at ?? new Date().toISOString(),
        workspace_meta: workspaceMeta,
        app_settings: appSettings,
        boards: boardSnapshots,
    });
}
