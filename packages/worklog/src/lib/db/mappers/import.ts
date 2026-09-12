import type Database from '@tauri-apps/plugin-sql';
import type { WorklogSnapshot, ImportResult, ImportStrategy } from './types';

/**
 * Imports a WorklogSnapshot into the database.
 *
 * @param db       Active database connection
 * @param snapshot The snapshot to import
 * @param strategy 'merge' = upsert by ID, 'replace' = wipe and insert
 */
export async function importSnapshot(
    db: Database,
    snapshot: WorklogSnapshot,
    strategy: ImportStrategy = 'merge',
): Promise<ImportResult> {
    const result: ImportResult = {
        boardsCreated: 0,
        boardsUpdated: 0,
        ticketsCreated: 0,
        ticketsUpdated: 0,
        ticketsSkipped: 0,
    };

    if (strategy === 'replace') {
        // Wipe all existing data (order matters for FK constraints)
        await db.execute(`DELETE FROM tickets`);
        await db.execute(`DELETE FROM boards`);
    }

    const now = new Date().toISOString();

    // ── Import Boards ──────────────────────────────────────────────────────
    for (const boardSnap of snapshot.boards) {
        const board = boardSnap.board;

        // A missing/empty config means "built-in defaults" — for an older
        // export we must not clobber a local customisation with it.
        const incomingColumns =
            typeof board.columns_config === 'string' ? board.columns_config : '';

        // Check if board already exists
        const existing = await db.select<any[]>(
            `SELECT id FROM boards WHERE id = ?`, [board.id]
        );

        if (existing.length > 0) {
            if (strategy === 'merge') {
                if (incomingColumns) {
                    await db.execute(
                        `UPDATE boards SET name = ?, description = ?, columns_config = ?, updated_at = ? WHERE id = ?`,
                        [board.name, board.description, incomingColumns, board.updated_at || now, board.id]
                    );
                } else {
                    await db.execute(
                        `UPDATE boards SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
                        [board.name, board.description, board.updated_at || now, board.id]
                    );
                }
                result.boardsUpdated++;
            }
        } else {
            await db.execute(
                `INSERT INTO boards (id, name, description, columns_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
                [board.id, board.name, board.description, incomingColumns, board.created_at || now, board.updated_at || now]
            );
            result.boardsCreated++;
        }

        // ── Import Tickets for this Board ──────────────────────────────────
        for (const ticket of boardSnap.tickets) {
            const existingTicket = await db.select<any[]>(
                `SELECT id FROM tickets WHERE id = ?`, [ticket.id]
            );

            const labelsJson = JSON.stringify(ticket.labels ?? []);
            const commentsJson = JSON.stringify(ticket.comments ?? []);

            if (existingTicket.length > 0) {
                if (strategy === 'merge') {
                    await db.execute(
                        `UPDATE tickets SET
                            board_id = ?, title = ?, description = ?, status = ?,
                            priority = ?, ticket_type = ?, position = ?,
                            due_date = ?, start_date = ?, labels = ?, comments = ?,
                            updated_at = ?
                        WHERE id = ?`,
                        [
                            ticket.board_id, ticket.title, ticket.description, ticket.status,
                            ticket.priority, ticket.ticket_type, ticket.position,
                            ticket.due_date, ticket.start_date, labelsJson, commentsJson,
                            ticket.updated_at || now, ticket.id
                        ]
                    );
                    result.ticketsUpdated++;
                } else {
                    result.ticketsSkipped++;
                }
            } else {
                await db.execute(
                    `INSERT INTO tickets (
                        id, board_id, title, description, status, priority,
                        ticket_type, position, due_date, start_date,
                        labels, comments, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        ticket.id, ticket.board_id, ticket.title, ticket.description,
                        ticket.status, ticket.priority, ticket.ticket_type, ticket.position,
                        ticket.due_date, ticket.start_date, labelsJson, commentsJson,
                        ticket.created_at || now, ticket.updated_at || now
                    ]
                );
                result.ticketsCreated++;
            }
        }
    }

    return result;
}
