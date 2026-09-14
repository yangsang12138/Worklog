import { getDb } from "$lib/db";
import { TagRepo } from "$lib/db";
import type { TagRecord } from "$lib/db/repositories/tag.repo";

/**
 * The workspace's tag catalog.
 *
 * Labels on a ticket are plain strings, so this catalog is a *suggestion* set:
 * a ticket keeps whatever label it carries even if the tag is removed here, and
 * a free-typed tag can be promoted into the catalog.
 */
export function useTags(workspacePath: () => string | null) {
    let tags = $state<TagRecord[]>([]);
    let loading = $state(false);
    let error = $state<string | null>(null);

    async function load() {
        const path = workspacePath();
        if (!path) return;

        loading = true;
        try {
            const db = await getDb(path);
            tags = await TagRepo.getAll(db);
        } catch (e) {
            error = String(e);
        } finally {
            loading = false;
        }
    }

    async function create(tag: Partial<TagRecord>) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TagRepo.create(db, tag);
        await load();
    }

    async function update(id: string, tag: Partial<TagRecord>) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TagRepo.update(db, id, tag);
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
        await TagRepo.setRetired(db, id, retired);
        await load();
    }

    async function remove(id: string) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TagRepo.remove(db, id);
        await load();
    }

    return {
        get tags() { return tags; },
        /**
         * The pickable catalog: retired rows are excluded, because they belong to
         * no configuration any more. `tags` keeps them so that a ticket which
         * points at one still shows a name rather than a raw id.
         */
        get activeTags() {
            return tags.filter((entry) => !entry.retired_at);
        },
        get names() { return tags.map((tag) => tag.name); },
        get loading() { return loading; },
        get error() { return error; },
        load,
        create,
        update,
        remove,
        setRetired,
    };
}

export type TagsApi = ReturnType<typeof useTags>;
