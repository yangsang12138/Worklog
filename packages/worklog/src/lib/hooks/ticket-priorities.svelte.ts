import { getDb } from "$lib/db";
import { TicketPriorityRepo } from "$lib/db";
import type { TicketPriorityRecord } from "$lib/db/repositories/ticket-priority.repo";

/**
 * The workspace's priority levels.
 *
 * Built-in `p1`/`p2`/`p3` are seeded rows rather than hard-coded constants, so
 * they can be renamed, recoloured, reordered and added to. Views resolve a
 * ticket's priority through the priority registry, which falls back to the
 * built-in labels if a level is missing from the table.
 */
export function useTicketPriorities(workspacePath: () => string | null) {
    let priorities = $state<TicketPriorityRecord[]>([]);
    let loading = $state(false);
    let error = $state<string | null>(null);

    async function load() {
        const path = workspacePath();
        if (!path) return;

        loading = true;
        try {
            const db = await getDb(path);
            priorities = await TicketPriorityRepo.getAll(db);
        } catch (e) {
            error = String(e);
        } finally {
            loading = false;
        }
    }

    async function create(priority: Partial<TicketPriorityRecord>) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TicketPriorityRepo.create(db, priority);
        await load();
    }

    async function update(id: string, priority: Partial<TicketPriorityRecord>) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TicketPriorityRepo.update(db, id, priority);
        await load();
    }

    async function remove(id: string) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TicketPriorityRepo.remove(db, id);
        await load();
    }

    /** How many tickets still reference this level — deleting one is lossy. */
    async function usage(id: string): Promise<number> {
        const path = workspacePath();
        if (!path) return 0;
        const db = await getDb(path);
        return TicketPriorityRepo.usageCount(db, id);
    }

    return {
        get priorities() { return priorities; },
        get loading() { return loading; },
        get error() { return error; },
        load,
        create,
        update,
        remove,
        usage,
    };
}

export type TicketPrioritiesApi = ReturnType<typeof useTicketPriorities>;
