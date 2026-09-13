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

    async function remove(id: string) {
        const path = workspacePath();
        if (!path) return;
        const db = await getDb(path);
        await TagRepo.remove(db, id);
        await load();
    }

    return {
        get tags() { return tags; },
        get names() { return tags.map((tag) => tag.name); },
        get loading() { return loading; },
        get error() { return error; },
        load,
        create,
        update,
        remove,
    };
}

export type TagsApi = ReturnType<typeof useTags>;
