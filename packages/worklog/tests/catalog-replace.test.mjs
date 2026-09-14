/**
 * Tests for what "replace this workspace's catalogs" actually does.
 *
 * The page logic itself is not reachable from plain Node, so the *semantics* are
 * pinned here by driving the same repositories the page drives. What matters:
 *
 *   - a configuration row updates an existing row in place (a rename must show);
 *   - a row the configuration does not have, and nothing references, is removed;
 *   - a row the configuration does not have but a ticket *does* reference is
 *     kept — removing it would put a raw id back on that ticket's card, which is
 *     the bug the catalogs-in-the-snapshot change exists to prevent.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { CREATE_TABLES, SCHEMA_VERSION } from '../src/lib/db/schema.ts';
import * as TicketTypeRepo from '../src/lib/db/repositories/ticket-type.repo.ts';
import * as TicketPriorityRepo from '../src/lib/db/repositories/ticket-priority.repo.ts';
import * as TagRepo from '../src/lib/db/repositories/tag.repo.ts';
import { collectCatalogUsage } from '../src/lib/db/repositories/catalog-usage.repo.ts';

function pluginLike(sqlite) {
    return {
        select: async (sql, params) => sqlite.prepare(sql).all(...(params ?? [])),
        execute: async (sql, params) =>
            params?.length
                ? sqlite.prepare(sql).run(...params)
                : sqlite.exec(sql),
    };
}

const CONFIG_ID = 'CAT-NEW001';

/** A workspace whose catalogs have drifted from the configuration below. */
function driftedWorkspace() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(CREATE_TABLES);
    const now = new Date().toISOString();

    sqlite
        .prepare(
            `INSERT INTO workspace_meta (id, name, schema_version, created_at) VALUES (1, 'ws', ?, ?)`,
        )
        .run(SCHEMA_VERSION, now);

    sqlite
        .prepare(
            `INSERT INTO boards (id, name, description, tabs_config, columns_config, created_at, updated_at)
             VALUES ('BRD-1', 'Board', '', '["kanban"]', '', ?, ?)`,
        )
        .run(now, now);

    // Catalogs: one row the config renames, one unused local row, one in-use one.
    const types = [
        ['bug', 'Bug', '#fa4d56', 0],
        ['TY-LOCAL', 'Only here (unused)', '#525252', 0],
        ['TY-USED', 'Only here (used)', '#0f62fe', 0],
    ];
    for (const [id, name, color, isDefault] of types) {
        sqlite
            .prepare(
                `INSERT INTO ticket_types (id, name, color, icon, is_default, created_at, updated_at)
                 VALUES (?, ?, ?, NULL, ?, ?, ?)`,
            )
            .run(id, name, color, isDefault, now, now);
    }

    // Both cases per kind: one row nothing points at (removable), one that a
    // ticket points at (must be kept).
    for (const [id, name, rank, isDefault] of [
        ['p1', 'High', 10, 1],
        ['PR-UNUSED', 'Unused level', 20, 0],
        ['PR-USED', 'Referenced level', 30, 0],
    ]) {
        sqlite
            .prepare(
                `INSERT INTO ticket_priorities (id, name, color, rank, is_default, created_at, updated_at)
                 VALUES (?, ?, '#da1e28', ?, ?, ?, ?)`,
            )
            .run(id, name, rank, isDefault, now, now);
    }

    for (const [id, name] of [
        ['uuid-a', 'backend'],
        ['uuid-b', 'unused-tag'],
        ['uuid-c', 'used-tag'],
    ]) {
        sqlite
            .prepare(
                `INSERT INTO tags (id, name, color, created_at, updated_at)
                 VALUES (?, ?, 'cool-gray', ?, ?)`,
            )
            .run(id, name, now, now);
    }

    // A ticket that points at the local type and the local priority.
    sqlite
        .prepare(
            `INSERT INTO tickets (id, board_id, title, description, status, priority, ticket_type, position, labels, comments, push_info, created_at, updated_at)
             VALUES ('TCK-1', 'BRD-1', 'T', '', 'todo', 'PR-USED', 'TY-USED', 0, '["used-tag"]', '[]', '[]', ?, ?)`,
        )
        .run(now, now);

    return sqlite;
}

/** The configuration being applied: it has neither local row. */
const config = {
    types: [{ id: 'bug', name: '缺陷', color: '#da1e28', icon: null, is_default: true }],
    priorities: [{ id: 'p1', name: 'High', color: '#da1e28', rank: 10, is_default: true }],
    tags: [{ id: 'uuid-a', name: 'backend', color: 'teal' }],
};

/** What the page does: upsert every rule, then remove what is left over. */
async function replaceCatalogs(db, sqlite) {
    const usage = await collectCatalogUsage(db);
    const counts = { created: 0, updated: 0, removed: 0, kept: 0 };

    for (const rule of config.types) {
        const exists = sqlite.prepare('SELECT id FROM ticket_types WHERE id = ?').get(rule.id);
        if (exists) {
            await TicketTypeRepo.update(db, rule.id, rule);
            counts.updated += 1;
        } else {
            await TicketTypeRepo.create(db, rule);
            counts.created += 1;
        }
    }
    for (const rule of config.priorities) {
        const exists = sqlite.prepare('SELECT id FROM ticket_priorities WHERE id = ?').get(rule.id);
        if (exists) {
            await TicketPriorityRepo.update(db, rule.id, rule);
            counts.updated += 1;
        } else {
            await TicketPriorityRepo.create(db, rule);
            counts.created += 1;
        }
    }
    for (const rule of config.tags) {
        const existing = sqlite.prepare('SELECT id FROM tags WHERE name = ?').get(rule.name);
        if (existing) {
            await TagRepo.update(db, existing.id, rule);
            counts.updated += 1;
        } else {
            await TagRepo.create(db, rule);
            counts.created += 1;
        }
    }

    const configTypeIds = new Set(config.types.map((rule) => rule.id));
    for (const row of sqlite
        .prepare('SELECT id FROM ticket_types WHERE retired_at IS NULL')
        .all()) {
        if (configTypeIds.has(row.id)) continue;
        if (usage.types.has(row.id)) {
            await TicketTypeRepo.setRetired(db, row.id, true);
            counts.kept += 1;
            continue;
        }
        await TicketTypeRepo.remove(db, row.id);
        counts.removed += 1;
    }

    const configPriorityIds = new Set(config.priorities.map((rule) => rule.id));
    for (const row of sqlite
        .prepare('SELECT id FROM ticket_priorities WHERE retired_at IS NULL')
        .all()) {
        if (configPriorityIds.has(row.id)) continue;
        if (usage.priorities.has(row.id)) {
            await TicketPriorityRepo.setRetired(db, row.id, true);
            counts.kept += 1;
            continue;
        }
        await TicketPriorityRepo.remove(db, row.id);
        counts.removed += 1;
    }

    const configTagNames = new Set(config.tags.map((rule) => rule.name));
    for (const row of sqlite
        .prepare('SELECT id, name FROM tags WHERE retired_at IS NULL')
        .all()) {
        if (configTagNames.has(row.name)) continue;
        if (usage.tags.has(row.name)) {
            await TagRepo.setRetired(db, row.id, true);
            counts.kept += 1;
            continue;
        }
        await TagRepo.remove(db, row.id);
        counts.removed += 1;
    }

    return counts;
}

test('a replace updates in place, removes what is unused, and keeps what is referenced', async () => {
    const sqlite = driftedWorkspace();
    const db = pluginLike(sqlite);

    const counts = await replaceCatalogs(db, sqlite);

    // The configuration's own row was refreshed: this is the part that must be
    // visible, and it is the part a user checks first.
    const bug = sqlite.prepare('SELECT * FROM ticket_types WHERE id = ?').get('bug');
    assert.equal(bug.name, '缺陷', 'a renamed type must actually change');
    assert.equal(bug.color, '#da1e28');

    // Unused local rows go.
    assert.equal(
        sqlite.prepare('SELECT id FROM ticket_types WHERE id = ?').get('TY-LOCAL'),
        undefined,
        'an unused local type is removed by a replace',
    );
    assert.equal(
        sqlite.prepare('SELECT id FROM ticket_priorities WHERE id = ?').get('PR-UNUSED'),
        undefined,
        'the unused local level goes too',
    );
    assert.equal(counts.removed, 3, 'TY-LOCAL, PR-UNUSED and unused-tag');
    assert.equal(counts.updated, 3, 'bug, p1, backend');
    assert.equal(counts.created, 0, 'nothing new was needed');

    // The referenced rows survive — retired, not deleted — so their ticket still
    // resolves. This is what lets the *active* catalog equal the configuration.
    const used = sqlite.prepare('SELECT name, retired_at FROM ticket_types WHERE id = ?').get('TY-USED');
    assert.equal(used?.name, 'Only here (used)');
    assert.ok(used.retired_at, 'a referenced type leaves the catalog but is not deleted');
    assert.ok(
        sqlite.prepare('SELECT retired_at FROM ticket_priorities WHERE id = ?').get('PR-USED').retired_at,
        'a level a ticket points at is retired as well',
    );
    assert.ok(
        sqlite.prepare('SELECT retired_at FROM tags WHERE name = ?').get('used-tag').retired_at,
        'and so is a tag in use',
    );
    assert.equal(counts.kept, 3, 'TY-USED, PR-USED and used-tag');

    const tag = sqlite.prepare('SELECT color FROM tags WHERE name = ?').get('backend');
    assert.equal(tag.color, 'teal', 'a tag matched by name is updated, not duplicated');
});

test('the usage query is what makes the difference', async () => {
    const sqlite = driftedWorkspace();
    const db = pluginLike(sqlite);

    const usage = await collectCatalogUsage(db);
    assert.deepEqual([...usage.types], ['TY-USED']);
    assert.deepEqual([...usage.priorities], ['PR-USED']);
    assert.deepEqual([...usage.tags], ['used-tag']);

    assert.equal(
        usage.types.has('TY-LOCAL'),
        false,
        'a row no ticket points at is removable — this is the whole distinction',
    );
});

test('after a replace the workspace holds exactly the configuration plus kept rows', async () => {
    const sqlite = driftedWorkspace();
    const db = pluginLike(sqlite);

    await replaceCatalogs(db, sqlite);

    const activeTypeIds = sqlite
        .prepare('SELECT id FROM ticket_types WHERE retired_at IS NULL ORDER BY id')
        .all()
        .map((row) => row.id);
    assert.deepEqual(
        activeTypeIds,
        ['bug'],
        'the active catalog is exactly the configuration — this is what "overwrite the instance" means',
    );
    const allTypeIds = sqlite
        .prepare('SELECT id FROM ticket_types ORDER BY id')
        .all()
        .map((row) => row.id);
    assert.deepEqual(
        allTypeIds,
        ['TY-USED', 'bug'].sort(),
        'while the retired row is still there for the ticket that points at it',
    );

    const defaultType = sqlite
        .prepare('SELECT id FROM ticket_types WHERE is_default = 1')
        .all()
        .map((row) => row.id);
    assert.deepEqual(
        defaultType,
        ['bug'],
        'replacing does not leave two rows claiming the default',
    );
});
