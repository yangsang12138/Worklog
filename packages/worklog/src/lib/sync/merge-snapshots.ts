import type { WorklogSnapshot } from '../db/mappers/types';

function canonical(value: unknown): string {
    if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
    if (value && typeof value === 'object') {
        return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]));
    }
    return JSON.stringify(value) ?? 'undefined';
}

function mergeRecords<T extends { id: string }>(base: T[], local: T[], remote: T[]): T[] {
    const baseMap = new Map(base.map(item => [item.id, item]));
    const localMap = new Map(local.map(item => [item.id, item]));
    const remoteMap = new Map(remote.map(item => [item.id, item]));
    const result: T[] = [];
    for (const id of new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()])) {
        const b = baseMap.get(id), l = localMap.get(id), r = remoteMap.get(id);
        let merged: T | undefined;
        if (canonical(l) === canonical(r)) merged = l;
        else if (canonical(b) === canonical(l)) merged = r;
        else if (canonical(b) === canonical(r)) merged = l;
        else if (b && l && r) {
            const fields = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]);
            const values: Record<string, unknown> = {};
            for (const field of fields) {
                const key = field as keyof T;
                if (field === 'updated_at') {
                    values[field] = [l[key], r[key]].sort().at(-1);
                } else if (canonical(l[key]) === canonical(r[key])) values[field] = l[key];
                else if (canonical(b[key]) === canonical(l[key])) values[field] = r[key];
                else if (canonical(b[key]) === canonical(r[key])) values[field] = l[key];
                else throw new Error(`Sync conflict: ${id}.${field}`);
            }
            merged = values as T;
        } else {
            // Covers edit/delete conflicts and independently created IDs.
            throw new Error(`Sync conflict: ${id}`);
        }
        if (merged) result.push(merged);
    }
    return result;
}

/** Merge against the common Git ancestor, including deletions on either side. */
export function mergeSnapshots(
    base: WorklogSnapshot | null,
    local: WorklogSnapshot,
    remote: WorklogSnapshot,
): WorklogSnapshot {
    const singleton = <T extends object>(b: T | null, l: T | null, r: T | null): T | null => {
        if (!base) return r ?? l;
        const wrap = (value: T | null) => value ? [{ ...value, id: 'settings' }] : [];
        const merged = mergeRecords(wrap(b), wrap(l), wrap(r))[0];
        if (!merged) return null;
        const { id: _id, ...value } = merged;
        return value as T;
    };
    const boards = mergeRecords(
        base?.boards.map(item => item.board) ?? [],
        local.boards.map(item => item.board),
        remote.boards.map(item => item.board),
    );
    const tickets = mergeRecords(
        base?.boards.flatMap(item => item.tickets) ?? [],
        local.boards.flatMap(item => item.tickets),
        remote.boards.flatMap(item => item.tickets),
    );
    const boardIds = new Set(boards.map(board => board.id));
    for (const ticket of tickets) {
        if (!boardIds.has(ticket.board_id)) throw new Error(`Sync conflict: deleted board ${ticket.board_id}`);
    }
    return {
        ...local,
        // These were already part of the export format. Keep the shared
        // settings on initial import instead of publishing fresh defaults.
        workspace_meta: singleton(base?.workspace_meta ?? null, local.workspace_meta, remote.workspace_meta),
        app_settings: singleton(base?.app_settings ?? null, local.app_settings, remote.app_settings),
        boards: boards.map(board => ({ board, tickets: tickets.filter(ticket => ticket.board_id === board.id) })),
    };
}
