import type Database from '@tauri-apps/plugin-sql';

/**
 * Repair a `tickets` table that still carries a stale CHECK constraint.
 *
 * Why this exists, independently of the migration chain:
 *
 *   1. Migration **v21** rebuilt `tickets` to drop the `status` CHECK — and its
 *      CREATE TABLE template *added back* `CHECK (priority IN ('p1','p2','p3'))`.
 *   2. Migration **v22** is the one that removes that priority CHECK, so on a
 *      normal upgrade the two cancel out.
 *   3. But `runMigrations` returns immediately when the workspace's stamped
 *      `schema_version` already equals the current one. A workspace whose version
 *      was advanced without the chain actually running (a crash mid-chain, or an
 *      older build that stamped the version on open) is therefore stranded with
 *      v21's table — and every attempt to file a ticket with a *custom* priority
 *      fails with SQLite error 275, `SQLITE_CONSTRAINT_CHECK`.
 *
 * The migration chain cannot fix that, by definition: it is already "up to date".
 * So this runs on every `getDb`, like `ensureBoardSchema` and `ensurePushSchema`,
 * and is safe to run repeatedly.
 *
 * It must run **before** `ensurePushSchema`: renaming `tickets` makes SQLite
 * rewrite `push_records.ticket_id`'s REFERENCES clause to the temporary table
 * name, and `ensurePushSchema` is what repairs that dangling reference.
 */
export async function ensureTicketSchema(db: Database): Promise<void> {
    const columns = await db.select<Array<{ name: string }>>(
        `PRAGMA table_info(tickets)`,
    );
    if (columns.length === 0) return;

    const ddl = await db.select<Array<{ sql: string | null }>>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tickets'`,
    );
    const sql = ddl[0]?.sql ?? '';

    // Only a CHECK that pins a user-definable attribute is stale. `board_id`'s
    // REFERENCES and every NOT NULL are legitimate and must be preserved.
    const staleChecks = [
        'CHECK (priority IN',
        'CHECK (status IN',
        'CHECK (ticket_type IN',
    ];
    if (!staleChecks.some((check) => sql.includes(check))) return;

    const names = new Set(columns.map((column) => column.name));
    /** Every column the current shape expects, with a source for the copy. */
    const shape: Array<[string, string]> = [
        ['id', 'id'],
        ['board_id', 'board_id'],
        ['title', 'title'],
        ['description', `COALESCE(description, '')`],
        ['status', `COALESCE(status, 'todo')`],
        ['priority', `COALESCE(priority, 'p2')`],
        ['ticket_type', `COALESCE(ticket_type, 'feature')`],
        ['position', 'COALESCE(position, 0)'],
        ['due_date', 'due_date'],
        ['start_date', 'start_date'],
        ['labels', `COALESCE(labels, '[]')`],
        ['comments', `COALESCE(comments, '[]')`],
        ['push_info', `COALESCE(push_info, '[]')`],
        ['created_at', 'created_at'],
        ['updated_at', 'updated_at'],
    ];

    const targets = shape.map(([name]) => name);
    const sources = shape.map(([name, fallback]) =>
        names.has(name) ? `"${name}"` : fallback,
    );

    await db.execute(`PRAGMA foreign_keys = OFF`);
    await db.execute(`BEGIN TRANSACTION`);

    try {
        await db.execute(`ALTER TABLE tickets RENAME TO tickets_stale`);
        await db.execute(`
            CREATE TABLE tickets (
                id          TEXT PRIMARY KEY,
                board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                -- No CHECK on status, priority or ticket_type: columns, priority
                -- levels and ticket types are all user-definable, and a ticket
                -- may hold a value this table has never heard of.
                status      TEXT NOT NULL DEFAULT 'todo',
                priority    TEXT NOT NULL DEFAULT 'p2',
                ticket_type TEXT NOT NULL DEFAULT 'feature',
                position    REAL NOT NULL DEFAULT 0,
                due_date    TEXT,
                start_date  TEXT,
                labels      TEXT NOT NULL DEFAULT '[]',
                comments    TEXT NOT NULL DEFAULT '[]',
                push_info   TEXT NOT NULL DEFAULT '[]',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        `);

        await db.execute(`
            INSERT INTO tickets (${targets.join(', ')})
            SELECT ${sources.join(', ')} FROM tickets_stale
        `);

        await db.execute(`DROP TABLE tickets_stale`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_ticket_type ON tickets(ticket_type)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_tickets_due_date ON tickets(due_date)`);

        await db.execute(`COMMIT`);
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    } finally {
        await db.execute(`PRAGMA foreign_keys = ON`);
    }
}
