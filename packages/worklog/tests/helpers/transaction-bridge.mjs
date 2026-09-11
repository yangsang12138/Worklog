// Emulate only the native IPC boundary using a real SQLite transaction.
export function installTransactionBridge(sqlite) {
    globalThis.window = {
        __TAURI_INTERNALS__: {
            invoke: async (command, { sql }) => {
                if (command !== 'execute_transaction') throw new Error(`Unexpected IPC: ${command}`);
                sqlite.exec('BEGIN IMMEDIATE');
                try {
                    sqlite.exec(sql);
                    sqlite.exec('COMMIT');
                } catch (error) {
                    sqlite.exec('ROLLBACK');
                    throw error;
                }
            },
        },
    };
}
