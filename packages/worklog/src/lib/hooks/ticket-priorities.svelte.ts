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

    /**
     * Take a row out of the active catalog, or put it back.
     *
     * An applied configuration retires a row it does not contain while a ticket
     * still points at it, so the ticket keeps its name and colour while the
     * workspace's active catalog matches the configuration.
     */
    async function setRetired(id: string, retired: boolean) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TicketPriorityRepo.setRetired(db, id, retired);
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
        /**
         * The pickable catalog: retired rows are excluded, because they belong to
         * no configuration any more. `priorities` keeps them so that a ticket which
         * points at one still shows a name rather than a raw id.
         */
        get activePriorities() {
            return priorities.filter((entry) => !entry.retired_at);
        },
        get loading() { return loading; },
        get error() { return error; },
        load,
        create,
        update,
        remove,
        setRetired,
        usage,
    };
}

export type TicketPrioritiesApi = ReturnType<typeof useTicketPriorities>;
