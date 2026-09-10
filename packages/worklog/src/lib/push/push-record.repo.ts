import type Database from '@tauri-apps/plugin-sql';
import type { PushRecord, CreatePushRecordInput, PushRecordStatus } from './types';
import { generateId } from '$lib/utils';

export interface PushRecordFilter {
    board_id?: string;
    ticket_id?: string;
    target_id?: string;
    status?: PushRecordStatus;
    limit?: number;
    offset?: number;
}

export class PushRecordRepo {
    static async list(db: Database, filter: PushRecordFilter = {}): Promise<PushRecord[]> {
        const conditions: string[] = [];
        const params: any[] = [];

        if (filter.board_id) {
            conditions.push('board_id = ?');
            params.push(filter.board_id);
        }
        if (filter.ticket_id) {
            conditions.push('ticket_id = ?');
            params.push(filter.ticket_id);
        }
        if (filter.target_id) {
            conditions.push('target_id = ?');
            params.push(filter.target_id);
        }
        if (filter.status) {
            conditions.push('status = ?');
            params.push(filter.status);
        }

        let query = `SELECT * FROM push_records`;
        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }
        query += ` ORDER BY created_at DESC`;

        if (filter.limit !== undefined) {
            query += ` LIMIT ?`;
            params.push(filter.limit);
        }
        if (filter.offset !== undefined) {
            query += ` OFFSET ?`;
            params.push(filter.offset);
        }

        return db.select<PushRecord[]>(query, params);
    }

    static async getById(db: Database, id: string): Promise<PushRecord | null> {
        const rows = await db.select<PushRecord[]>(
            `SELECT * FROM push_records WHERE id = ?`,
            [id]
        );
        return rows[0] ?? null;
    }

    static async create(
        db: Database,
        input: CreatePushRecordInput,
    ): Promise<PushRecord> {
        const now = new Date().toISOString();
        const record: PushRecord = {
            id: generateId('PR'),
            ticket_id: input.ticket_id,
            board_id: input.board_id,
            target_id: input.target_id,
            status: 'pending',
            request_url: input.request_url,
            request_body: input.request_body ?? null,
            variables_snapshot: input.variables_snapshot ?? null,
            response_status: input.response_status ?? null,
            response_body: input.response_body ?? null,
            error_message: input.error_message ?? null,
            duration_ms: input.duration_ms ?? null,
            created_at: now,
            updated_at: now,
        };

        await db.execute(
            `INSERT INTO push_records (
                id, ticket_id, board_id, target_id, status,
                request_url, request_body, variables_snapshot,
                response_status, response_body,
                error_message, duration_ms, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                record.id, record.ticket_id, record.board_id, record.target_id, record.status,
                record.request_url, record.request_body, record.variables_snapshot,
                record.response_status, record.response_body,
                record.error_message, record.duration_ms, record.created_at, record.updated_at,
            ]
        );

        return record;
    }

    static async updateStatus(
        db: Database,
        id: string,
        status: PushRecordStatus,
        data: {
            response_status?: number | null;
            response_body?: string | null;
            error_message?: string | null;
            duration_ms?: number | null;
        },
    ): Promise<void> {
        const now = new Date().toISOString();
        await db.execute(
            `UPDATE push_records SET
                status = ?,
                response_status = ?,
                response_body = ?,
                error_message = ?,
                duration_ms = ?,
                updated_at = ?
             WHERE id = ?`,
            [
                status,
                data.response_status ?? null,
                data.response_body ?? null,
                data.error_message ?? null,
                data.duration_ms ?? null,
                now,
                id,
            ]
        );
    }

    static async deleteByTarget(db: Database, target_id: string): Promise<void> {
        await db.execute(
            `DELETE FROM push_records WHERE target_id = ?`,
            [target_id]
        );
    }
}