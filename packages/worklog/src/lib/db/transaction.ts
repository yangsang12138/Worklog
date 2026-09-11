import { invoke } from '@tauri-apps/api/core';
import type Database from '@tauri-apps/plugin-sql';

/** Run the entire batch and its rollback on one pinned pool connection. */
export function executeTransaction(db: Database, sql: string): Promise<void> {
    return invoke('execute_transaction', { db: db.path, sql });
}
