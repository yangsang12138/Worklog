import type { Ticket } from '$lib/components/app/types';
import type { WorklogSnapshot } from './types';

const CSV_HEADERS = [
    'id', 'board_id', 'title', 'description', 'status', 'priority',
    'ticket_type', 'position', 'due_date', 'start_date', 'labels',
    'comments', 'created_at', 'updated_at',
] as const;

/**
 * Escapes a value for safe inclusion in a CSV cell.
 * Wraps in double quotes if the value contains commas, quotes, or newlines.
 */
function escapeCsvValue(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/**
 * Converts a single ticket into a CSV row string.
 */
function ticketToCsvRow(ticket: Ticket): string {
    const values: string[] = [
        ticket.id,
        ticket.board_id,
        ticket.title,
        ticket.description ?? '',
        ticket.status,
        ticket.priority,
        ticket.ticket_type,
        String(ticket.position),
        ticket.due_date ?? '',
        ticket.start_date ?? '',
        // Labels as semicolon-separated
        (ticket.labels ?? []).join(';'),
        // Comments as JSON string (preserves structure for round-trip)
        JSON.stringify(ticket.comments ?? []),
        ticket.created_at,
        ticket.updated_at,
    ];

    return values.map(escapeCsvValue).join(',');
}

/**
 * Converts an array of tickets into a complete CSV string (with header row).
 */
export function ticketsToCsv(tickets: Ticket[]): string {
    const header = CSV_HEADERS.join(',');
    const rows = tickets.map(ticketToCsvRow);
    return [header, ...rows].join('\n');
}

/**
 * Converts the entire snapshot into a single CSV string.
 * All tickets across all boards are flattened into one table.
 */
export function snapshotToSingleCsv(snapshot: WorklogSnapshot): string {
    const allTickets: Ticket[] = [];
    for (const boardSnap of snapshot.boards) {
        allTickets.push(...boardSnap.tickets);
    }
    return ticketsToCsv(allTickets);
}

/**
 * Converts the snapshot into per-board CSV files for folder-mode export.
 * Returns a Map of relative filename → file content string.
 * Board metadata is still stored as JSON; only tickets become CSV.
 */
export function snapshotToFolderCsvFiles(snapshot: WorklogSnapshot): Map<string, string> {
    const files = new Map<string, string>();

    // metadata.json — always JSON
    files.set('metadata.json', JSON.stringify({
        export_version: snapshot.export_version,
        exported_at: snapshot.exported_at,
    }, null, 2));

    // workspace.json
    if (snapshot.workspace_meta) {
        files.set('workspace.json', JSON.stringify(snapshot.workspace_meta, null, 2));
    }

    // catalogs.json — always JSON, even in CSV mode: catalog rows are not
    // ticket-shaped, and tickets are the only thing CSV can express.
    files.set('catalogs.json', JSON.stringify(snapshot.catalogs, null, 2));

    // NOTE: no settings.json — identity is app-level, not workspace data.

    // boards/<id>.json (metadata) + boards/<id>.csv (tickets)
    for (const boardSnap of snapshot.boards) {
        // Board metadata as JSON
        files.set(`boards/${boardSnap.board.id}.json`, JSON.stringify({
            board: boardSnap.board,
        }, null, 2));

        // Tickets as CSV
        if (boardSnap.tickets.length > 0) {
            files.set(`boards/${boardSnap.board.id}.csv`, ticketsToCsv(boardSnap.tickets));
        }
    }

    return files;
}
