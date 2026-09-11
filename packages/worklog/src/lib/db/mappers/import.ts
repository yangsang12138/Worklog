import type Database from '@tauri-apps/plugin-sql';
import type { WorklogSnapshot, ImportResult, ImportStrategy } from './types';
import { validateSnapshot } from './validate-snapshot';
import { executeTransaction } from '../transaction';

// Quote values in the SQL batch submitted to the pinned transaction command.
function literal(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid SQL value');
    return `'${value.replaceAll("'", "''")}'`;
}

export async function importSnapshot(
    db: Database,
    input: WorklogSnapshot,
    strategy: ImportStrategy = 'merge',
): Promise<ImportResult> {
    const snapshot = validateSnapshot(input);
    const existingBoards = new Set((await db.select<Array<{ id: string }>>('SELECT id FROM boards')).map(b => b.id));
    const existingTickets = new Set((await db.select<Array<{ id: string }>>('SELECT id FROM tickets')).map(t => t.id));
    const result: ImportResult = { boardsCreated: 0, boardsUpdated: 0, ticketsCreated: 0, ticketsUpdated: 0, ticketsSkipped: 0 };
    const statements: string[] = [];
    const upsert = (table: string, record: Record<string, unknown>) => {
        const keys = Object.keys(record);
        statements.push(`INSERT INTO ${table} (${keys.join(', ')})
            VALUES (${keys.map(key => literal(record[key])).join(', ')})
            ON CONFLICT(id) DO UPDATE SET ${keys.filter(key => key !== 'id').map(key => `${key} = excluded.${key}`).join(', ')};`);
    };
    if (snapshot.app_settings) {
        const s = snapshot.app_settings;
        if (!Number.isFinite(s.autosave_seconds) || s.autosave_seconds < 0) throw new Error('Invalid snapshot settings');
        upsert('app_settings', {
            id: 1, author_name: s.author_name, default_branch: s.default_branch,
            autosave_seconds: s.autosave_seconds, created_at: s.created_at, updated_at: s.updated_at,
        });
    }
    if (snapshot.workspace_meta) {
        const meta = snapshot.workspace_meta;
        // Schema version and sync credentials belong to the local installation.
        statements.push(`UPDATE workspace_meta SET name = ${literal(meta.name)}, created_at = ${literal(meta.created_at)} WHERE id = 1;`);
    }
    for (const { board, tickets } of snapshot.boards) {
        existingBoards.has(board.id) ? result.boardsUpdated++ : result.boardsCreated++;
        upsert('boards', { ...board });
        for (const ticket of tickets) {
            existingTickets.has(ticket.id) ? result.ticketsUpdated++ : result.ticketsCreated++;
            upsert('tickets', { ...ticket, labels: JSON.stringify(ticket.labels), comments: JSON.stringify(ticket.comments) });
        }
    }
    if (strategy === 'replace') {
        // Delete only missing entities; updating an unchanged ticket must not
        // cascade-delete its local push history.
        const boardIds = snapshot.boards.map(({ board }) => literal(board.id));
        const ticketIds = snapshot.boards.flatMap(({ tickets }) => tickets.map(t => literal(t.id)));
        statements.push(`DELETE FROM tickets${ticketIds.length ? ` WHERE id NOT IN (${ticketIds.join(', ')})` : ''};`);
        statements.push(`DELETE FROM boards${boardIds.length ? ` WHERE id NOT IN (${boardIds.join(', ')})` : ''};`);
    }
    if (statements.length) {
        await executeTransaction(db, statements.join('\n'));
    }
    return result;
}
