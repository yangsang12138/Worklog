import type { WorklogSnapshot } from './types';

/** Validate everything before a replace import can change the database. */
export function validateSnapshot(input: WorklogSnapshot): WorklogSnapshot {
    if (!input || !Array.isArray(input.boards) || input.export_version !== 1) {
        throw new Error('Invalid or unsupported Worklog snapshot');
    }
    const boardIds = new Set<string>();
    const ticketIds = new Set<string>();
    const text = (value: unknown, name: string): string => {
        if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
            throw new Error(`Invalid snapshot field: ${name}`);
        }
        return value;
    };
    const array = (value: unknown, name: string): any[] => {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value ?? [];
        if (!Array.isArray(parsed)) throw new Error(`Invalid snapshot field: ${name}`);
        return parsed;
    };
    return {
        ...input,
        boards: input.boards.map(item => {
            if (!item?.board || !Array.isArray(item.tickets)) throw new Error('Invalid board snapshot');
            const b = item.board;
            text(b.id, 'board.id');
            if (!/^[\w-]+$/.test(b.id) || boardIds.has(b.id)) throw new Error(`Invalid or duplicate board ID: ${b.id}`);
            boardIds.add(b.id);
            const tabs = array(b.tabs_config ?? '["kanban"]', 'tabs_config');
            const board = {
                id: b.id, name: text(b.name, 'board.name'), description: b.description ?? '',
                tabs_config: JSON.stringify(tabs), archived_at: b.archived_at ?? null,
                created_at: text(b.created_at, 'board.created_at'),
                updated_at: text(b.updated_at ?? b.created_at, 'board.updated_at'),
            };
            const tickets = item.tickets.map(t => {
                text(t.id, 'ticket.id');
                if (ticketIds.has(t.id) || t.board_id !== b.id) throw new Error(`Invalid or duplicate ticket: ${t.id}`);
                ticketIds.add(t.id);
                const status = t.status ?? 'todo', priority = t.priority ?? 'p2';
                if (!['backlog', 'todo', 'in_progress', 'done'].includes(status)
                    || !['p1', 'p2', 'p3'].includes(priority)
                    || !Number.isFinite(t.position ?? 0)) throw new Error(`Invalid ticket: ${t.id}`);
                return {
                    id: t.id, board_id: b.id, title: text(t.title, 'ticket.title'),
                    description: t.description ?? '', status, priority,
                    ticket_type: t.ticket_type ?? 'feature', position: t.position ?? 0,
                    due_date: t.due_date ?? null, start_date: t.start_date ?? null,
                    labels: array(t.labels, 'labels'), comments: array(t.comments, 'comments'),
                    created_at: text(t.created_at, 'ticket.created_at'),
                    updated_at: text(t.updated_at ?? t.created_at, 'ticket.updated_at'),
                };
            });
            return { board, tickets };
        }),
    };
}
