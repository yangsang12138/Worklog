import type { Board, Ticket } from '$lib/components/app/types';
import type {
    WorklogSnapshot,
    BoardSnapshot,
    CatalogSnapshot,
} from './types';
// Explicit extension: this module is imported directly by plain-Node tests, and
// Node's ESM resolver does not guess extensions.
import { emptyCatalogSnapshot } from './types.ts';

/**
 * Read the catalogs out of a file, tolerating the two shapes an export can have
 * (a nested object, or the pre-v2 absence) and never trusting what is in it.
 */
function parseCatalogs(raw: unknown): CatalogSnapshot {
    if (!raw || typeof raw !== 'object') return emptyCatalogSnapshot();
    const source = raw as Partial<CatalogSnapshot>;

    const list = <T,>(value: unknown, map: (row: Record<string, unknown>) => T | null) =>
        (Array.isArray(value) ? value : [])
            .map((row) => (row && typeof row === 'object' ? map(row as Record<string, unknown>) : null))
            .filter((row): row is T => row !== null);

    const str = (value: unknown) => (typeof value === 'string' ? value : '');

    return {
        types: list(source.types, (row) => {
            const id = str(row.id);
            const name = str(row.name);
            if (!id || !name) return null;
            return {
                id,
                name,
                color: str(row.color),
                icon: str(row.icon) || null,
                is_default: row.is_default === true,
            };
        }),
        priorities: list(source.priorities, (row) => {
            const id = str(row.id);
            const name = str(row.name);
            if (!id || !name) return null;
            const rank = Number(row.rank);
            return {
                id,
                name,
                color: str(row.color),
                rank: Number.isFinite(rank) ? rank : 0,
                is_default: row.is_default === true,
            };
        }),
        tags: list(source.tags, (row) => {
            const id = str(row.id);
            const name = str(row.name);
            if (!id || !name) return null;
            return { id, name, color: str(row.color) };
        }),
    };
}

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
            boards: data.boards as BoardSnapshot[],
            catalogs: parseCatalogs(data.catalogs),
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
            boards: boardSnapshots,
            catalogs: parseCatalogs(data.catalogs),
        };
    }

    // Fallback
    return {
        export_version: data.export_version ?? 1,
        exported_at: data.exported_at ?? new Date().toISOString(),
        workspace_meta: data.workspace_meta ?? null,
        boards: [],
        catalogs: parseCatalogs(data.catalogs),
    };
}

/**
 * Parses a folder of JSON files into a WorklogSnapshot.
 * @param files Map of relative filename → file content string
 */
export function parseSnapshotFromFolder(files: Map<string, string>): WorklogSnapshot {
    const metadataRaw = files.get('metadata.json');
    const workspaceRaw = files.get('workspace.json');
    const catalogsRaw = files.get('catalogs.json');

    const metadata = metadataRaw ? JSON.parse(metadataRaw) : {};
    const workspaceMeta = workspaceRaw ? JSON.parse(workspaceRaw) : null;

    // `settings.json` from an older export is ignored on purpose: it held
    // identity, which is app-level now and must not be restored from a file.

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
            }
        }
    }

    return {
        export_version: metadata.export_version ?? 1,
        exported_at: metadata.exported_at ?? new Date().toISOString(),
        workspace_meta: workspaceMeta,
        boards: boardSnapshots,
        catalogs: parseCatalogs(catalogsRaw ? JSON.parse(catalogsRaw) : null),
    };
}
