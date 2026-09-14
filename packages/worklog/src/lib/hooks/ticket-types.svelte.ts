import { getDb } from "$lib/db";
import { TicketTypeRepo } from "$lib/db";
import type { TicketType } from "$lib/db/repositories/ticket-type.repo";

export function useTicketTypes(workspacePath: () => string | null) {
    let types = $state<TicketType[]>([]);
    let loading = $state(false);
    let error = $state<string | null>(null);

    async function load() {
        const path = workspacePath();
        if (!path) return;

        loading = true;
        try {
            const db = await getDb(path);
            types = await TicketTypeRepo.getAll(db);
        } catch (e) {
            error = String(e);
        } finally {
            loading = false;
        }
    }

    async function create(type: Partial<TicketType>) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TicketTypeRepo.create(db, type);
        await load();
    }

    async function update(id: string, type: Partial<TicketType>) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TicketTypeRepo.update(db, id, type);
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
        await TicketTypeRepo.setRetired(db, id, retired);
        await load();
    }

    async function remove(id: string) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TicketTypeRepo.remove(db, id);
        await load();
    }

    return {
        get types() { return types; },
        /**
         * The pickable catalog: retired rows are excluded, because they belong to
         * no configuration any more. `types` keeps them so that a ticket which
         * points at one still shows a name rather than a raw id.
         */
        get activeTypes() {
            return types.filter((entry) => !entry.retired_at);
        },
        get loading() { return loading; },
        get error() { return error; },
        load,
        create,
        update,
        remove,
        setRetired
    };
}
