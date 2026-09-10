<script lang="ts">
    import { Add, TrashCan } from "carbon-icons-svelte";
    import type { PushVariableDef } from "$lib/push/types";

    interface Props {
        /** JSON object string, e.g. {"Content-Type":"application/json"} */
        headers: string;
        variables: PushVariableDef[];
    }

    let { headers = $bindable(), variables }: Props = $props();

    interface HeaderRow {
        id: string;
        key: string;
        value: string;
    }

    function uid(): string {
        return `h-${Math.random().toString(36).slice(2, 10)}`;
    }

    function parseRows(raw: string): HeaderRow[] {
        try {
            const obj = JSON.parse(raw || "{}");
            if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
            return Object.entries(obj).map(([k, v]) => ({
                id: uid(),
                key: k,
                value: typeof v === "string" ? v : JSON.stringify(v),
            }));
        } catch {
            return [];
        }
    }

    function serialize(rows: HeaderRow[]): string {
        const obj: Record<string, string> = {};
        for (const row of rows) {
            const key = row.key.trim();
            if (!key) continue;
            obj[key] = row.value;
        }
        return JSON.stringify(obj, null, 2);
    }

    let rows = $state<HeaderRow[]>([]);
    let initialized = $state(false);

    // Initialise once from the incoming value; afterwards the rows own the state.
    $effect(() => {
        if (initialized) return;
        const parsed = parseRows(headers);
        rows =
            parsed.length > 0
                ? parsed
                : [{ id: uid(), key: "Content-Type", value: "application/json" }];
        initialized = true;
    });

    // Push changes back out whenever the rows change.
    $effect(() => {
        if (!initialized) return;
        const next = serialize(rows);
        if (next !== headers) headers = next;
    });

    function addRow() {
        rows = [...rows, { id: uid(), key: "", value: "" }];
    }

    function removeRow(id: string) {
        rows = rows.filter((r) => r.id !== id);
    }

    function updateRow(id: string, patch: Partial<HeaderRow>) {
        rows = rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    }

    /** Insert {{key}} at the end of a value — used by the variable chips. */
    function appendVariable(id: string, key: string) {
        const row = rows.find((r) => r.id === id);
        if (!row) return;
        updateRow(id, { value: `${row.value}{{${key}}}` });
    }

    const COMMON_HEADERS = [
        "Content-Type",
        "Accept",
        "Authorization",
        "X-Request-Id",
        "User-Agent",
    ];

    // Kept out of the template: Svelte would parse `{{...}}` as an expression.
    const VALUE_PLACEHOLDER = 'Bearer {{api_token}}';
    const TOKEN_HINT = '{{变量Key}}';

    function hasVariableToken(value: string): boolean {
        return /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/.test(value);
    }

    /** Variable keys referenced by the current rows that are not defined. */
    const unknownTokens = $derived.by(() => {
        const known = new Set(variables.map((v) => v.key));
        const missing = new Set<string>();
        for (const row of rows) {
            const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
            let match: RegExpExecArray | null;
            while ((match = re.exec(row.value)) !== null) {
                if (!known.has(match[1])) missing.add(match[1]);
            }
        }
        return [...missing];
    });
</script>

<div class="header-editor">
    <header class="he-header">
        <div>
            <h3>请求头</h3>
            <p class="he-desc">
                随每个请求发送的 HTTP 头。值里可以引用推送变量，写成
                <code>{TOKEN_HINT}</code>，推送时会替换为实际填写的值。
            </p>
        </div>
        <button type="button" class="add-btn" onclick={addRow}>
            <Add size={14} />
            添加请求头
        </button>
    </header>

    {#if rows.length === 0}
        <div class="he-empty">
            <p>还没有配置请求头。</p>
            <span>点击「添加请求头」开始。</span>
        </div>
    {:else}
        <div class="he-list">
            {#each rows as row (row.id)}
                <div class="he-row">
                    <label class="field field--key">
                        <span class="field-label">名称</span>
                        <input
                            class="field-input mono"
                            type="text"
                            list="common-headers"
                            placeholder="Authorization"
                            value={row.key}
                            oninput={(e) =>
                                updateRow(row.id, {
                                    key: e.currentTarget.value,
                                })}
                        />
                    </label>

                    <label class="field field--value">
                        <span class="field-label">
                            值
                            {#if hasVariableToken(row.value)}
                                <span class="var-mark">含变量</span>
                            {/if}
                        </span>
                        <input
                            class="field-input mono"
                            type="text"
                            placeholder={VALUE_PLACEHOLDER}
                            value={row.value}
                            oninput={(e) =>
                                updateRow(row.id, {
                                    value: e.currentTarget.value,
                                })}
                        />
                    </label>

                    <div class="he-actions">
                        {#if variables.length > 0}
                            <select
                                class="var-picker"
                                title="插入变量"
                                value=""
                                onchange={(e) => {
                                    const key = e.currentTarget.value;
                                    if (key) appendVariable(row.id, key);
                                    e.currentTarget.value = "";
                                }}
                            >
                                <option value="">+ 变量</option>
                                {#each variables as v}
                                    <option value={v.key}>
                                        {v.label || v.key}
                                    </option>
                                {/each}
                            </select>
                        {/if}
                        <button
                            type="button"
                            class="icon-btn icon-btn--danger"
                            title="删除"
                            onclick={() => removeRow(row.id)}
                        >
                            <TrashCan size={14} />
                        </button>
                    </div>
                </div>
            {/each}
        </div>
    {/if}

    {#if unknownTokens.length > 0}
        <p class="he-warn">
            以下变量在请求头中被引用，但尚未定义：
            {unknownTokens.join("、")}
        </p>
    {/if}

    <datalist id="common-headers">
        {#each COMMON_HEADERS as h}
            <option value={h}></option>
        {/each}
    </datalist>
</div>

<style>
    .header-editor {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .he-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
    }

    .he-header h3 {
        margin: 0 0 0.25rem 0;
        font-size: 0.9375rem;
        font-weight: 600;
    }

    .he-desc {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--cds-text-02);
        line-height: 1.5;
        max-width: 62ch;
    }

    .he-desc code {
        font-family: var(--cds-code-01-font-family);
        background: var(--cds-ui-02);
        padding: 0.0625rem 0.25rem;
        border-radius: 2px;
    }

    .add-btn {
        all: unset;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        flex-shrink: 0;
        padding: 0.375rem 0.75rem;
        font-size: 0.8125rem;
        color: var(--cds-text-01);
        border: 1px solid var(--cds-ui-04, #8d8d8d);
        border-radius: 4px;
        cursor: pointer;
    }

    .add-btn:hover {
        background: var(--cds-hover-ui);
    }

    .he-empty {
        padding: 1.5rem;
        text-align: center;
        border: 1px dashed var(--cds-ui-03);
        border-radius: 6px;
        color: var(--cds-text-02);
    }

    .he-empty p {
        margin: 0 0 0.25rem 0;
        font-weight: 500;
    }

    .he-empty span {
        font-size: 0.8125rem;
    }

    .he-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .he-row {
        display: grid;
        grid-template-columns: 1fr 2fr auto;
        gap: 0.5rem;
        align-items: end;
        padding: 0.75rem;
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        background: var(--cds-ui-01);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
    }

    .field-label {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: var(--cds-text-02);
    }

    .var-mark {
        font-weight: 400;
        font-size: 0.625rem;
        padding: 0.0625rem 0.3125rem;
        border-radius: 8px;
        color: var(--cds-support-02);
        background: color-mix(in srgb, var(--cds-support-02) 15%, transparent);
    }

    .field-input {
        width: 100%;
        box-sizing: border-box;
        height: 2rem;
        padding: 0 0.625rem;
        font-size: 0.8125rem;
        font-family: inherit;
        color: var(--cds-text-01);
        background: var(--cds-field-01);
        border: none;
        border-bottom: 1px solid var(--cds-ui-04, #8d8d8d);
        outline: none;
    }

    .field-input:focus {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: -2px;
    }

    .mono {
        font-family: var(--cds-code-01-font-family, "IBM Plex Mono", monospace);
    }

    .he-actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding-bottom: 0.25rem;
    }

    .var-picker {
        height: 1.75rem;
        padding: 0 0.375rem;
        font-size: 0.75rem;
        font-family: inherit;
        color: var(--cds-text-01);
        background: var(--cds-field-01);
        border: none;
        border-bottom: 1px solid var(--cds-ui-04, #8d8d8d);
        outline: none;
        cursor: pointer;
    }

    .icon-btn {
        all: unset;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 2px;
        color: var(--cds-text-02);
        cursor: pointer;
    }

    .icon-btn:hover {
        background: var(--cds-hover-ui);
    }

    .icon-btn--danger:hover {
        color: var(--cds-support-01);
    }

    .he-warn {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--cds-support-03, #f1c21b);
    }

    @media (max-width: 900px) {
        .he-row {
            grid-template-columns: 1fr;
        }
    }
</style>
