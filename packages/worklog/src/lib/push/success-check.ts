// ─────────────────────────────────────────────────────────────────────────────
// Success criterion for a remote push.
//
// An HTTP 2xx only proves the gateway accepted the call. Flow / ticket systems
// routinely answer 200 with a body that rejects the submission:
//
//   {"__sys__":{"status":-1,"msg":"工单提交失败，请联系管理员！"}}
//
// Without a rule that push is recorded as a success, the ticket badge turns
// green and nobody notices that nothing was ever created. A target can
// therefore declare where the real verdict lives — a JSON path plus the value
// it has to hold.
// ─────────────────────────────────────────────────────────────────────────────

export type PushSuccessMode = 'http' | 'json';

export type PushSuccessOp = 'eq' | 'ne' | 'in' | 'exists' | 'truthy' | 'regex';

/** What to do when the rule cannot be evaluated (missing path / non-JSON body). */
export type PushSuccessFallback = 'fail' | 'http';

export interface PushSuccessCheck {
    /** `http`: any 2xx counts (default, legacy). `json`: the path below decides. */
    mode: PushSuccessMode;
    /** Response JSON path, e.g. `__sys__.status` or `data.tickets[0].id`. */
    path: string;
    op: PushSuccessOp;
    /** Expected value. `in` takes a comma separated list, `regex` a pattern. */
    value: string;
    /** Where to read the human readable message when the push fails. */
    message_path: string;
    /** Path absent → fail (default) or fall back to the HTTP status. */
    when_missing: PushSuccessFallback;
    /** Body not JSON → fail (default) or fall back to the HTTP status. */
    when_not_json: PushSuccessFallback;
}

export const DEFAULT_SUCCESS_CHECK: PushSuccessCheck = {
    mode: 'http',
    path: '',
    op: 'eq',
    value: '',
    message_path: '',
    when_missing: 'fail',
    when_not_json: 'fail',
};

const MODES: PushSuccessMode[] = ['http', 'json'];
const OPS: PushSuccessOp[] = ['eq', 'ne', 'in', 'exists', 'truthy', 'regex'];
const FALLBACKS: PushSuccessFallback[] = ['fail', 'http'];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
    return typeof value === 'string' && (allowed as string[]).includes(value)
        ? (value as T)
        : fallback;
}

function asText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** Normalise whatever is stored in the `success_check` column. */
export function parseSuccessCheck(raw: string | null | undefined): PushSuccessCheck {
    if (!raw || !raw.trim()) return { ...DEFAULT_SUCCESS_CHECK };

    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ...DEFAULT_SUCCESS_CHECK };
        }
        return {
            mode: pick(parsed.mode, MODES, 'http'),
            path: asText(parsed.path).trim(),
            op: pick(parsed.op, OPS, 'eq'),
            value: asText(parsed.value),
            message_path: asText(parsed.message_path).trim(),
            when_missing: pick(parsed.when_missing, FALLBACKS, 'fail'),
            when_not_json: pick(parsed.when_not_json, FALLBACKS, 'fail'),
        };
    } catch {
        return { ...DEFAULT_SUCCESS_CHECK };
    }
}

/**
 * Serialise for storage. A plain HTTP criterion is stored as an empty string, so
 * targets without a rule keep the column clean and exports stay tidy.
 */
export function serializeSuccessCheck(check: PushSuccessCheck): string {
    if (check.mode !== 'json' || !check.path.trim()) return '';

    return JSON.stringify({
        mode: 'json',
        path: check.path.trim(),
        op: check.op,
        value: check.value,
        message_path: check.message_path.trim(),
        when_missing: check.when_missing,
        when_not_json: check.when_not_json,
    });
}

/** Whether a stored value actually configures a rule. */
export function hasSuccessCheck(raw: string | null | undefined): boolean {
    return serializeSuccessCheck(parseSuccessCheck(raw)) !== '';
}

function describeOp(check: PushSuccessCheck): string {
    switch (check.op) {
        case 'eq':
            return `= ${check.value.trim() || '(空)'}`;
        case 'ne':
            return `≠ ${check.value.trim() || '(空)'}`;
        case 'in':
            return `∈ [${check.value.trim()}]`;
        case 'exists':
            return '存在';
        case 'truthy':
            return '为真';
        case 'regex':
            return `匹配 /${check.value}/`;
    }
}

/** One line description of a rule, for the settings UI and the push dialog. */
export function summarizeSuccessCheck(check: PushSuccessCheck): string {
    if (check.mode !== 'json' || !check.path.trim()) {
        return 'HTTP 2xx 即视为受理成功';
    }
    return `${check.path} ${describeOp(check)}`;
}

// ── Path lookup ──────────────────────────────────────────────────────────────

export interface PathLookup {
    found: boolean;
    value: unknown;
}

const PATH_TOKEN = /\[(\d+)\]|([^.[\]]+)/g;

/**
 * Read a dot / bracket path out of a parsed response.
 * `__sys__.status`, `$.data.list[0].code` and `items[2]` are all supported.
 */
export function getByPath(root: unknown, path: string): PathLookup {
    const missing: PathLookup = { found: false, value: undefined };
    const clean = path.trim().replace(/^\$\.?/, '');
    if (!clean) return missing;

    const tokens: string[] = [];
    for (const match of clean.matchAll(PATH_TOKEN)) {
        tokens.push(match[1] ?? match[2]);
    }
    if (tokens.length === 0) return missing;

    let current: unknown = root;

    for (const token of tokens) {
        if (current === null || current === undefined) return missing;

        if (Array.isArray(current)) {
            const index = Number(token);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) {
                return missing;
            }
            current = current[index];
            continue;
        }

        if (typeof current !== 'object') return missing;

        const record = current as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(record, token)) return missing;
        current = record[token];
    }

    return { found: true, value: current };
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export interface SuccessEvaluation {
    ok: boolean;
    /** Why this verdict was reached — shown to the user, stored on failure. */
    reason: string;
    /** `path = value` evidence, when a rule was applied. */
    evidence: string | null;
}

/** Readable form of a JSON value, for evidence and error messages. */
function display(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    try {
        const json = JSON.stringify(value);
        return json ?? String(value);
    } catch {
        return String(value);
    }
}

/**
 * Comparison form: strings lose their quotes so a body holding `0` or `"0"`
 * both satisfy `eq 0` — which is what a hand written rule means.
 */
function compareKey(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return display(value);
    return String(value);
}

function isTruthy(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        return text !== '' && text !== '0' && text !== 'false' && text !== 'null';
    }
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

function matches(check: PushSuccessCheck, actual: unknown): boolean {
    const expected = check.value.trim();
    const key = compareKey(actual);

    switch (check.op) {
        case 'exists':
            return true;
        case 'truthy':
            return isTruthy(actual);
        case 'eq':
            return key === expected;
        case 'ne':
            return key !== expected;
        case 'in':
            return expected
                .split(',')
                .map((part) => part.trim())
                .filter((part) => part !== '')
                .includes(key);
        case 'regex':
            return new RegExp(check.value).test(key);
    }
}

/**
 * Decide whether a push was accepted.
 *
 * Order, hardest criterion first:
 *   1. no response at all                       → failure
 *   2. non-2xx status                           → failure
 *   3. no rule configured                       → 2xx is success (legacy)
 *   4. rule configured                          → 2xx **and** path matches
 *      - path missing / body not JSON           → `when_missing` / `when_not_json`
 */
export function evaluateSuccess(
    check: PushSuccessCheck,
    httpStatus: number | null,
    body: string | null | undefined,
): SuccessEvaluation {
    if (httpStatus === null) {
        return { ok: false, reason: '没有收到响应（请求未完成）', evidence: null };
    }

    if (httpStatus < 200 || httpStatus >= 300) {
        return { ok: false, reason: `HTTP ${httpStatus}`, evidence: null };
    }

    if (check.mode !== 'json' || !check.path.trim()) {
        return { ok: true, reason: `HTTP ${httpStatus}`, evidence: null };
    }

    const text = (body ?? '').trim();
    if (text === '') {
        return check.when_not_json === 'http'
            ? {
                  ok: true,
                  reason: `HTTP ${httpStatus}（响应体为空，按 HTTP 状态判定）`,
                  evidence: null,
              }
            : {
                  ok: false,
                  reason: `HTTP ${httpStatus}，但响应体为空，无法判定 ${check.path}`,
                  evidence: null,
              };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return check.when_not_json === 'http'
            ? {
                  ok: true,
                  reason: `HTTP ${httpStatus}（响应不是 JSON，按 HTTP 状态判定）`,
                  evidence: null,
              }
            : {
                  ok: false,
                  reason: `HTTP ${httpStatus}，但响应不是 JSON，无法判定 ${check.path}`,
                  evidence: null,
              };
    }

    const lookup = getByPath(parsed, check.path);
    if (!lookup.found) {
        return check.when_missing === 'http'
            ? {
                  ok: true,
                  reason: `HTTP ${httpStatus}（响应中不存在 ${check.path}，按 HTTP 状态判定）`,
                  evidence: null,
              }
            : {
                  ok: false,
                  reason: `HTTP ${httpStatus}，但响应中不存在路径 ${check.path}`,
                  evidence: null,
              };
    }

    const evidence = `${check.path} = ${display(lookup.value)}`;

    let matched: boolean;
    try {
        matched = matches(check, lookup.value);
    } catch (e) {
        return {
            ok: false,
            reason: `判定规则无法执行：${e instanceof Error ? e.message : String(e)}`,
            evidence,
        };
    }

    return matched
        ? { ok: true, reason: `${evidence} 满足 ${describeOp(check)}`, evidence }
        : { ok: false, reason: `${evidence} 不满足 ${describeOp(check)}`, evidence };
}

/**
 * Read the target's own message from the configured path.
 * Returns null when unset / absent / empty, so the caller can fall back to
 * `extractResponseMessage`.
 */
export function readMessageAt(
    body: string | null | undefined,
    path: string,
): string | null {
    if (!path.trim() || !body) return null;

    try {
        const lookup = getByPath(JSON.parse(body), path);
        if (!lookup.found || lookup.value === null || lookup.value === undefined) {
            return null;
        }
        const text =
            typeof lookup.value === 'string'
                ? lookup.value
                : display(lookup.value);
        const trimmed = text.trim();
        return trimmed === '' ? null : trimmed;
    } catch {
        return null;
    }
}
