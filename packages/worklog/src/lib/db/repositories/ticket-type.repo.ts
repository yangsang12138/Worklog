import type Database from "@tauri-apps/plugin-sql";

export interface TicketType {
    id: string;
    name: string;
    color: string;
    icon: string | null;
    is_default: boolean;
    /**
     * When set, the row has left the active catalog (a configuration overwrote
     * this workspace without it) but is kept so tickets that point at it still
     * resolve.
     */
    retired_at?: string | null;
    created_at: string;
    updated_at: string;
}

export async function getAll(db: Database): Promise<TicketType[]> {
    const rows = await db.select<any[]>(
        "SELECT * FROM ticket_types ORDER BY name ASC"
    );
    return rows.map(mapRow);
}

export async function getById(db: Database, id: string): Promise<TicketType | null> {
    const rows = await db.select<any[]>(
        "SELECT * FROM ticket_types WHERE id = ?",
        [id]
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function getDefault(db: Database): Promise<TicketType | null> {
    const rows = await db.select<any[]>(
        "SELECT * FROM ticket_types WHERE is_default = 1 LIMIT 1"
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function create(db: Database, type: Partial<TicketType>): Promise<void> {
    const now = new Date().toISOString();
    const id = type.id || crypto.randomUUID();
    
    // If setting as default, unset others
    if (type.is_default) {
        await db.execute("UPDATE ticket_types SET is_default = 0");
    }

    await db.execute(
        "INSERT INTO ticket_types (id, name, color, icon, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, type.name, type.color, type.icon, type.is_default ? 1 : 0, now, now]
    );
}

export async function update(db: Database, id: string, type: Partial<TicketType>): Promise<void> {
    const now = new Date().toISOString();
    
    if (type.is_default) {
        await db.execute("UPDATE ticket_types SET is_default = 0");
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (type.name !== undefined) { fields.push("name = ?"); values.push(type.name); }
    if (type.color !== undefined) { fields.push("color = ?"); values.push(type.color); }
    if (type.icon !== undefined) { fields.push("icon = ?"); values.push(type.icon); }
    if (type.is_default !== undefined) { fields.push("is_default = ?"); values.push(type.is_default ? 1 : 0); }
    
    if (type.retired_at !== undefined) { fields.push("retired_at = ?"); values.push(type.retired_at); }
    fields.push("updated_at = ?");
    values.push(now);
    values.push(id);

    await db.execute(
        `UPDATE ticket_types SET ${fields.join(", ")} WHERE id = ?`,
        values
    );
}

export async function remove(db: Database, id: string): Promise<void> {
    await db.execute("DELETE FROM ticket_types WHERE id = ?", [id]);
}

function mapRow(row: any): TicketType {
    return {
        ...row,
        is_default: row.is_default === 1
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
        `UPDATE ticket_types SET retired_at = ?, updated_at = ? WHERE id = ?`,
        [retired ? new Date().toISOString() : null, new Date().toISOString(), id],
    );
}
