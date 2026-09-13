import type Database from '@tauri-apps/plugin-sql';

import * as m from '$lib/paraglide/messages.js';

/**
 * The catalogs a workspace starts with.
 *
 * Priorities and tags are user-definable, but an empty picker is a hostile
 * first run, so a brand-new (or newly migrated) workspace gets a seeded set.
 * Seeding is idempotent: it only ever runs against an empty table, so a user
 * who deletes a built-in level never sees it come back.
 */

/** Tags offered by the ticket tag picker out of the box. */
export const DEFAULT_TAG_NAMES = [
    'frontend',
    'backend',
    'design',
    'docs',
    'devops',
    'auth',
    'api',
    'native',
    'tauri',
    'svelte',
    'setup',
    'blocked',
];

/**
 * The three levels the built-in `p1`/`p2`/`p3` ids refer to.
 *
 * Ids are fixed because tickets already store them; the *names* are seeded in
 * the user's current language and are freely renamable afterwards.
 */
function defaultPriorities() {
    return [
        { id: 'p1', name: m.modal_priority_high(), color: '#da1e28', rank: 10, is_default: 0 },
        { id: 'p2', name: m.modal_priority_medium(), color: '#005d5d', rank: 20, is_default: 1 },
        { id: 'p3', name: m.modal_priority_low(), color: '#044317', rank: 30, is_default: 0 },
    ];
}

async function seedPriorities(db: Database): Promise<void> {
    const rows = await db.select<{ count: number }[]>(
        'SELECT COUNT(*) as count FROM ticket_priorities',
    );
    if ((rows[0]?.count ?? 0) > 0) return;

    const now = new Date().toISOString();
    for (const priority of defaultPriorities()) {
        await db.execute(
            `INSERT OR IGNORE INTO ticket_priorities
                (id, name, color, rank, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [priority.id, priority.name, priority.color, priority.rank, priority.is_default, now, now],
        );
    }
}

async function seedTags(db: Database): Promise<void> {
    const rows = await db.select<{ count: number }[]>(
        'SELECT COUNT(*) as count FROM tags',
    );
    if ((rows[0]?.count ?? 0) > 0) return;

    const now = new Date().toISOString();
    for (const name of DEFAULT_TAG_NAMES) {
        await db.execute(
            `INSERT OR IGNORE INTO tags (id, name, color, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), name, 'cool-gray', now, now],
        );
    }
}

/**
 * Bring a workspace's attribute catalogs up to a usable state.
 *
 * Runs on every `getDb`, after migrations, so both a fresh workspace and one
 * migrated from an older schema end up with the same starting set.
 */
export async function seedCatalogs(db: Database): Promise<void> {
    await seedPriorities(db);
    await seedTags(db);
}
