import type { Ticket } from '$lib/components/app/types';

// ── Push Target ───────────────────────────────────────────────────────────────

export interface PushTarget {
    id: string;
    name: string;
    description: string;
    endpoint_url: string;
    http_method: string;
    /** JSON object of static request headers (values may contain {{variable_key}}) */
    headers: string;
    /** @deprecated Legacy raw JSON body template — superseded by payload_fields */
    body_template: string;
    body_content_type: string;
    /** @deprecated Legacy field mapping — superseded by payload_fields */
    field_mapping: string;
    /** JSON array of FieldBinding — the authoritative payload definition */
    payload_fields: string;
    /** JSON array of FieldBinding — appended to the URL as query parameters */
    query_params: string;
    /** JSON array of PushVariableDef — values collected at push time */
    variables: string;
    /** JSON PushSourceConfig — which sources / catalog fields are offered in the editor */
    source_config: string;
    /**
     * JSON PushSuccessCheck — how the target's response is judged.
     * Empty string means "any 2xx counts" (the legacy behaviour).
     */
    success_check: string;
    timeout_ms: number;
    retry_count: number;
    enabled: number;
    last_push_at: string | null;
    created_at: string;
    updated_at: string;
}

export type CreatePushTargetInput = Pick<PushTarget, 'name' | 'endpoint_url'> &
    Partial<
        Pick<
            PushTarget,
            | 'description'
            | 'http_method'
            | 'headers'
            | 'body_template'
            | 'body_content_type'
            | 'field_mapping'
            | 'payload_fields'
            | 'query_params'
            | 'variables'
            | 'source_config'
            | 'success_check'
            | 'timeout_ms'
            | 'retry_count'
            | 'enabled'
        >
    >;

export type UpdatePushTargetInput = Partial<
    Pick<
        PushTarget,
        | 'name'
        | 'description'
        | 'endpoint_url'
        | 'http_method'
        | 'headers'
        | 'body_template'
        | 'body_content_type'
        | 'field_mapping'
        | 'payload_fields'
        | 'query_params'
        | 'variables'
        | 'source_config'
        | 'success_check'
        | 'timeout_ms'
        | 'retry_count'
        | 'enabled'
    >
>;

// ── Editor scope configuration ────────────────────────────────────────────────
//
// The editor can be narrowed down so that only the sources and fields that a
// given target actually needs are offered. This keeps the "add field" pickers
// short instead of dumping the whole catalog on the user.

export interface PushSourceConfig {
    /** FieldSourceKind values offered in the "来源" picker */
    enabled_sources: FieldSourceKind[];
    /** CatalogGroup -> list of enabled catalog keys, e.g. { ticket: ['ticket.title'] } */
    enabled_fields: Record<string, string[]>;
    /** Variable keys offered in the "变量" picker */
    enabled_variables: string[];
}

// ── Field Source Abstraction ──────────────────────────────────────────────────
//
// Every entry in a target's payload is described by a FieldBinding:
//   "which target JSON path"  ←  "which source"
//
// Sources (kind):
//   ticket   — a field of the Worklog ticket (abstracted by field-catalog.ts)
//   board    — a field of the parent board
//   app      — an application/workspace level value
//   constant — a literal fixed value (constants)
//   variable — resolved at push time (manual input or dropdown choice)
//   mapped   — a ticket field run through an enum translation table

export type FieldSourceKind =
    | 'ticket'
    | 'board'
    | 'app'
    | 'constant'
    | 'variable'
    | 'mapped';

/**
 * Literal types a constant may take. Names are shown verbatim in the editor
 * and mirror what a JSON POST body can carry.
 */
export type ConstantValueType =
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'null'
    | 'object'
    | 'array'
    | 'date'
    | 'datetime'
    | 'time'
    | 'template'
    /** @deprecated alias of 'object', kept for previously saved targets */
    | 'json';

export interface FieldBinding {
    /** Stable row id, used for UI list keying */
    id: string;
    /** Target JSON path in dot notation, e.g. "fields.summary" */
    path: string;
    /** Where the value comes from */
    kind: FieldSourceKind;
    /** Catalog key for ticket/board/app/mapped sources, e.g. "ticket.title" */
    field?: string;
    /** Literal value for kind === 'constant' */
    value?: string;
    /** Coercion applied to the literal for kind === 'constant' */
    value_type?: ConstantValueType;
    /** Variable key for kind === 'variable' */
    variable_key?: string;
    /** Enum translation table for kind === 'mapped' */
    value_mapping?: Record<string, string>;
}

// ── Push Variables ────────────────────────────────────────────────────────────

export type PushVariableType =
    | 'text'
    | 'textarea'
    | 'number'
    | 'select'
    | 'multiselect'
    | 'boolean'
    | 'date';

export interface PushVariableOption {
    label: string;
    value: string;
}

export interface PushVariableDef {
    /** Machine key, referenced by FieldBinding.variable_key */
    key: string;
    /** Human label shown in the push dialog */
    label: string;
    type: PushVariableType;
    required: boolean;
    default_value?: string;
    /** Choices for select / multiselect */
    options?: PushVariableOption[];
    placeholder?: string;
    help_text?: string;
}

export type PushVariableValue = string | string[] | boolean | number | null;
export type PushVariableValues = Record<string, PushVariableValue>;

// ── Push Context ──────────────────────────────────────────────────────────────

export interface PushContext {
    ticket: Ticket;
    board?: { id: string; name: string; description?: string } | null;
    app?: {
        author_name?: string;
        workspace_name?: string;
        version?: string;
    };
}

// ── Push Preview ──────────────────────────────────────────────────────────────

export interface PushPreview {
    url: string;
    method: string;
    headers: Record<string, string>;
    /** Pretty-printed JSON body that will be sent */
    body: string;
    /** Keys of required variables that have not been filled yet */
    missingVariables: string[];
    /** Non-fatal issues worth surfacing in the UI */
    warnings: string[];
}

// ── Push Records ──────────────────────────────────────────────────────────────

export type PushRecordStatus = 'pending' | 'success' | 'failed';

export interface PushRecord {
    id: string;
    ticket_id: string;
    board_id: string;
    target_id: string;
    status: PushRecordStatus;
    request_url: string;
    request_body: string | null;
    /** JSON snapshot of variable values used for this push */
    variables_snapshot?: string | null;
    response_status: number | null;
    response_body: string | null;
    error_message: string | null;
    duration_ms: number | null;
    created_at: string;
    updated_at: string;
}

export type CreatePushRecordInput = Pick<
    PushRecord,
    'ticket_id' | 'board_id' | 'target_id' | 'request_url'
> &
    Partial<
        Pick<
            PushRecord,
            | 'request_body'
            | 'variables_snapshot'
            | 'response_status'
            | 'response_body'
            | 'error_message'
            | 'duration_ms'
        >
    >;

// ── Push Info (mirrored onto the ticket card) ─────────────────────────────────

export interface PushInfo {
    target_id: string;
    target_name: string;
    status: PushRecordStatus;
    pushed_at: string;
    record_id: string;
}

// ── Legacy mapping types (used by pre-payload_fields targets) ─────────────────

export interface FieldValueMapping {
    target: string;
    value_mapping?: Record<string, string>;
}

export type FieldMapping = Record<string, string | FieldValueMapping>;

// ── Push Result ───────────────────────────────────────────────────────────────

export interface PushResult {
    success: boolean;
    record: PushRecord;
    message: string;
}
