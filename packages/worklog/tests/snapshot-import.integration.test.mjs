import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { installTransactionBridge } from './helpers/transaction-bridge.mjs';
import { CREATE_TABLES } from '../src/lib/db/schema.ts';

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (['./validate-snapshot', '../transaction'].includes(specifier) && context.parentURL?.endsWith('/mappers/import.ts')) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
});
const { importSnapshot } = await import('../src/lib/db/mappers/import.ts');
hooks.deregister();

function fixture(t) {
    const sqlite = new DatabaseSync(':memory:');
    t.after(() => sqlite.close());
    sqlite.exec(CREATE_TABLES);
    installTransactionBridge(sqlite);
    const db = {
        execute: async sql => sqlite.exec(sql),
        select: async sql => sqlite.prepare(sql).all(),
    };
    return { sqlite, db };
}
function board(id) {
    return { board: { id, name: id, created_at: 'now', updated_at: 'now' }, tickets: [
        { id: `T-${id}`, board_id: id, title: id, created_at: 'now', updated_at: 'now' },
    ] };
}
function snapshot(boards) { return { export_version: 1, boards }; }

test('a late SQL failure rolls back earlier imports and retains the complete original database', async t => {
    const { sqlite, db } = fixture(t);
    await importSnapshot(db, snapshot([board('original')]));
    sqlite.exec(`CREATE TRIGGER reject_import BEFORE INSERT ON tickets WHEN NEW.id = 'T-bad'
        BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
    await assert.rejects(importSnapshot(db, snapshot([board('first'), board('bad')]), 'replace'), /fixture failure/);
    assert.deepEqual(sqlite.prepare('SELECT id FROM boards').all().map(b => b.id), ['original']);
    assert.deepEqual(sqlite.prepare('SELECT id FROM tickets').all().map(t => t.id), ['T-original']);
    await importSnapshot(db, snapshot([board('retry')]));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM boards').get().count, 2);
});

test('invalid replace input is rejected before deleting local boards', async t => {
    const { sqlite, db } = fixture(t);
    await importSnapshot(db, snapshot([board('original')]));
    const bad = board('bad'); bad.tickets[0].board_id = 'elsewhere';
    await assert.rejects(importSnapshot(db, snapshot([board('first'), bad]), 'replace'));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM boards').get().count, 1);
});

test('valid empty replacement deletes all boards and tickets', async t => {
    const { sqlite, db } = fixture(t);
    await importSnapshot(db, snapshot([board('original')]));
    await importSnapshot(db, snapshot([]), 'replace');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM boards').get().count, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM tickets').get().count, 0);
});
