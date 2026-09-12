<script lang="ts">
    import { Add, TrashCan } from "carbon-icons-svelte";
    import {
        FIELD_CATALOG,
        availableFieldsForSource,
        groupForSource,
        type CatalogGroup,
    } from "$lib/push/field-catalog";
    import type {
        FieldBinding,
        FieldSourceKind,
        ConstantValueType,
        PushVariableDef,
        PushSourceConfig,
    } from "$lib/push/types";
    import * as m from "$lib/paraglide/messages.js";

    interface Props {
        bindings: FieldBinding[];
        variables: PushVariableDef[];
        /** Which sources / fields the pickers may offer. */
        sourceConfig: PushSourceConfig;
        /** 'body' builds the JSON payload, 'query' builds URL parameters. */
        mode?: "body" | "query";
    }

    let {
        bindings = $bindable(),
        variables,
        sourceConfig,
        mode = "body",
    }: Props = $props();

    const isQuery = $derived(mode === "query");

    // ── Text helpers ─────────────────────────────────────────────────────────
    function msg(key: string, fallback: string): string {
        const fn = (m as unknown as Record<string, () => string>)[key];
        return typeof fn === "function" ? fn() : fallback;
    }

    const GROUP_LABELS: Record<CatalogGroup, string> = {
        ticket: "待办",
        board: "看板",
        app: "应用",
    };

    const SOURCE_LABELS: Record<FieldSourceKind, string> = {
        ticket: "待办字段",
        board: "看板字段",
        app: "应用字段",
        mapped: "待办字段（值映射）",
        constant: "常量",
        variable: "变量（推送时填写）",
    };

    /** Constant literal types — names mirror JSON / HTTP payload types. */
    const CONSTANT_TYPES: { value: ConstantValueType; label: string }[] = [
        { value: "string", label: "string" },
        { value: "number", label: "number" },
        { value: "integer", label: "integer" },
        { value: "boolean", label: "boolean" },
        { value: "null", label: "null" },
        { value: "object", label: "object" },
        { value: "array", label: "array" },
        { value: "date", label: "date (YYYY-MM-DD)" },
        { value: "datetime", label: "datetime (ISO 8601)" },
        { value: "time", label: "time (HH:mm:ss)" },
        { value: "template", label: "template ({{var}})" },
    ];

    // ── Picker options, narrowed by the source config ────────────────────────
    const sourceOptions = $derived(
        (Object.keys(SOURCE_LABELS) as FieldSourceKind[])
            .filter((k) => sourceConfig.enabled_sources.includes(k))
            .map((k) => ({ value: k, label: SOURCE_LABELS[k] })),
    );

    /** Catalog fields allowed for a given source kind (empty if none apply). */
    function fieldsFor(kind: FieldSourceKind) {
        return availableFieldsForSource(kind, sourceConfig).map((f) => ({
            value: f.key,
            label: `${GROUP_LABELS[f.group]} · ${msg(f.label_key, f.label)}`,
        }));
    }

    /** Options to render for a row's field select. */
    function optionsForRow(row: FieldBinding) {
        const opts = fieldsFor(row.kind);
        // Keep a disabled-but-still-referenced field selectable and visible.
        if (row.field && !opts.some((o) => o.value === row.field)) {
            const meta = FIELD_CATALOG.find((f) => f.key === row.field);
            const group = groupForSource(row.kind);
            opts.unshift({
                value: row.field,
                label: `${group ? GROUP_LABELS[group] + " · " : ""}${
                    meta ? msg(meta.label_key, meta.label) : row.field
                }（已关闭）`,
            });
        }
        return opts;
    }

    const variableOptions = $derived(
        variables
            .filter((v) => v.key)
            .filter(
                (v) =>
                    sourceConfig.enabled_variables.length === 0 ||
                    sourceConfig.enabled_variables.includes(v.key),
            )
            .map((v) => ({
                value: v.key,
                label: `${v.label || v.key} (${v.key})`,
            })),
    );

    function uid(): string {
        return `fb-${Math.random().toString(36).slice(2, 10)}`;
    }

    /** True when a row references a source that is switched off. */
    function isKindDisabled(row: FieldBinding): boolean {
        return !sourceConfig.enabled_sources.includes(row.kind);
    }

    // ── Row mutation ─────────────────────────────────────────────────────────
    function defaultKind(): FieldSourceKind {
        return sourceOptions[0]?.value ?? "ticket";
    }

    function defaultFieldFor(kind: FieldSourceKind): string | undefined {
        return fieldsFor(kind)[0]?.value;
    }

    function addRow() {
        const kind = defaultKind();
        bindings = [
            ...bindings,
            {
                id: uid(),
                path: "",
                kind,
                field: defaultFieldFor(kind),
                value_type: "string",
            },
        ];
    }

    function removeRow(id: string) {
        bindings = bindings.filter((b) => b.id !== id);
    }

    function updateRow(id: string, patch: Partial<FieldBinding>) {
        bindings = bindings.map((b) => (b.id === id ? { ...b, ...patch } : b));
    }

    function move(id: string, delta: number) {
        const idx = bindings.findIndex((b) => b.id === id);
        const next = idx + delta;
        if (idx < 0 || next < 0 || next >= bindings.length) return;
        const copy = [...bindings];
        const [row] = copy.splice(idx, 1);
        copy.splice(next, 0, row);
        bindings = copy;
    }

    /** Changing the source resets the value selector to that source's first field. */
    function changeKind(row: FieldBinding, kind: FieldSourceKind) {
        const base: Partial<FieldBinding> = {
            kind,
            field: undefined,
            value: undefined,
            variable_key: undefined,
            value_mapping: undefined,
        };
        switch (kind) {
            case "ticket":
            case "board":
            case "app":
                base.field = defaultFieldFor(kind);
                break;
            case "mapped":
                base.field = defaultFieldFor("mapped");
                base.value_mapping = {};
                break;
            case "constant":
                base.value = "";
                base.value_type = "string";
                break;
            case "variable":
                base.variable_key = variableOptions[0]?.value ?? "";
                break;
        }
        updateRow(row.id, base);
    }

    // ── Value mapping helpers (mapped source) ────────────────────────────────
    function mappingToText(map: Record<string, string> | undefined): string {
        if (!map) return "";
        return Object.entries(map)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n");
    }

    function textToMapping(text: string): Record<string, string> {
        const out: Record<string, string> = {};
        for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const idx = trimmed.indexOf("=");
            if (idx === -1) continue;
            const key = trimmed.slice(0, idx).trim();
            const value = trimmed.slice(idx + 1).trim();
            if (key) out[key] = value;
        }
        return out;
    }

    function fieldHint(row: FieldBinding): string {
        const f = FIELD_CATALOG.find((c) => c.key === row.field);
        return f?.hint ?? "";
    }
</script>

<div class="payload-builder">
    <header class="builder-header">
        <div>
            <h3>{isQuery ? "URL 参数" : "请求体字段"}</h3>
            <p class="builder-desc">
                {#if isQuery}
                    拼接到请求地址上的查询参数。左侧填参数名，右侧选取值来源，发送时会自动 URL 编码。
                {:else}
                    逐条声明「目标系统的字段路径 ← 取值来源」。来源可以是待办/看板/应用字段、固定常量，或推送时填写的变量。
                {/if}
            </p>
        </div>
        <button type="button" class="add-btn" onclick={addRow}>
            <Add size={14} />
            {isQuery ? "添加参数" : "添加字段"}
        </button>
    </header>

    {#if bindings.length === 0}
        <div class="builder-empty">
            <p>{isQuery ? "还没有配置 URL 参数。" : "还没有配置任何字段。"}</p>
            <span>
                {#if isQuery}
                    点击「添加参数」开始，例如参数名 <code>projectKey</code> ← 常量 <code>TEST</code>。
                {:else}
                    点击「添加字段」开始，例如 目标路径 <code>fields.summary</code> ← 待办标题。
                {/if}
            </span>
        </div>
    {:else}
        <div class="binding-list">
            {#each bindings as row, i (row.id)}
                <div class="binding-row" class:kind-off={isKindDisabled(row)}>
                    <div class="binding-row-top">
                        <label class="field field--path">
                            <span class="field-label">
                                {isQuery ? "参数名" : "目标字段路径"}
                            </span>
                            <input
                                class="field-input mono"
                                type="text"
                                placeholder={isQuery ? "projectKey" : "fields.summary"}
                                value={row.path}
                                oninput={(e) =>
                                    updateRow(row.id, {
                                        path: e.currentTarget.value,
                                    })}
                            />
                        </label>

                        <label class="field field--kind">
                            <span class="field-label">来源</span>
                            <select
                                class="field-input"
                                value={row.kind}
                                onchange={(e) =>
                                    changeKind(
                                        row,
                                        e.currentTarget.value as FieldSourceKind,
                                    )}
                            >
                                {#if isKindDisabled(row)}
                                    <option value={row.kind}>
                                        {SOURCE_LABELS[row.kind]}（已关闭）
                                    </option>
                                {/if}
                                {#each sourceOptions as opt}
                                    <option value={opt.value}>{opt.label}</option>
                                {/each}
                            </select>
                        </label>

                        <div class="field field--param">
                            {#if row.kind === "ticket" || row.kind === "board" || row.kind === "app" || row.kind === "mapped"}
                                <span class="field-label">
                                    {row.kind === "mapped"
                                        ? "来源字段（将做值映射）"
                                        : "字段"}
                                </span>
                                {#if optionsForRow(row).length === 0}
                                    <p class="binding-warn">
                                        该来源下没有开启任何字段，请到「字段来源」页签开启。
                                    </p>
                                {:else}
                                    <select
                                        class="field-input"
                                        value={row.field ?? ""}
                                        onchange={(e) =>
                                            updateRow(row.id, {
                                                field: e.currentTarget.value,
                                            })}
                                    >
                                        {#each optionsForRow(row) as opt}
                                            <option value={opt.value}>{opt.label}</option>
                                        {/each}
                                    </select>
                                {/if}
                            {:else if row.kind === "constant"}
                                <span class="field-label">常量值 / 类型</span>
                                <div class="constant-pair">
                                    <input
                                        class="field-input"
                                        type="text"
                                        placeholder="TEST"
                                        value={row.value ?? ""}
                                        oninput={(e) =>
                                            updateRow(row.id, {
                                                value: e.currentTarget.value,
                                            })}
                                    />
                                    <select
                                        class="field-input mono"
                                        value={row.value_type ?? "string"}
                                        onchange={(e) =>
                                            updateRow(row.id, {
                                                value_type: e.currentTarget
                                                    .value as ConstantValueType,
                                            })}
                                    >
                                        {#each CONSTANT_TYPES as t}
                                            <option value={t.value}>{t.label}</option>
                                        {/each}
                                    </select>
                                </div>
                            {:else if row.kind === "variable"}
                                <span class="field-label">变量</span>
                                {#if variableOptions.length === 0}
                                    <p class="binding-warn">
                                        还没有定义变量，请先在「推送变量」中添加。
                                    </p>
                                {:else}
                                    <select
                                        class="field-input"
                                        value={row.variable_key ?? ""}
                                        onchange={(e) =>
                                            updateRow(row.id, {
                                                variable_key:
                                                    e.currentTarget.value,
                                            })}
                                    >
                                        {#each variableOptions as opt}
                                            <option value={opt.value}>{opt.label}</option>
                                        {/each}
                                    </select>
                                {/if}
                            {/if}
                        </div>

                        <div class="binding-actions">
                            <button
                                type="button"
                                class="icon-btn"
                                title="上移"
                                disabled={i === 0}
                                onclick={() => move(row.id, -1)}
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                class="icon-btn"
                                title="下移"
                                disabled={i === bindings.length - 1}
                                onclick={() => move(row.id, 1)}
                            >
                                ↓
                            </button>
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

                    {#if isKindDisabled(row)}
                        <p class="binding-off-note">
                            来源「{SOURCE_LABELS[row.kind]}」当前在「字段来源」中已关闭，此条仍会生效。
                        </p>
                    {:else if fieldHint(row)}
                        <p class="binding-hint">提示：{fieldHint(row)}</p>
                    {/if}

                    {#if row.kind === "mapped"}
                        <div class="binding-extra">
                            <label class="field">
                                <span class="field-label">
                                    值映射（每行一条：本地值=远端值）
                                </span>
                                <textarea
                                    class="field-input mono"
                                    rows="3"
                                    placeholder={"in_progress=In Progress\ndone=Done"}
                                    value={mappingToText(row.value_mapping)}
                                    oninput={(e) =>
                                        updateRow(row.id, {
                                            value_mapping: textToMapping(
                                                e.currentTarget.value,
                                            ),
                                        })}
                                ></textarea>
                            </label>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .payload-builder {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .builder-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
    }

    .builder-header h3 {
        margin: 0 0 0.25rem 0;
        font-size: 0.9375rem;
        font-weight: 600;
    }

    .builder-desc {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--cds-text-02);
        line-height: 1.5;
        max-width: 62ch;
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

    .builder-empty {
        padding: 1.5rem;
        text-align: center;
        border: 1px dashed var(--cds-ui-03);
        border-radius: 6px;
        color: var(--cds-text-02);
    }

    .builder-empty p {
        margin: 0 0 0.25rem 0;
        font-weight: 500;
    }

    .builder-empty span {
        font-size: 0.8125rem;
    }

    .builder-empty code {
        font-family: var(--cds-code-01-font-family);
        background: var(--cds-ui-02);
        padding: 0.0625rem 0.25rem;
        border-radius: 2px;
    }

    .binding-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .binding-row {
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        background: var(--cds-ui-01);
        padding: 0.75rem;
    }

    .binding-row.kind-off {
        border-left: 3px solid var(--cds-support-03, #f1c21b);
    }

    .binding-row-top {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr 1.5fr auto;
        gap: 0.5rem;
        align-items: end;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
    }

    .field-label {
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: var(--cds-text-02);
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

    textarea.field-input {
        height: auto;
        padding: 0.5rem 0.625rem;
        resize: vertical;
        line-height: 1.4;
    }

    .mono {
        font-family: var(--cds-code-01-font-family, "IBM Plex Mono", monospace);
    }

    .constant-pair {
        display: grid;
        grid-template-columns: 1fr 0.85fr;
        gap: 0.5rem;
    }

    .binding-actions {
        display: flex;
        align-items: center;
        gap: 0.125rem;
        padding-bottom: 0.25rem;
    }

    .icon-btn {
        all: unset;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 2px;
        font-size: 0.8125rem;
        color: var(--cds-text-02);
        cursor: pointer;
    }

    .icon-btn:hover:not(:disabled) {
        background: var(--cds-hover-ui);
        color: var(--cds-text-01);
    }

    .icon-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .icon-btn--danger:hover {
        color: var(--cds-support-01);
    }

    .binding-hint {
        margin: 0.375rem 0 0 0;
        font-size: 0.75rem;
        color: var(--cds-text-03);
    }

    .binding-off-note {
        margin: 0.375rem 0 0 0;
        font-size: 0.75rem;
        color: var(--cds-support-03, #f1c21b);
    }

    .binding-warn {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--cds-support-03, #f1c21b);
        padding: 0.375rem 0;
    }

    .binding-extra {
        margin-top: 0.5rem;
        padding-top: 0.5rem;
        border-top: 1px dashed var(--cds-ui-03);
    }

    @media (max-width: 900px) {
        .binding-row-top {
            grid-template-columns: 1fr;
        }
    }
</style>
