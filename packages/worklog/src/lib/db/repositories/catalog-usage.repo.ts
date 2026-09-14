import type Database from '@tauri-apps/plugin-sql';

/**
 * Which catalog rows this workspace's tickets actually point at.
 *
 * The question a replace has to answer before it removes anything: a type,
 * priority or tag that a ticket refers to must not vanish, or that ticket would
 * display a raw id like `TY-ABC123` — the bug the catalogs-in-the-snapshot change
 * exists to prevent.
 *
 * Deliberately imports nothing but types, so it can be driven by plain-Node
 * tests: this is the rule that decides whether a catalog row may be deleted.
 */
export async function collectCatalogUsage(db: Database): Promise<{
    types: Set<string>;
    priorities: Set<string>;
    tags: Set<string>;
}> {
    const types = new Set<string>();
    const priorities = new Set<string>();
    const tags = new Set<string>();

    try {
        for (const row of await db.select<{ id: string }[]>(
            `SELECT DISTINCT ticket_type AS id FROM tickets WHERE ticket_type <> ''`,
        )) {
            types.add(row.id);
        }
        for (const row of await db.select<{ id: string }[]>(
            `SELECT DISTINCT priority AS id FROM tickets WHERE priority <> ''`,
        )) {
            priorities.add(row.id);
        }
        for (const row of await db.select<{ labels: string }[]>(
            `SELECT labels FROM tickets`,
        )) {
            try {
                const parsed = JSON.parse(row.labels ?? '[]');
                if (Array.isArray(parsed)) {
                    for (const label of parsed) {
                        if (typeof label === 'string' && label) tags.add(label);
                    }
                }
            } catch {
                // A malformed labels cell says nothing about usage; skip it.
            }
        }
    } catch {
        // A workspace from before these columns existed: nothing to protect.
    }

    return { types, priorities, tags };
}
