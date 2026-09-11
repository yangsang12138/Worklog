import { afterEach, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CREATE_TABLES } from "../src/lib/db/schema";
import { ensurePushSchema } from "../src/lib/db/ensure-push-schema";
import { importSnapshot } from "../src/lib/db/mappers/import";
import { runAutomaticSync } from "../src/lib/sync/sync-flow";
let remote = "", failGit = null;
const transactionDbs = new Map();
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command, { db, sql }) => {
  if (command !== 'execute_transaction') throw new Error(`Unexpected IPC: ${command}`);
  const sqlite = transactionDbs.get(db);
  sqlite.exec('BEGIN IMMEDIATE');
  try { sqlite.exec(sql); sqlite.exec('COMMIT'); }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
} }));
const roots = [], databases = [], gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
function command(cwd, args) {
  return spawnSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });
}
function git(cwd, ...args) {
  const result = command(cwd, args);
  if (result.status !== 0)
    throw Error(result.stderr || result.stdout);
  return result.stdout.trim();
}
mock.module("@tauri-apps/plugin-shell", () => ({
  Command: { create: (_name, original, options = {}) => ({
    execute: async () => {
      if (failGit && original[0] === failGit)
        return { code: 128, stdout: "", stderr: "Authentication failed: fixture-token" };
      const args = [...original];
      if (args[0] === "remote" && ["add", "set-url"].includes(args[1]))
        args[3] = remote;
      const result = command(options.cwd, args);
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    }
  }) }
}));
mock.module("@tauri-apps/plugin-fs", () => ({
  exists: async (path) => {
    try {
      await access(path);
      return !0;
    } catch {
      return !1;
    }
  },
  mkdir: (path, options) => mkdir(path, options),
  writeTextFile: (path, content) => writeFile(path, content),
  readTextFile: (path) => readFile(path, "utf8"),
  readDir: async (path) => (await readdir(path, { withFileTypes: !0 })).map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() })),
  remove: (path) => rm(path)
}));
const { SyncEngine } = await import("../src/lib/sync/sync-engine"), { GitClient } = await import("../src/lib/sync/git-client"), { extractSnapshot } = await import("../src/lib/db/mappers/extract"), config = { remote_url: "https://github.com/worklog/test.git", access_token: "fixture-token", branch: "main", git_name: "Test", git_email: "test@example.invalid", auto_sync: !1, auto_sync_interval: 15, last_synced_at: null }, now = "2026-09-01T00:00:00.000Z";
function board(id, archived = !1) {
  return { board: { id, name: id, description: "", tabs_config: '["kanban","calendar"]', archived_at: archived ? now : null, created_at: now, updated_at: now }, tickets: [{ id: `T-${id}`, board_id: id, title: `Ticket ${id}`, description: "", status: "todo", priority: "p2", ticket_type: "feature", position: 1000, due_date: null, start_date: null, labels: ["test"], comments: [], created_at: now, updated_at: now }] };
}
function snapshot(boards) {
  return { export_version: 1, exported_at: now, workspace_meta: null, app_settings: null, boards };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "worklog-sync-engine-"));
  roots.push(root);
  remote = join(root, "remote.git");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  return root;
}
async function client(root, name, boards = []) {
  const path = join(root, name);
  await mkdir(path, { recursive: !0 });
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA legacy_alter_table = OFF;");
  sqlite.exec(CREATE_TABLES);
  transactionDbs.set(path, sqlite);
  const db = { path,
    execute: async (sql, values = []) => values.length ? sqlite.query(sql).run(...values) : sqlite.exec(sql),
    select: async (sql, values = []) => sqlite.query(sql).all(...values)
  };
  await ensurePushSchema(db);
  await importSnapshot(db, snapshot(boards));
  return { path, sqlite, db, engine: new SyncEngine(path), sync: join(path, ".worklog/sync") };
}
async function success(result) {
  expect(result.status, result.message).toBe("success");
}
async function data(db) {
  return (await extractSnapshot(db)).boards.sort((a, b) => a.board.id.localeCompare(b.board.id));
}
afterEach(async () => {
  failGit = null;
  databases.splice(0).forEach((db) => db.close());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: !0, force: !0 })));
});
test("first push, fresh-device pull, archive/tab/ticket roundtrip, repeated sync without extra commits", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1"), board("B2", !0)]);
  await success(await a.engine.push(a.db, config));
  const head = git(a.sync, "rev-parse", "HEAD"), b = await client(root, "b");
  await success(await b.engine.pull(b.db, config));
  expect(await data(b.db)).toEqual(await data(a.db));
  await success(await b.engine.push(b.db, config));
  expect(git(b.sync, "rev-parse", "HEAD")).toBe(head);
  const secondHead = git(b.sync, "rev-parse", "HEAD");
  await success(await b.engine.push(b.db, config));
  expect(git(b.sync, "rev-parse", "HEAD")).toBe(secondHead);
  await success(await b.engine.pull(b.db, config));
  expect(await data(b.db)).toEqual(await data(a.db));
});
(process.env.WORKLOG_AUDIT_REMOTE ? test : test.skip)("real configured remote snapshot imports its three boards into an empty workspace", async () => {
  const path = process.env.WORKLOG_AUDIT_REMOTE;
  if (!path)
    return;
  const root = await fixture();
  git(root, "--git-dir", remote, "fetch", path, "refs/heads/main:refs/heads/main");
  const c = await client(root, "real-remote");
  await success(await c.engine.pull(c.db, config));
  expect((await data(c.db)).map((b) => b.board.name).sort()).toEqual(["\u5F00\u53D1\u4EFB\u52A1", "\u6D4B\u8BD5", "\u8FD0\u8425\u4EFB\u52A1"].sort());
});
test("auto-sync publishes to an empty remote", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1")]);
  await success(await runAutomaticSync(() => a.engine.pull(a.db, config), () => a.engine.push(a.db, config)));
  expect(git(root, "--git-dir", remote, "ls-tree", "-r", "--name-only", "main")).toContain("boards/B1.json");
});
test("propagates board/ticket deletion and removes old JSON without resurrecting data", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1"), board("B2")]);
  await success(await a.engine.push(a.db, config));
  const b = await client(root, "b");
  await success(await b.engine.pull(b.db, config));
  a.sqlite.exec("DELETE FROM boards WHERE id = 'B1'; DELETE FROM tickets WHERE id = 'T-B2';");
  await success(await a.engine.push(a.db, config));
  expect(git(a.sync, "ls-files")).not.toContain("boards/B1.json");
  await success(await b.engine.pull(b.db, config));
  expect(await data(b.db)).toEqual(await data(a.db));
  await success(await b.engine.push(b.db, config));
  await success(await a.engine.pull(a.db, config));
  expect(await data(a.db)).toHaveLength(1);
});
test("preserves unpushed local deletion while pulling remote additions", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1")]);
  await success(await a.engine.push(a.db, config));
  const b = await client(root, "b");
  await success(await b.engine.pull(b.db, config));
  b.sqlite.exec("DELETE FROM boards WHERE id = 'B1'");
  await importSnapshot(a.db, snapshot([board("B2")]));
  await success(await a.engine.push(a.db, config));
  await success(await b.engine.pull(b.db, config));
  expect((await data(b.db)).map((b) => b.board.id)).toEqual(["B2"]);
  await success(await b.engine.push(b.db, config));
  await success(await a.engine.pull(a.db, config));
  expect(await data(a.db)).toEqual(await data(b.db));
});
test("merges independent edits to one ticket without losing local changes", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1")]);
  await success(await a.engine.push(a.db, config));
  const b = await client(root, "b");
  await success(await b.engine.pull(b.db, config));
  a.sqlite.exec("UPDATE tickets SET title = 'Remote title', updated_at = '2026-09-02' WHERE id = 'T-B1'");
  b.sqlite.exec("UPDATE tickets SET description = 'Local text', updated_at = '2026-09-03' WHERE id = 'T-B1'");
  await success(await a.engine.push(a.db, config));
  expect((await b.engine.push(b.db, config)).status).toBe("remote_has_data");
  await success(await b.engine.pull(b.db, config));
  const ticket = (await data(b.db))[0].tickets[0];
  expect(ticket.title).toBe("Remote title");
  expect(ticket.description).toBe("Local text");
});
test("conflicting edits leave the DB unchanged; force pull resolves and repeated normal pull succeeds", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1")]);
  await success(await a.engine.push(a.db, config));
  const b = await client(root, "b");
  await success(await b.engine.pull(b.db, config));
  a.sqlite.exec("UPDATE tickets SET title = 'Remote title' WHERE id = 'T-B1'");
  b.sqlite.exec("UPDATE tickets SET title = 'Local title' WHERE id = 'T-B1'");
  await success(await a.engine.push(a.db, config));
  const before = await data(b.db);
  expect((await b.engine.pull(b.db, config)).status).toBe("conflict");
  expect(await data(b.db)).toEqual(before);
  await success(await b.engine.forcePull(b.db, config));
  expect(await data(b.db)).toEqual(await data(a.db));
  await success(await b.engine.pull(b.db, config));
});
test("invalid remote snapshot cannot partially overwrite or wipe local data even with force pull", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1")]);
  await success(await a.engine.push(a.db, config));
  const b = await client(root, "b");
  await success(await b.engine.pull(b.db, config));
  const broken = board("B1");
  broken.tickets[0].status = "invalid";
  await writeFile(join(a.sync, "boards/B1.json"), JSON.stringify(broken));
  git(a.sync, "add", "-A");
  git(a.sync, "commit", "-m", "invalid snapshot");
  git(a.sync, "push", "origin", "main");
  const before = await data(b.db);
  expect((await b.engine.forcePull(b.db, config)).status).toBe("error");
  expect(await data(b.db)).toEqual(before);
});
test("force pull rejects repositories without a Worklog manifest", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1")]);
  await success(await a.engine.push(a.db, config));
  git(a.sync, "rm", "metadata.json");
  git(a.sync, "commit", "-m", "remove manifest");
  git(a.sync, "push", "origin", "main");
  const before = await data(a.db);
  expect((await a.engine.forcePull(a.db, config)).status).toBe("error");
  expect(await data(a.db)).toEqual(before);
});
test("supports configured non-default branches and reports missing branches", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1")]);
  await success(await a.engine.push(a.db, config));
  git(a.sync, "push", "origin", "HEAD:refs/heads/work");
  const b = await client(root, "b");
  await success(await b.engine.pull(b.db, { ...config, branch: "work" }));
  expect((await b.engine.pull(b.db, { ...config, branch: "missing" })).status).toBe("branch_mismatch");
});
test("creates an isolated sync repository when the workspace is inside another Git repository", async () => {
  const root = await fixture();
  git(root, "init", "--initial-branch=main");
  const a = await client(root, "a", [board("B1")]);
  await success(await a.engine.push(a.db, config));
  expect(git(a.sync, "rev-parse", "--show-prefix")).toBe("");
  expect(git(root, "remote")).toBe("");
});
test("force push removes stale files and publishes the chosen local snapshot", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1"), board("B2")]);
  await success(await a.engine.push(a.db, config));
  const b = await client(root, "b");
  await success(await b.engine.pull(b.db, config));
  b.sqlite.exec("DELETE FROM boards WHERE id = 'B2'");
  await success(await b.engine.forcePush(b.db, config));
  await success(await a.engine.forcePull(a.db, config));
  expect(await data(a.db)).toEqual(await data(b.db));
});
test("network/authentication errors are failures and redact credentials", async () => {
  const root = await fixture(), a = await client(root, "a");
  failGit = "ls-remote";
  const result = await a.engine.pull(a.db, config);
  expect(result.status).toBe("error");
  expect(result.message).not.toContain(config.access_token);
});
test("SQL strings are safely quoted and invalid imports leave existing data intact", async () => {
  const root = await fixture(), a = await client(root, "a", [board("B1")]), injection = board("B2");
  injection.board.name = "name'); DROP TABLE boards; --";
  await importSnapshot(a.db, snapshot([injection]));
  expect(await data(a.db)).toHaveLength(2);
  const before = await data(a.db), bad = board("B3");
  bad.tickets[0].board_id = "missing";
  await expect(importSnapshot(a.db, snapshot([board("B4"), bad]), "replace")).rejects.toThrow();
  expect(await data(a.db)).toEqual(before);
});

test('pull updates tickets while preserving local push history for retained tickets', async () => {
  const root = await fixture();
  const a = await client(root, 'a', [board('B1')]);
  await success(await a.engine.push(a.db, config));
  const b = await client(root, 'b');
  await success(await b.engine.pull(b.db, config));
  b.sqlite.exec(`
    INSERT INTO push_targets (id, name, endpoint_url, created_at, updated_at) VALUES ('target', 'Target', '/test', 'now', 'now');
    INSERT INTO push_records (id, ticket_id, board_id, target_id, request_url, response_body, created_at, updated_at)
      VALUES ('record', 'T-B1', 'B1', 'target', '/test', 'history', 'now', 'now');
  `);
  a.sqlite.exec("UPDATE tickets SET title = 'Updated remote title' WHERE id = 'T-B1'");
  await success(await a.engine.push(a.db, config));
  await success(await b.engine.pull(b.db, config));
  expect(b.sqlite.query('SELECT response_body FROM push_records').get().response_body).toBe('history');
});

test('local commits from a failed push survive the next pull and successful retry', async () => {
  const root = await fixture();
  const a = await client(root, 'a', [board('B1')]);
  await success(await a.engine.push(a.db, config));
  a.sqlite.exec("UPDATE tickets SET title = 'Unpushed edit' WHERE id = 'T-B1'");
  failGit = 'push';
  expect((await a.engine.push(a.db, config)).status).toBe('error');
  failGit = null;
  await success(await a.engine.pull(a.db, config));
  expect((await data(a.db))[0].tickets[0].title).toBe('Unpushed edit');
  await success(await a.engine.push(a.db, config));
  const b = await client(root, 'b');
  await success(await b.engine.pull(b.db, config));
  expect(await data(b.db)).toEqual(await data(a.db));
});

test('unrelated local history merges different board IDs without a Git text conflict', async () => {
  const root = await fixture();
  const a = await client(root, 'a', [board('B1')]);
  await success(await a.engine.push(a.db, config));
  const b = await client(root, 'b', [board('B2')]);
  await mkdir(b.sync, { recursive: true });
  git(b.sync, 'init', '--initial-branch=main');
  git(b.sync, 'config', 'user.name', 'Test'); git(b.sync, 'config', 'user.email', 'test@example.invalid');
  git(b.sync, 'commit', '--allow-empty', '-m', 'unrelated local snapshot');
  await success(await b.engine.pull(b.db, config));
  expect((await data(b.db)).map(b => b.board.id)).toEqual(['B1', 'B2']);
});
