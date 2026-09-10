import type Database from '@tauri-apps/plugin-sql';
import type { Ticket } from '$lib/components/app/types';
import type {
    PushTarget,
    PushRecord,
    PushInfo,
    PushResult,
    PushContext,
    PushVariableValues,
    PushPreview,
    FieldBinding,
    PushVariableDef,
    FieldMapping,
    FieldValueMapping,
} from './types';
import { PushRecordRepo } from './push-record.repo';
import {
    resolveCatalogValue,
    coerceConstant,
    coerceVariableValue,
    isVariableEmpty,
    parseBindings,
    parseVariables,
} from './field-catalog';

/**
 * PushEngine — core engine for remote push functionality.
 *
 * Payload construction (in priority order):
 *  1. payload_fields  — structured FieldBinding list (the modern path)
 *  2. body_template   — legacy raw JSON template with {{placeholders}}
 *  3. field_mapping   — legacy rename/mapping map
 *  4. bare ticket     — no configuration at all
 */
export class PushEngine {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    // ── URL / query parameters ───────────────────────────────────────────────

    /**
     * Resolve the configured query parameters into a key/value list.
     * Pure — safe for previews.
     */
    buildQueryParams(
        target: PushTarget,
        ctx: PushContext,
        variableValues: PushVariableValues = {},
    ): [string, string][] {
        const bindings = parseBindings(target.query_params);
        if (bindings.length === 0) return [];

        const varDefs = parseVariables(target.variables);
        const pairs: [string, string][] = [];

        for (const binding of bindings) {
            if (!binding.path) continue;
            const value = this.resolveBinding(
                binding,
                ctx,
                variableValues,
                varDefs,
            );
            if (value === undefined || value === null) continue;
            pairs.push([
                binding.path,
                typeof value === 'object' ? JSON.stringify(value) : String(value),
            ]);
        }

        return pairs;
    }

    /** Final request URL, with query parameters appended and encoded. */
    buildUrl(
        target: PushTarget,
        ctx: PushContext,
        variableValues: PushVariableValues = {},
    ): string {
        const base = this.interpolateVariables(
            target.endpoint_url,
            variableValues,
        );
        const pairs = this.buildQueryParams(target, ctx, variableValues);
        if (pairs.length === 0) return base;

        const qs = pairs
            .map(
                ([k, v]) =>
                    `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
            )
            .join('&');

        if (!base.includes('?')) return `${base}?${qs}`;
        if (base.endsWith('?') || base.endsWith('&')) return `${base}${qs}`;
        return `${base}&${qs}`;
    }

    // ── Headers ──────────────────────────────────────────────────────────────

    /**
     * Expand {{variable_key}} placeholders inside a string using the values
     * collected for this push. Unknown keys are left untouched.
     */
    interpolateVariables(
        text: string,
        variableValues: PushVariableValues = {},
    ): string {
        if (!text || !text.includes('{{')) return text;
        return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, key) => {
            if (!(key in variableValues)) return match;
            const value = variableValues[key];
            if (value === undefined || value === null) return match;
            if (Array.isArray(value)) return value.join(',');
            return String(value);
        });
    }

    /** Request headers with variable placeholders expanded. */
    buildHeaders(
        target: PushTarget,
        variableValues: PushVariableValues = {},
    ): Record<string, string> {
        const raw = this.parseHeaders(target.headers);
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(raw)) {
            out[key] = this.interpolateVariables(String(value), variableValues);
        }
        return out;
    }

    /** Keys referenced as {{...}} in the URL or any header value. */
    collectHeaderVariables(target: PushTarget): string[] {
        const found = new Set<string>();
        const scan = (text: string) => {
            const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) found.add(m[1]);
        };
        scan(target.endpoint_url ?? '');
        const raw = this.parseHeaders(target.headers);
        for (const value of Object.values(raw)) scan(String(value));
        return [...found];
    }

    // ── Payload construction ─────────────────────────────────────────────────

    /**
     * Build the outbound JSON payload for a target.
     * Pure — performs no I/O, safe to call for live previews.
     */
    buildPayload(
        target: PushTarget,
        ctx: PushContext,
        variableValues: PushVariableValues = {},
    ): Record<string, unknown> {
        const bindings = parseBindings(target.payload_fields);

        if (bindings.length > 0) {
            return this.buildFromBindings(bindings, target, ctx, variableValues);
        }

        return this.buildFromLegacy(target, ctx);
    }

    private buildFromBindings(
        bindings: FieldBinding[],
        target: PushTarget,
        ctx: PushContext,
        variableValues: PushVariableValues,
    ): Record<string, unknown> {
        const varDefs = parseVariables(target.variables);
        const payload: Record<string, unknown> = {};

        for (const binding of bindings) {
            if (!binding.path) continue;
            const value = this.resolveBinding(binding, ctx, variableValues, varDefs);
            if (value === undefined) continue;
            this.setNestedValue(payload, binding.path, value);
        }

        return payload;
    }

    /** Resolve a single binding to its runtime value. */
    private resolveBinding(
        binding: FieldBinding,
        ctx: PushContext,
        variableValues: PushVariableValues,
        varDefs: PushVariableDef[],
    ): unknown {
        switch (binding.kind) {
            case 'ticket':
            case 'board':
            case 'app':
                return resolveCatalogValue(binding.field ?? '', ctx);

            case 'mapped': {
                const raw = resolveCatalogValue(binding.field ?? '', ctx);
                if (raw === undefined || raw === null) return raw;
                const key = String(raw);
                return binding.value_mapping?.[key] ?? raw;
            }

            case 'constant':
                return coerceConstant(binding.value, binding.value_type);

            case 'variable': {
                const key = binding.variable_key;
                if (!key) return undefined;
                const def = varDefs.find((d) => d.key === key);
                return coerceVariableValue(variableValues[key], def);
            }

            default:
                return undefined;
        }
    }

    /** Legacy: body_template + field_mapping. */
    private buildFromLegacy(
        target: PushTarget,
        ctx: PushContext,
    ): Record<string, unknown> {
        const ticket = ctx.ticket;
        const mapped = this.applyFieldMapping(ticket, target.field_mapping);

        if (!target.body_template) {
            return mapped;
        }

        const rendered = this.renderTemplate(target.body_template, {
            ...mapped,
            ...Object.fromEntries(
                // Expose every catalog field directly by its short name so that
                // legacy templates keep working with {{title}}, {{status}}, …
                Object.keys(mapped).map((k) => [k, mapped[k]]),
            ),
        });

        try {
            return JSON.parse(rendered);
        } catch {
            return { raw: rendered };
        }
    }

    // ── Preview ──────────────────────────────────────────────────────────────

    /**
     * Produce the request that would be sent, without sending it.
     * Used by the push dialog for live preview and validation.
     */
    buildPreview(
        target: PushTarget,
        ctx: PushContext,
        variableValues: PushVariableValues = {},
    ): PushPreview {
        const payload = this.buildPayload(target, ctx, variableValues);
        const headers = this.buildHeaders(target, variableValues);
        const url = this.buildUrl(target, ctx, variableValues);
        const warnings: string[] = [];

        const bindings = parseBindings(target.payload_fields);
        if (bindings.length === 0 && !target.body_template) {
            warnings.push('no_payload_config');
        }

        // A binding that points at an unknown catalog key yields no value.
        const varDefs = parseVariables(target.variables);
        const knownVarKeys = new Set(varDefs.map((d) => d.key));

        const allBindings = [
            ...bindings,
            ...parseBindings(target.query_params),
        ];
        for (const b of allBindings) {
            if (b.kind === 'variable' && b.variable_key && !knownVarKeys.has(b.variable_key)) {
                warnings.push(`unknown_variable:${b.variable_key}`);
            }
        }

        // Headers / URL referencing an undefined variable would leak the
        // literal {{name}} into the request.
        for (const key of this.collectHeaderVariables(target)) {
            if (!knownVarKeys.has(key)) warnings.push(`unknown_variable:${key}`);
        }

        return {
            url,
            method: target.http_method || 'POST',
            headers,
            body: JSON.stringify(payload, null, 2),
            missingVariables: this.findMissingVariables(target, variableValues),
            warnings: [...new Set(warnings)],
        };
    }

    /** Keys of required variables that are still empty. */
    findMissingVariables(
        target: PushTarget,
        variableValues: PushVariableValues,
    ): string[] {
        return parseVariables(target.variables)
            .filter((def) => def.required && isVariableEmpty(variableValues[def.key]))
            .map((def) => def.key);
    }

    // ── Execute ──────────────────────────────────────────────────────────────

    /**
     * Push a ticket to a configured target.
     * `ctx` supplies the ticket plus board/app context used by field bindings.
     */
    async push(
        ctx: PushContext,
        target: PushTarget,
        variableValues: PushVariableValues = {},
    ): Promise<PushResult> {
        const ticket = ctx.ticket;
        const startTime = performance.now();
        const requestUrl = target.endpoint_url;

        // Refuse to send while required variables are unfilled.
        const missing = this.findMissingVariables(target, variableValues);
        if (missing.length > 0) {
            return this.recordFailure(
                ticket.id,
                ticket.board_id,
                target,
                requestUrl,
                `Missing required variables: ${missing.join(', ')}`,
                Math.round(performance.now() - startTime),
                null,
                variableValues,
            );
        }

        let requestBody: string | null = null;

        try {
            const payload = this.buildPayload(target, ctx, variableValues);
            requestBody = JSON.stringify(payload);
            const headers = this.buildHeaders(target, variableValues);
            const finalUrl = this.buildUrl(target, ctx, variableValues);

            const { status, body, error } = await this.sendRequest(
                finalUrl,
                target.http_method || 'POST',
                headers,
                requestBody,
                target.timeout_ms || 30000,
            );

            const durationMs = Math.round(performance.now() - startTime);
            const isSuccess = status !== null && status >= 200 && status < 300;

            const record = await PushRecordRepo.create(this.db, {
                ticket_id: ticket.id,
                board_id: ticket.board_id,
                target_id: target.id,
                request_url: finalUrl,
                request_body: requestBody,
                variables_snapshot: JSON.stringify(variableValues),
                response_status: status,
                response_body: body,
                error_message: error ?? null,
                duration_ms: durationMs,
            });

            if (isSuccess) {
                await PushRecordRepo.updateStatus(this.db, record.id, 'success', {
                    response_status: status,
                    response_body: body,
                    duration_ms: durationMs,
                });
                record.status = 'success';
                record.response_status = status;
                record.response_body = body;
            } else {
                await PushRecordRepo.updateStatus(this.db, record.id, 'failed', {
                    response_status: status,
                    response_body: body,
                    error_message: error ?? `HTTP ${status}`,
                    duration_ms: durationMs,
                });
                record.status = 'failed';
                record.error_message = error ?? `HTTP ${status}`;
            }

            await this.updateTicketPushInfo(ticket.id, {
                target_id: target.id,
                target_name: target.name,
                status: isSuccess ? 'success' : 'failed',
                pushed_at: new Date().toISOString(),
                record_id: record.id,
            });

            await this.db.execute(
                `UPDATE push_targets SET last_push_at = ? WHERE id = ?`,
                [new Date().toISOString(), target.id],
            );

            return {
                success: isSuccess,
                record: record as PushRecord,
                message: isSuccess
                    ? `Push successful (HTTP ${status})`
                    : `Push failed: ${error ?? `HTTP ${status}`}`,
            };
        } catch (err) {
            const durationMs = Math.round(performance.now() - startTime);
            const errorMessage = err instanceof Error ? err.message : String(err);
            return this.recordFailure(
                ticket.id,
                ticket.board_id,
                target,
                requestUrl,
                errorMessage,
                durationMs,
                requestBody,
                variableValues,
            );
        }
    }

    private async recordFailure(
        ticketId: string,
        boardId: string,
        target: PushTarget,
        requestUrl: string,
        errorMessage: string,
        durationMs: number,
        requestBody: string | null,
        variableValues: PushVariableValues,
    ): Promise<PushResult> {
        const record = await PushRecordRepo.create(this.db, {
            ticket_id: ticketId,
            board_id: boardId,
            target_id: target.id,
            request_url: requestUrl,
            request_body: requestBody,
            variables_snapshot: JSON.stringify(variableValues),
            error_message: errorMessage,
            duration_ms: durationMs,
        });

        await PushRecordRepo.updateStatus(this.db, record.id, 'failed', {
            error_message: errorMessage,
            duration_ms: durationMs,
        });

        record.status = 'failed';
        record.error_message = errorMessage;

        return {
            success: false,
            record: record as PushRecord,
            message: `Push failed: ${errorMessage}`,
        };
    }

    // ── Legacy helpers (kept for backwards-compatible targets) ───────────────

    applyFieldMapping(
        ticket: Ticket | Record<string, unknown>,
        fieldMappingJson: string,
    ): Record<string, unknown> {
        const source = ticket as unknown as Record<string, unknown>;
        if (!fieldMappingJson || fieldMappingJson === '{}') {
            return { ...source };
        }

        let mapping: FieldMapping;
        try {
            mapping = JSON.parse(fieldMappingJson);
        } catch {
            return { ...source };
        }

        const result: Record<string, unknown> = {};

        for (const [localField, mappingRule] of Object.entries(mapping)) {
            const localValue = source[localField];
            let targetKey: string;
            let mappedValue: unknown;

            if (typeof mappingRule === 'string') {
                targetKey = mappingRule;
                mappedValue = localValue;
            } else if (
                typeof mappingRule === 'object' &&
                mappingRule !== null &&
                'target' in mappingRule
            ) {
                const rule = mappingRule as FieldValueMapping;
                targetKey = rule.target;
                if (
                    rule.value_mapping &&
                    typeof localValue === 'string' &&
                    rule.value_mapping[localValue]
                ) {
                    mappedValue = rule.value_mapping[localValue];
                } else {
                    mappedValue = localValue;
                }
            } else {
                continue;
            }

            this.setNestedValue(result, targetKey, mappedValue);
        }

        return result;
    }

    renderTemplate(template: string, context: Record<string, unknown>): string {
        if (!template) return JSON.stringify(context);
        return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
            const value = this.getNestedValue(context, path);
            if (value === null || value === undefined) return match;
            if (typeof value === 'object') return JSON.stringify(value);
            return String(value);
        });
    }

    // ── HTTP ─────────────────────────────────────────────────────────────────

    parseHeaders(headersJson: string): Record<string, string> {
        if (!headersJson || headersJson === '{}') {
            return { 'Content-Type': 'application/json' };
        }
        try {
            const parsed = JSON.parse(headersJson);
            if (!parsed['Content-Type']) {
                parsed['Content-Type'] = 'application/json';
            }
            return parsed;
        } catch {
            return { 'Content-Type': 'application/json' };
        }
    }

    private async sendRequest(
        url: string,
        method: string,
        headers: Record<string, string>,
        body: string | null,
        timeoutMs: number,
    ): Promise<{ status: number | null; body: string | null; error: string | null }> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            const response = await fetch(url, {
                method,
                headers,
                body: body ?? undefined,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            const responseBody = await response.text();

            return {
                status: response.status,
                body: responseBody,
                error: response.ok ? null : response.statusText,
            };
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            return { status: null, body: null, error: errorMessage };
        }
    }

    // ── Ticket push_info mirror ──────────────────────────────────────────────

    private async updateTicketPushInfo(
        ticketId: string,
        pushInfo: PushInfo,
    ): Promise<void> {
        const rows = await this.db.select<{ push_info: string }[]>(
            `SELECT push_info FROM tickets WHERE id = ?`,
            [ticketId],
        );
        if (!rows[0]) return;

        let existing: PushInfo[] = [];
        try {
            existing = JSON.parse(rows[0].push_info || '[]');
            if (!Array.isArray(existing)) existing = [];
        } catch {
            existing = [];
        }

        const filtered = existing.filter((pi) => pi.target_id !== pushInfo.target_id);
        filtered.push(pushInfo);

        await this.db.execute(
            `UPDATE tickets SET push_info = ? WHERE id = ?`,
            [JSON.stringify(filtered), ticketId],
        );
    }

    static async getTicketPushInfo(
        db: Database,
        ticketId: string,
    ): Promise<PushInfo[]> {
        const rows = await db.select<{ push_info: string }[]>(
            `SELECT push_info FROM tickets WHERE id = ?`,
            [ticketId],
        );
        if (!rows[0]) return [];
        try {
            const parsed = JSON.parse(rows[0].push_info || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    setNestedValue(
        obj: Record<string, unknown>,
        path: string,
        value: unknown,
    ): void {
        const keys = path.split('.').filter(Boolean);
        if (keys.length === 0) return;
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            const next = current[key];
            if (typeof next !== 'object' || next === null || Array.isArray(next)) {
                current[key] = {};
            }
            current = current[key] as Record<string, unknown>;
        }
        current[keys[keys.length - 1]] = value;
    }

    getNestedValue(obj: Record<string, unknown>, path: string): unknown {
        const keys = path.split('.');
        let current: unknown = obj;
        for (const key of keys) {
            if (current === null || current === undefined) return undefined;
            if (typeof current !== 'object') return undefined;
            current = (current as Record<string, unknown>)[key];
        }
        return current;
    }
}
