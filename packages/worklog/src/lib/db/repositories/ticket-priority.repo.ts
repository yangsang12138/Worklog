import type Database from "@tauri-apps/plugin-sql";

export interface TicketPriorityRecord {
    id: string;
    name: string;
    color: string;
    /** Ordering weight — lower sorts first (highest priority first). */
    rank: number;
    is_default: boolean;
    /** Set when the row left the active catalog but tickets still point at it. */
    retired_at?: string | null;
    created_at: string;
    updated_at: string;
}

export async function getAll(db: Database): Promise<TicketPriorityRecord[]> {
    const rows = await db.select<any[]>(
        "SELECT * FROM ticket_priorities ORDER BY rank ASC, name ASC"
    );
    return rows.map(mapRow);
}

export async function create(
    db: Database,
    priority: Partial<TicketPriorityRecord>,
): Promise<void> {
    const now = new Date().toISOString();
    const id = priority.id || crypto.randomUUID();

    if (priority.is_default) {
        await db.execute("UPDATE ticket_priorities SET is_default = 0");
    }

    const rank = priority.rank ?? (await nextRank(db));

    await db.execute(
        `INSERT INTO ticket_priorities (id, name, color, rank, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            priority.name ?? "",
            priority.color ?? "#0f62fe",
            rank,
            priority.is_default ? 1 : 0,
            now,
            now,
        ],
    );
}

export async function update(
    db: Database,
    id: string,
    priority: Partial<TicketPriorityRecord>,
): Promise<void> {
    const now = new Date().toISOString();

    if (priority.is_default) {
        await db.execute("UPDATE ticket_priorities SET is_default = 0");
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (priority.name !== undefined) { fields.push("name = ?"); values.push(priority.name); }
    if (priority.color !== undefined) { fields.push("color = ?"); values.push(priority.color); }
    if (priority.rank !== undefined) { fields.push("rank = ?"); values.push(priority.rank); }
    if (priority.is_default !== undefined) { fields.push("is_default = ?"); values.push(priority.is_default ? 1 : 0); }

    if (priority.retired_at !== undefined) { fields.push("retired_at = ?"); values.push(priority.retired_at); }
    fields.push("updated_at = ?");
    values.push(now);
    values.push(id);

    await db.execute(
        `UPDATE ticket_priorities SET ${fields.join(", ")} WHERE id = ?`,
        values,
    );
}

export async function remove(db: Database, id: string): Promise<void> {
    await db.execute("DELETE FROM ticket_priorities WHERE id = ?", [id]);
}

/** How many tickets currently reference this priority level. */
export async function usageCount(db: Database, id: string): Promise<number> {
    const rows = await db.select<{ count: number }[]>(
        "SELECT COUNT(*) as count FROM tickets WHERE priority = ?",
        [id],
    );
    return rows[0]?.count ?? 0;
}

async function nextRank(db: Database): Promise<number> {
    const rows = await db.select<{ max_rank: number | null }[]>(
        "SELECT MAX(rank) as max_rank FROM ticket_priorities",
    );
    const max = rows[0]?.max_rank;
    return (typeof max === "number" ? max : 0) + 10;
}

function mapRow(row: any): TicketPriorityRecord {
    return {
        ...row,
        rank: Number(row.rank),
        is_default: row.is_default === 1,
    };
}

/**
 * Retire a row, or bring it back.
 *
 * Retiring is what an applied configuration does to a row it does not contain
 * while a ticket still points at it: the row leaves the active catalog but stays
 * resolvable, so the ticket keeps its type/priority/tag. Restoring is the way
 * back, for when the user decides the row belongs in the catalog after all.
 */
export async function setRetired(
    db: Database,
    id: string,
    retired: boolean,
): Promise<void> {
    await db.execute(
        `UPDATE ticket_priorities SET retired_at = ?, updated_at = ? WHERE id = ?`,
        [retired ? new Date().toISOString() : null, new Date().toISOString(), id],
    );
}
