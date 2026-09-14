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
        catalogRowsCreated: 0,
        catalogRowsUpdated: 0,
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

    // ── Catalogs ───────────────────────────────────────────────────────────
    // After the boards exist, and upsert-only: an imported file must never delete
    // a row this workspace's tickets point at, whatever the file contains.
    const catalogs = await importCatalogs(db, snapshot);
    result.catalogRowsCreated = catalogs.created;
    result.catalogRowsUpdated = catalogs.updated;

    return result;
}

async function importCatalogs(
    db: Database,
    snapshot: WorklogSnapshot,
): Promise<{ created: number; updated: number }> {
    const catalogs = snapshot.catalogs;
    if (!catalogs) return { created: 0, updated: 0 };

    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;

    // An incoming default has to win, or a merge would leave two rows flagged as
    // the default and "which type a new ticket starts at" would depend on order.
    const clearDefaults = async (table: string) => {
        try {
            await db.execute(
                `UPDATE ${table} SET is_default = 0 WHERE is_default = 1`,
            );
        } catch {
            // Table shape from before this column existed; nothing to demote.
        }
    };

    try {
        if (catalogs.types.some((row) => row.is_default)) {
            await clearDefaults('ticket_types');
        }
        const knownTypes = await knownIds(db, 'ticket_types');
        for (const row of catalogs.types) {
            const values = [
                row.name,
                row.color,
                row.icon,
                row.is_default ? 1 : 0,
            ];
            if (knownTypes.has(row.id)) {
                await db.execute(
                    `UPDATE ticket_types SET name = ?, color = ?, icon = ?, is_default = ?, updated_at = ? WHERE id = ?`,
                    [...values, now, row.id],
                );
                updated += 1;
            } else {
                await db.execute(
                    `INSERT INTO ticket_types (id, name, color, icon, is_default, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [row.id, ...values, now, now],
                );
                created += 1;
            }
        }
    } catch (error) {
        console.error('[import] catalogs (types) failed:', error);
    }

    try {
        if (catalogs.priorities.some((row) => row.is_default)) {
            await clearDefaults('ticket_priorities');
        }
        const knownPriorities = await knownIds(db, 'ticket_priorities');
        for (const row of catalogs.priorities) {
            const values = [row.name, row.color, row.rank, row.is_default ? 1 : 0];
            if (knownPriorities.has(row.id)) {
                await db.execute(
                    `UPDATE ticket_priorities SET name = ?, color = ?, rank = ?, is_default = ?, updated_at = ? WHERE id = ?`,
                    [...values, now, row.id],
                );
                updated += 1;
            } else {
                await db.execute(
                    `INSERT INTO ticket_priorities (id, name, color, rank, is_default, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [row.id, ...values, now, now],
                );
                created += 1;
            }
        }
    } catch (error) {
        console.error('[import] catalogs (priorities) failed:', error);
    }

    try {
        // Tags are matched by *name*, like everywhere else in the app: a
        // workspace seeds them with random ids, so the same tag would otherwise
        // be added a second time under the imported id.
        const knownTags = await db.select<{ id: string; name: string }[]>(
            `SELECT id, name FROM tags`,
        );
        const byName = new Map(knownTags.map((row) => [row.name, row.id]));
        const usedIds = new Set(knownTags.map((row) => row.id));

        for (const row of catalogs.tags) {
            const existingId = byName.get(row.name);
            if (existingId) {
                await db.execute(
                    `UPDATE tags SET color = ?, updated_at = ? WHERE id = ?`,
                    [row.color, now, existingId],
                );
                updated += 1;
                continue;
            }

            const id = usedIds.has(row.id) ? crypto.randomUUID() : row.id;
            await db.execute(
                `INSERT INTO tags (id, name, color, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [id, row.name, row.color, now, now],
            );
            usedIds.add(id);
            created += 1;
        }
    } catch (error) {
        console.error('[import] catalogs (tags) failed:', error);
    }

    return { created, updated };
}

/** Ids already present in a catalog table (empty when the table is missing). */
async function knownIds(db: Database, table: string): Promise<Set<string>> {
    try {
        const rows = await db.select<{ id: string }[]>(`SELECT id FROM ${table}`);
        return new Set(rows.map((row) => row.id));
    } catch {
        return new Set();
    }
}
