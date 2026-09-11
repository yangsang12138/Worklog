import type Database from '@tauri-apps/plugin-sql';
import type { PushTarget, CreatePushTargetInput, UpdatePushTargetInput } from './types';
import { generateId } from '$lib/utils';

export class PushTargetRepo {
    static async list(db: Database): Promise<PushTarget[]> {
        return db.select<PushTarget[]>(
            `SELECT * FROM push_targets ORDER BY created_at ASC`
        );
    }

    static async getById(db: Database, id: string): Promise<PushTarget | null> {
        const rows = await db.select<PushTarget[]>(
            `SELECT * FROM push_targets WHERE id = ?`,
            [id]
        );
        return rows[0] ?? null;
    }

    static async create(db: Database, input: CreatePushTargetInput): Promise<PushTarget> {
        const now = new Date().toISOString();
        const target: PushTarget = {
            id: generateId('PT'),
            name: input.name,
            description: input.description ?? '',
            endpoint_url: input.endpoint_url,
            http_method: input.http_method ?? 'POST',
            headers: input.headers ?? '{}',
            body_template: input.body_template ?? '',
            body_content_type: input.body_content_type ?? 'application/json',
            field_mapping: input.field_mapping ?? '{}',
            payload_fields: input.payload_fields ?? '[]',
            query_params: input.query_params ?? '[]',
            variables: input.variables ?? '[]',
            source_config: input.source_config ?? '',
            success_check: input.success_check ?? '',
            timeout_ms: input.timeout_ms ?? 30000,
            retry_count: input.retry_count ?? 0,
            enabled: input.enabled ?? 1,
            last_push_at: null,
            created_at: now,
            updated_at: now,
        };

        await db.execute(
            `INSERT INTO push_targets (
                id, name, description, endpoint_url, http_method,
                headers, body_template, body_content_type, field_mapping,
                payload_fields, query_params, variables, source_config, success_check,
                timeout_ms, retry_count, enabled, last_push_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                target.id, target.name, target.description, target.endpoint_url, target.http_method,
                target.headers, target.body_template, target.body_content_type, target.field_mapping,
                target.payload_fields, target.query_params, target.variables, target.source_config,
                target.success_check,
                target.timeout_ms, target.retry_count, target.enabled, target.last_push_at,
                target.created_at, target.updated_at,
            ]
        );

        return target;
    }

    static async update(
        db: Database,
        id: string,
        input: UpdatePushTargetInput,
    ): Promise<PushTarget | null> {
        const existing = await this.getById(db, id);
        if (!existing) return null;

        const now = new Date().toISOString();
        const next: PushTarget = {
            ...existing,
            ...input,
            updated_at: now,
        };

        await db.execute(
            `UPDATE push_targets SET
                name = ?, description = ?, endpoint_url = ?, http_method = ?,
                headers = ?, body_template = ?, body_content_type = ?, field_mapping = ?,
                payload_fields = ?, query_params = ?, variables = ?, source_config = ?,
                success_check = ?,
                timeout_ms = ?, retry_count = ?, enabled = ?, updated_at = ?
             WHERE id = ?`,
            [
                next.name, next.description, next.endpoint_url, next.http_method,
                next.headers, next.body_template, next.body_content_type, next.field_mapping,
                next.payload_fields, next.query_params, next.variables, next.source_config,
                next.success_check,
                next.timeout_ms, next.retry_count, next.enabled, next.updated_at, id,
            ]
        );

        return this.getById(db, id);
    }

    static async delete(db: Database, id: string): Promise<void> {
        await db.execute(`DELETE FROM push_targets WHERE id = ?`, [id]);
    }
}