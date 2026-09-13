import type Database from "@tauri-apps/plugin-sql";

export interface TagRecord {
    id: string;
    name: string;
    color: string;
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
