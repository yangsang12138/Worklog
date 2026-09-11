import { beforeEach, expect, mock, test } from "bun:test";
globalThis.$state = (value) => value;
let path = "/workspace", loads = [], calls = [], saved = [], lastSynced = null, pullStatus = "success", pushStatus = "success";
const config = { remote_url: "https://github.com/test/repo", access_token: "secret", branch: "main", auto_sync: !0, auto_sync_interval: 15, last_synced_at: null, git_name: "", git_email: "" }, result = (status, kind) => ({ status, message: kind, successKind: kind, timestamp: "2026-09-11T00:00:00Z" });
mock.module("$lib/hooks/workspace.svelte", () => ({ getWorkspace: () => ({ get path() {
  return path;
}, refreshMeta: async () => {}, status: "ready" }) }));
mock.module("$lib/sync/sync-config.svelte", () => ({ getSyncConfig: () => ({ config, updateLastSynced: (value) => {
  lastSynced = value;
} }) }));
mock.module("$lib/db", () => ({ getDb: async () => ({ execute: async (...args) => {
  saved.push(args);
} }) }));
mock.module("$lib/hooks/boards.svelte", () => ({ getBoards: () => ({ load: async () => {
  loads.push("boards");
}, loadArchived: async () => {
  loads.push("archived");
} }) }));
mock.module("$lib/hooks/undo-redo.svelte", () => ({ getUndoRedo: () => ({ clear: () => {
  loads.push("undo");
} }) }));
mock.module("$lib/hooks/notifications.svelte", () => ({ notifications: { add: () => {} } }));
mock.module("$lib/sync/sync-engine", () => ({ SyncEngine: class {
  async isGitAvailable() {
    return !0;
  }
  async pull() {
    calls.push("pull");
    return result(pullStatus, "pulled");
  }
  async push() {
    calls.push("push");
    return result(pushStatus, "pushed");
  }
  async forcePull() {
    calls.push("force_pull");
    return result(pullStatus, "force_pulled");
  }
  async forcePush() {
    calls.push("force_push");
    return result(pushStatus, "force_pushed");
  }
} }));
const { runSyncOperation, syncState, clearSyncResolution } = await import("../src/lib/sync/sync-scheduler.svelte");
beforeEach(() => {
  path = "/workspace";
  loads = [];
  calls = [];
  saved = [];
  lastSynced = null;
  pullStatus = "success";
  pushStatus = "success";
  clearSyncResolution();
});
test("manual and force pull refresh boards, archives and page revision, then persist timestamp", async () => {
  for (const operation of ["pull", "force_pull"]) {
    const revision = syncState.dataVersion, outcome = await runSyncOperation(path, config, operation);
    expect(outcome.status).toBe("success");
    expect(loads.slice(-3)).toEqual(["boards", "archived", "undo"]);
    expect(syncState.dataVersion).toBe(revision + 1);
    expect(lastSynced).toBe(outcome.timestamp);
    expect(syncState.isSyncing).toBe(!1);
  }
});
test("auto pull refreshes imported data even if the subsequent push fails", async () => {
  pushStatus = "error";
  const revision = syncState.dataVersion;
  expect((await runSyncOperation(path, config, "auto")).status).toBe("error");
  expect(calls).toEqual(["pull", "push"]);
  expect(syncState.dataVersion).toBe(revision + 1);
  expect(saved).toHaveLength(0);
});
test("conflict does not refresh or push and queues an explicit resolution", async () => {
  pullStatus = "conflict";
  const revision = syncState.dataVersion;
  expect((await runSyncOperation(path, config, "auto")).status).toBe("conflict");
  expect(calls).toEqual(["pull"]);
  expect(loads).toHaveLength(0);
  expect(syncState.dataVersion).toBe(revision);
  expect(syncState.pendingResolution?.status).toBe("conflict");
});
test("empty remote auto sync publishes initial data and does not refresh unchanged DB", async () => {
  pullStatus = "remote_empty";
  expect((await runSyncOperation(path, config, "auto")).status).toBe("success");
  expect(calls).toEqual(["pull", "push"]);
  expect(loads).toHaveLength(0);
  expect(saved).toHaveLength(1);
});
test("completion for another workspace cannot replace the current boards or sync timestamp", async () => {
  const revision = syncState.dataVersion;
  expect((await runSyncOperation("/previous-workspace", config, "pull")).status).toBe("success");
  expect(loads).toHaveLength(0);
  expect(syncState.dataVersion).toBe(revision);
  expect(lastSynced).toBeNull();
});
