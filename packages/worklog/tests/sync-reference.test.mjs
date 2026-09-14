/**
 * Tests for the migrations that added the workspace's two references (v23, v24):
 * a Git configuration and a todo-attribute configuration.
 *
 * A workspace used to store the remote URL, branch, commit identity and access
 * token itself. Those are now resources owned by the app config, and the
 * workspace keeps only `git_config_id`. The dangerous half is the schema change:
 * if the migration dropped or overwrote the legacy columns, an existing setup
 * would lose its remote before the adoption that lifts it into the library ever
 * runs. These tests pin that the migration adds the column and *nothing else*.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { CREATE_TABLES, SCHEMA_VERSION } from '../src/lib/db/schema.ts';
import { runMigrations } from '../src/lib/db/migrate.ts';

/** Minimal stand-in for the Tauri SQL plugin's `Database`. */
function pluginLike(sqlite) {
    return {
        select: async (sql, params) => sqlite.prepare(sql).all(...(params ?? [])),
        execute: async (sql, params) =>
            params?.length
                ? sqlite.prepare(sql).run(...params)
                : sqlite.exec(sql),
    };
}

/** A workspace as version 22 left it: no `git_config_id`, connection inline. */
function v22Workspace() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE workspace_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            sync_mode TEXT NOT NULL DEFAULT 'local',
            created_at TEXT NOT NULL
        );
        CREATE TABLE sync_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            remote_url TEXT NOT NULL DEFAULT '',
            access_token TEXT NOT NULL DEFAULT '',
            branch TEXT NOT NULL DEFAULT 'main',
            git_name TEXT NOT NULL DEFAULT '',
            git_email TEXT NOT NULL DEFAULT '',
            auto_sync INTEGER NOT NULL DEFAULT 0,
            auto_sync_interval INTEGER NOT NULL DEFAULT 15,
            last_synced_at TEXT,
            updated_at TEXT NOT NULL DEFAULT ''
        );
    `);

    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO workspace_meta (id, name, schema_version, created_at)
             VALUES (1, 'ws', 22, ?)`,
        )
        .run(now);
    sqlite
        .prepare(
            `INSERT INTO sync_config
                (id, remote_url, access_token, branch, git_name, git_email, auto_sync, auto_sync_interval, updated_at)
             VALUES (1, 'https://github.com/me/repo.git', 'ghp_secret', 'release', 'Ada', 'ada@example.com', 1, 30, ?)`,
        )
        .run(now);

    return sqlite;
}

test('migration adds the reference column without touching the legacy data', async () => {
    const sqlite = new v22Workspace();
    const db = pluginLike(sqlite);

    await runMigrations(db);

    const columns = sqlite
        .prepare(`PRAGMA table_info(sync_config)`)
        .all()
        .map((row) => row.name);
    assert.ok(
        columns.includes('git_config_id'),
        'the reference column must exist so a workspace can point at a config',
    );

    const row = sqlite.prepare('SELECT * FROM sync_config WHERE id = 1').get();
    assert.equal(
        row.git_config_id,
        '',
        'an existing workspace starts unreferenced; the adoption fills it in',
    );
    assert.equal(
        row.remote_url,
        'https://github.com/me/repo.git',
        'the legacy connection must survive the migration — it is the only copy',
    );
    assert.equal(row.branch, 'release');
    assert.equal(row.access_token, 'ghp_secret');
    assert.equal(row.git_name, 'Ada');
    assert.equal(row.git_email, 'ada@example.com');
    assert.equal(row.auto_sync, 1, 'workspace-scoped behaviour is untouched');
    assert.equal(row.auto_sync_interval, 30);

    const meta = sqlite
        .prepare('SELECT schema_version FROM workspace_meta WHERE id = 1')
        .get();
    assert.equal(meta.schema_version, SCHEMA_VERSION);
});

test('the migration is idempotent', async () => {
    const sqlite = new v22Workspace();
    const db = pluginLike(sqlite);

    await runMigrations(db);
    // Second run returns early on the version; a third would too. Assert the
    // repeat does not throw and leaves one row.
    await runMigrations(db);

    const rows = sqlite.prepare('SELECT COUNT(*) AS count FROM sync_config').all();
    assert.equal(rows[0].count, 1);
});

test('a fresh workspace gets the reference column straight from the schema', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(CREATE_TABLES);

    const columns = sqlite
        .prepare(`PRAGMA table_info(sync_config)`)
        .all()
        .map((row) => row.name);

    assert.ok(
        columns.includes('git_config_id'),
        'CREATE_TABLES must already carry it, or a new workspace would need the ALTER',
    );

    // The pre-reference columns stay declared so an older build writing them
    // again cannot resurrect a second source of truth.
    for (const legacy of ['remote_url', 'access_token', 'branch', 'git_name', 'git_email']) {
        assert.ok(columns.includes(legacy), `${legacy} must still exist`);
    }
});

// ── v24: the todo-attribute configuration reference ───────────────────────

test('migration v24 adds the catalog reference without touching workspace meta', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE workspace_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            sync_mode TEXT NOT NULL DEFAULT 'local',
            created_at TEXT NOT NULL
        );
    `);
    const now = new Date().toISOString();
    sqlite
        .prepare(
            `INSERT INTO workspace_meta (id, name, schema_version, created_at)
             VALUES (1, 'My workspace', 23, ?)`,
        )
        .run(now);

    await runMigrations(pluginLike(sqlite));

    const columns = sqlite
        .prepare(`PRAGMA table_info(workspace_meta)`)
        .all()
        .map((row) => row.name);
    assert.ok(
        columns.includes('catalog_set_id'),
        'the reference column must exist so a workspace can point at a configuration',
    );

    const row = sqlite.prepare('SELECT * FROM workspace_meta WHERE id = 1').get();
    assert.equal(row.name, 'My workspace', 'existing workspace data is untouched');
    assert.equal(
        row.catalog_set_id,
        '',
        'a workspace starts unreferenced; the adoption fills it in from its own rows',
    );
});

test('a fresh workspace gets the catalog reference straight from the schema', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(CREATE_TABLES);

    const columns = sqlite
        .prepare(`PRAGMA table_info(workspace_meta)`)
        .all()
        .map((row) => row.name);

    assert.ok(columns.includes('catalog_set_id'));
});
