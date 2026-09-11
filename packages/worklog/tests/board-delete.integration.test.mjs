import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { CREATE_TABLES } from '../src/lib/db/schema.ts';
import { registerHooks } from 'node:module';
import { installTransactionBridge } from './helpers/transaction-bridge.mjs';
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === './transaction' && context.parentURL?.endsWith('/ensure-push-schema.ts')) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
});
const { ensurePushSchema } = await import('../src/lib/db/ensure-push-schema.ts');
hooks.deregister();

function database(t) {
    const sqlite = new DatabaseSync(':memory:');
    t.after(() => sqlite.close());
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite.exec(CREATE_TABLES);
    installTransactionBridge(sqlite);
    return {
        sqlite,
        execute: async (sql, params = []) => params.length
            ? sqlite.prepare(sql).run(...params)
            : sqlite.exec(sql),
        select: async (sql, params = []) => sqlite.prepare(sql).all(...params),
    };
}

function seed(sqlite) {
    sqlite.exec(`
        INSERT INTO boards (id, name, archived_at, created_at, updated_at) VALUES
            ('active', 'Active', NULL, 'now', 'now'),
            ('archived', 'Archived', 'now', 'now', 'now');
        INSERT INTO tickets (id, board_id, title, created_at, updated_at) VALUES
            ('t1', 'active', 'Ticket 1', 'now', 'now'),
            ('t2', 'archived', 'Ticket 2', 'now', 'now');
        INSERT INTO push_targets (id, name, endpoint_url, created_at, updated_at)
            VALUES ('target', 'Target', 'https://example.invalid', 'now', 'now');
        INSERT INTO push_records (
            id, ticket_id, board_id, target_id, request_url, request_body,
            variables_snapshot, response_body, created_at, updated_at
        ) VALUES
            ('r1', 't1', 'active', 'target', '/push', 'request 1', '{}', 'response 1', 'now', 'now'),
            ('r2', 't2', 'archived', 'target', '/push', 'request 2', '{}', 'response 2', 'now', 'now');
    `);
}

function simulateLegacyMigration(sqlite, legacyTable) {
    const { sql } = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'tickets'").get();
    // The old migration renames the parent first, so SQLite rewrites the child FK.
    sqlite.exec(`
        PRAGMA foreign_keys = OFF;
        ALTER TABLE tickets RENAME TO ${legacyTable};
        ${sql};
        INSERT INTO tickets SELECT * FROM ${legacyTable};
        DROP TABLE ${legacyTable};
        PRAGMA foreign_keys = ON;
    `);
}

for (const legacyTable of ['tickets_legacy', 'tickets_v4', 'tickets_v7', 'tickets_v11']) {
    test(`repairs ${legacyTable} references and preserves history before cascading board deletion`, async (t) => {
        const db = database(t);
        seed(db.sqlite);
        simulateLegacyMigration(db.sqlite, legacyTable);
        const history = await db.select('SELECT * FROM push_records ORDER BY id');
        assert.throws(() => db.sqlite.exec("DELETE FROM boards WHERE id = 'active'"), /no such table/);

        await ensurePushSchema(db);
        await ensurePushSchema(db); // Reopening an already repaired workspace is harmless.
        assert.deepEqual(await db.select('SELECT * FROM push_records ORDER BY id'), history);
        assert.deepEqual(await db.select('PRAGMA foreign_key_check'), []);
        const indexes = await db.select("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'push_records'");
        assert.ok(indexes.some(({ name }) => name === 'idx_push_records_ticket'));

        db.sqlite.exec("DELETE FROM boards WHERE id = 'active'");
        assert.deepEqual((await db.select('SELECT id FROM tickets')).map(({ id }) => id), ['t2']);
        assert.deepEqual((await db.select('SELECT id FROM push_records')).map(({ id }) => id), ['r2']);
        db.sqlite.exec("DELETE FROM boards WHERE id = 'archived'");
        assert.deepEqual(await db.select('SELECT * FROM boards'), []);
        assert.deepEqual(await db.select('SELECT * FROM tickets'), []);
        assert.deepEqual(await db.select('SELECT * FROM push_records'), []);
        assert.equal((await db.select('SELECT * FROM push_targets')).length, 1);
    });
}

test('repairs empty legacy workspaces, where deleting even an empty board fails', async (t) => {
    const db = database(t);
    simulateLegacyMigration(db.sqlite, 'tickets_v11');
    db.sqlite.exec("INSERT INTO boards (id, name, created_at, updated_at) VALUES ('empty', 'Empty', 'now', 'now')");
    assert.throws(() => db.sqlite.exec("DELETE FROM boards WHERE id = 'empty'"), /no such table/);
    await ensurePushSchema(db);
    db.sqlite.exec("DELETE FROM boards WHERE id = 'empty'");
    assert.deepEqual(await db.select('SELECT * FROM boards'), []);
});

test('leaves a healthy schema and its push records unchanged', async (t) => {
    const db = database(t);
    seed(db.sqlite);
    await ensurePushSchema(db);
    const schema = await db.select('SELECT * FROM sqlite_master ORDER BY name');
    const records = await db.select('SELECT * FROM push_records ORDER BY id');
    await ensurePushSchema(db);
    assert.deepEqual(await db.select('SELECT * FROM sqlite_master ORDER BY name'), schema);
    assert.deepEqual(await db.select('SELECT * FROM push_records ORDER BY id'), records);
});

test('rolls back repair instead of dropping history when existing records violate foreign keys', async (t) => {
    const db = database(t);
    seed(db.sqlite);
    simulateLegacyMigration(db.sqlite, 'tickets_v11');
    db.sqlite.exec("PRAGMA foreign_keys = OFF; UPDATE push_records SET ticket_id = 'missing' WHERE id = 'r1'; PRAGMA foreign_keys = ON;");
    const records = await db.select('SELECT * FROM push_records ORDER BY id');
    await assert.rejects(ensurePushSchema(db), /FOREIGN KEY constraint failed/);
    assert.deepEqual(await db.select('SELECT * FROM push_records ORDER BY id'), records);
    assert.deepEqual(await db.select("SELECT name FROM sqlite_master WHERE name = 'push_records_repaired'"), []);
});
