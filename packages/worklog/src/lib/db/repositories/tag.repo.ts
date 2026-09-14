import type Database from "@tauri-apps/plugin-sql";

export interface TagRecord {
    id: string;
    name: string;
    color: string;
    /** Set when the row left the active catalog but tickets still point at it. */
    retired_at?: string | null;
    created_at: string;
    updated_at: string;
}

export async function getAll(db: Database): Promise<TagRecord[]> {
    const rows = await db.select<any[]>(
        "SELECT * FROM tags ORDER BY name ASC"
    );
    return rows.map(mapRow);
}

/**
 * Insert a tag unless one with the same name already exists.
 *
 * Tag names are the ticket-facing identity (`tickets.labels` stores names, not
 * ids), so the name is what has to stay unique — `INSERT OR IGNORE` plus the
 * unique index makes the catalog self-healing when a free-typed tag is
 * promoted into it.
 */
export async function create(db: Database, tag: Partial<TagRecord>): Promise<void> {
    const now = new Date().toISOString();
    const id = tag.id || crypto.randomUUID();

    await db.execute(
        `INSERT OR IGNORE INTO tags (id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, (tag.name ?? "").trim(), tag.color ?? "cool-gray", now, now],
    );
}

export async function update(
    db: Database,
    id: string,
    tag: Partial<TagRecord>,
): Promise<void> {
    const now = new Date().toISOString();

    const fields: string[] = [];
    const values: any[] = [];

    if (tag.name !== undefined) { fields.push("name = ?"); values.push(tag.name.trim()); }
    if (tag.color !== undefined) { fields.push("color = ?"); values.push(tag.color); }

    if (tag.retired_at !== undefined) { fields.push("retired_at = ?"); values.push(tag.retired_at); }
    fields.push("updated_at = ?");
    values.push(now);
    values.push(id);

    await db.execute(`UPDATE tags SET ${fields.join(", ")} WHERE id = ?`, values);
}

/**
 * Drop a tag from the catalog.
 *
 * Tickets keep their label: a label on a ticket is data, and silently stripping
 * it would rewrite history. Deleting only stops the tag from being suggested.
 */
export async function remove(db: Database, id: string): Promise<void> {
    await db.execute("DELETE FROM tags WHERE id = ?", [id]);
}

function mapRow(row: any): TagRecord {
    return {
        id: row.id,
        name: row.name,
        color: row.color ?? "cool-gray",
        created_at: row.created_at,
        updated_at: row.updated_at,
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
        `UPDATE tags SET retired_at = ?, updated_at = ? WHERE id = ?`,
        [retired ? new Date().toISOString() : null, new Date().toISOString(), id],
    );
}
