<script lang="ts">
    import { Button } from "carbon-components-svelte";
    import { Add, TrashCan } from "carbon-icons-svelte";
    import type {
        PushVariableDef,
        PushVariableType,
        PushVariableOption,
    } from "$lib/push/types";

    interface Props {
        variables: PushVariableDef[];
        /** Keys already referenced by payload fields — shown as a hint. */
        usedKeys?: string[];
    }

    let { variables = $bindable(), usedKeys = [] }: Props = $props();

    const TYPE_OPTIONS: { value: PushVariableType; label: string }[] = [
        { value: "text", label: "单行文本" },
        { value: "textarea", label: "多行文本" },
        { value: "number", label: "数字" },
        { value: "select", label: "下拉选择" },
        { value: "multiselect", label: "多选" },
        { value: "boolean", label: "布尔开关" },
        { value: "date", label: "日期" },
    ];

    function needsOptions(type: PushVariableType): boolean {
        return type === "select" || type === "multiselect";
    }

    // ── Variable level ───────────────────────────────────────────────────────

    function addVariable() {
        let n = variables.length + 1;
        let key = `var_${n}`;
        while (variables.some((v) => v.key === key)) {
            n += 1;
            key = `var_${n}`;
        }
        variables = [
            ...variables,
            {
                key,
                label: "",
                type: "text",
                required: false,
                default_value: "",
                options: [],
                placeholder: "",
                help_text: "",
            },
        ];
    }

    function removeVariable(index: number) {
        variables = variables.filter((_, i) => i !== index);
    }

    function updateVariable(index: number, patch: Partial<PushVariableDef>) {
        variables = variables.map((v, i) =>
            i === index ? { ...v, ...patch } : v,
        );
    }

    /** Switching to a choice type seeds one empty row so there is something to fill. */
    function changeType(index: number, type: PushVariableType) {
        const patch: Partial<PushVariableDef> = { type };
        if (needsOptions(type)) {
            const current = variables[index].options ?? [];
            if (current.length === 0) {
                patch.options = [{ label: "", value: "" }];
            }
        }
        updateVariable(index, patch);
    }

    function keyWarning(v: PushVariableDef, index: number): string | null {
        if (!v.key.trim()) return "变量 Key 不能为空";
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.key))
            return "建议使用字母/数字/下划线，且不以数字开头";
        if (variables.some((o, i) => i !== index && o.key === v.key))
            return "变量 Key 重复";
        return null;
    }

    // ── Option rows (label / value pairs) ────────────────────────────────────

    function optionsOf(index: number): PushVariableOption[] {
        return variables[index]?.options ?? [];
    }

    function addOption(index: number) {
        updateVariable(index, {
            options: [...optionsOf(index), { label: "", value: "" }],
        });
    }

    function removeOption(index: number, optIndex: number) {
        updateVariable(index, {
            options: optionsOf(index).filter((_, i) => i !== optIndex),
        });
    }

    function moveOption(index: number, optIndex: number, delta: number) {
        const list = [...optionsOf(index)];
        const next = optIndex + delta;
        if (next < 0 || next >= list.length) return;
        const [row] = list.splice(optIndex, 1);
        list.splice(next, 0, row);
        updateVariable(index, { options: list });
    }

    /**
     * Edit the display name. While the submitted value is still empty (or still
     * mirrors the previous label) it follows along, which covers the common
     * "label and value are the same" case without extra typing.
     */
    function updateOptionLabel(index: number, optIndex: number, label: string) {
        const list = [...optionsOf(index)];
        const prev = list[optIndex] ?? { label: "", value: "" };
        const syncValue = !prev.value || prev.value === prev.label;
        list[optIndex] = { label, value: syncValue ? label : prev.value };
        updateVariable(index, { options: list });
    }

    function updateOptionValue(index: number, optIndex: number, value: string) {
        const list = [...optionsOf(index)];
        const prev = list[optIndex] ?? { label: "", value: "" };
        list[optIndex] = { ...prev, value };
        updateVariable(index, { options: list });
    }

    /** Options that are complete enough to be offered at push time. */
    function validOptions(index: number): PushVariableOption[] {
        return optionsOf(index).filter((o) => o.value.trim() !== "");
    }

    function optionWarning(v: PushVariableDef, index: number): string | null {
        if (!needsOptions(v.type)) return null;
        const valid = validOptions(index);
        if (valid.length === 0) return "至少需要一个带「提交值」的选项";
        const values = valid.map((o) => o.value);
        if (new Set(values).size !== values.length) return "提交值存在重复";
        return null;
    }
</script>

<div class="variable-editor">
    <header class="variable-header">
        <div>
            <h3>推送变量</h3>
            <p class="variable-desc">
                变量在「请求体字段」「URL 与参数」「请求头」中被引用后，会在每次远程推送时由用户填写。
                选择「下拉选择 / 多选」即可逐行维护可选项。
            </p>
        </div>
        <Button kind="ghost" size="small" icon={Add} onclick={addVariable}>
            添加变量
        </Button>
    </header>

    {#if variables.length === 0}
        <div class="variable-empty">
            <p>还没有定义变量。</p>
            <span>
                如果你希望推送时手动选择「工单类型」之类的值，就在这里定义一个下拉类型的变量。
            </span>
        </div>
    {:else}
        <div class="variable-list">
            {#each variables as v, i (i)}
                {@const warning = keyWarning(v, i)}
                {@const optWarn = optionWarning(v, i)}
                <div class="variable-row" class:has-error={!!warning}>
                    <div class="variable-grid">
                        <label class="field">
                            <span class="field-label">变量 Key</span>
                            <input
                                class="field-input mono"
                                type="text"
                                placeholder="issue_type"
                                value={v.key}
                                oninput={(e) =>
                                    updateVariable(i, {
                                        key: e.currentTarget.value,
                                    })}
                            />
                        </label>
                        <label class="field">
                            <span class="field-label">显示名称</span>
                            <input
                                class="field-input"
                                type="text"
                                placeholder="工单类型"
                                value={v.label}
                                oninput={(e) =>
                                    updateVariable(i, {
                                        label: e.currentTarget.value,
                                    })}
                            />
                        </label>
                        <label class="field">
                            <span class="field-label">类型</span>
                            <select
                                class="field-input"
                                value={v.type}
                                onchange={(e) =>
                                    changeType(
                                        i,
                                        e.currentTarget.value as PushVariableType,
                                    )}
                            >
                                {#each TYPE_OPTIONS as t}
                                    <option value={t.value}>{t.label}</option>
                                {/each}
                            </select>
                        </label>

                        <!-- Default value: a picker for choice types, free text otherwise -->
                        <div class="field">
                            {#if v.type === "select"}
                                <span class="field-label">默认值</span>
                                <select
                                    class="field-input"
                                    value={v.default_value ?? ""}
                                    onchange={(e) =>
                                        updateVariable(i, {
                                            default_value:
                                                e.currentTarget.value,
                                        })}
                                >
                                    <option value="">（不设置）</option>
                                    {#each validOptions(i) as opt}
                                        <option value={opt.value}>
                                            {opt.label || opt.value}
                                        </option>
                                    {/each}
                                </select>
                            {:else if v.type === "multiselect"}
                                <span class="field-label">
                                    默认值（多个用逗号分隔）
                                </span>
                                <input
                                    class="field-input"
                                    type="text"
                                    placeholder="bug,feature"
                                    value={v.default_value ?? ""}
                                    oninput={(e) =>
                                        updateVariable(i, {
                                            default_value:
                                                e.currentTarget.value,
                                        })}
                                />
                            {:else}
                                <span class="field-label">默认值</span>
                                <input
                                    class="field-input"
                                    type="text"
                                    placeholder="可留空"
                                    value={v.default_value ?? ""}
                                    oninput={(e) =>
                                        updateVariable(i, {
                                            default_value:
                                                e.currentTarget.value,
                                        })}
                                />
                            {/if}
                        </div>
                    </div>

                    <div class="variable-row-footer">
                        <label class="native-checkbox">
                            <input
                                type="checkbox"
                                checked={v.required}
                                onchange={(e) =>
                                    updateVariable(i, {
                                        required: e.currentTarget.checked,
                                    })}
                            />
                            <span>必填</span>
                        </label>

                        {#if usedKeys.includes(v.key)}
                            <span class="used-tag">已被引用</span>
                        {/if}
                        {#if warning}
                            <span class="error-tag">{warning}</span>
                        {/if}

                        <div class="spacer"></div>

                        <button
                            type="button"
                            class="icon-btn icon-btn--danger"
                            title="删除变量"
                            onclick={() => removeVariable(i)}
                        >
                            <TrashCan size={14} />
                        </button>
                    </div>

                    <div class="variable-options">
                        {#if needsOptions(v.type)}
                            <div class="option-editor">
                                <div class="option-editor-head">
                                    <span class="field-label">
                                        可选项
                                        <span class="option-count">
                                            {validOptions(i).length} 个有效
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        class="link-btn"
                                        onclick={() => addOption(i)}
                                    >
                                        + 添加选项
                                    </button>
                                </div>

                                {#if optionsOf(i).length === 0}
                                    <p class="option-empty">
                                        还没有选项。点击「+ 添加选项」逐行维护「显示名 / 提交值」。
                                    </p>
                                {:else}
                                    <div class="option-head-row">
                                        <span>显示名</span>
                                        <span>提交值</span>
                                        <span></span>
                                    </div>
                                    {#each optionsOf(i) as opt, oi (oi)}
                                        <div class="option-row">
                                            <input
                                                class="field-input"
                                                type="text"
                                                placeholder="Bug"
                                                value={opt.label}
                                                oninput={(e) =>
                                                    updateOptionLabel(
                                                        i,
                                                        oi,
                                                        e.currentTarget.value,
                                                    )}
                                            />
                                            <input
                                                class="field-input mono"
                                                class:missing={!opt.value.trim()}
                                                type="text"
                                                placeholder="bug"
                                                value={opt.value}
                                                oninput={(e) =>
                                                    updateOptionValue(
                                                        i,
                                                        oi,
                                                        e.currentTarget.value,
                                                    )}
                                            />
                                            <div class="option-actions">
                                                <button
                                                    type="button"
                                                    class="icon-btn"
                                                    title="上移"
                                                    disabled={oi === 0}
                                                    onclick={() =>
                                                        moveOption(i, oi, -1)}
                                                >
                                                    ↑
                                                </button>
                                                <button
                                                    type="button"
                                                    class="icon-btn"
                                                    title="下移"
                                                    disabled={oi ===
                                                        optionsOf(i).length - 1}
                                                    onclick={() =>
                                                        moveOption(i, oi, 1)}
                                                >
                                                    ↓
                                                </button>
                                                <button
                                                    type="button"
                                                    class="icon-btn icon-btn--danger"
                                                    title="删除选项"
                                                    onclick={() =>
                                                        removeOption(i, oi)}
                                                >
                                                    <TrashCan size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    {/each}
                                    {#if optWarn}
                                        <p class="option-warn">{optWarn}</p>
                                    {/if}
                                {/if}
                            </div>
                        {:else}
                            <label class="field">
                                <span class="field-label">输入提示（可选）</span>
                                <input
                                    class="field-input"
                                    type="text"
                                    placeholder="请输入…"
                                    value={v.placeholder ?? ""}
                                    oninput={(e) =>
                                        updateVariable(i, {
                                            placeholder: e.currentTarget.value,
                                        })}
                                />
                            </label>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .variable-editor {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .variable-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
    }

    .variable-header h3 {
        margin: 0 0 0.25rem 0;
        font-size: 0.9375rem;
        font-weight: 600;
    }

    .variable-desc {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--cds-text-02);
        line-height: 1.5;
        max-width: 62ch;
    }

    .variable-empty {
        padding: 1.5rem;
        text-align: center;
        border: 1px dashed var(--cds-ui-03);
        border-radius: 6px;
        color: var(--cds-text-02);
    }

    .variable-empty p {
        margin: 0 0 0.25rem 0;
        font-weight: 500;
    }

    .variable-empty span {
        font-size: 0.8125rem;
    }

    .variable-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .variable-row {
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        background: var(--cds-ui-01);
        padding: 0.75rem;
    }

    .variable-row.has-error {
        border-color: var(--cds-support-01);
    }

    .variable-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 0.9fr 1fr;
        gap: 0.5rem;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
    }

    .field-label {
        display: flex;
        align-items: baseline;
        gap: 0.375rem;
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

    .field-input.missing {
        border-bottom-color: var(--cds-support-03, #f1c21b);
    }

    .mono {
        font-family: var(--cds-code-01-font-family, "IBM Plex Mono", monospace);
    }

    .variable-row-footer {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 0.5rem;
    }

    .native-checkbox {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
        color: var(--cds-text-01);
        cursor: pointer;
    }

    .native-checkbox input {
        width: 1rem;
        height: 1rem;
        accent-color: var(--cds-interactive-01, #0f62fe);
        cursor: pointer;
    }

    .spacer {
        flex: 1;
    }

    .used-tag {
        font-size: 0.6875rem;
        padding: 0.0625rem 0.375rem;
        border-radius: 2px;
        color: var(--cds-support-02);
        background: color-mix(in srgb, var(--cds-support-02) 15%, transparent);
    }

    .error-tag {
        font-size: 0.6875rem;
        padding: 0.0625rem 0.375rem;
        border-radius: 2px;
        color: var(--cds-support-01);
        background: color-mix(in srgb, var(--cds-support-01) 15%, transparent);
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

    .variable-options {
        margin-top: 0.5rem;
        padding-top: 0.5rem;
        border-top: 1px dashed var(--cds-ui-03);
    }

    /* ── Option k-v rows ──────────────────────────────────────────────────── */
    .option-editor {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .option-editor-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
    }

    .option-count {
        font-weight: 400;
        color: var(--cds-text-03);
    }

    .link-btn {
        all: unset;
        font-size: 0.75rem;
        color: var(--cds-link-01, #78a9ff);
        cursor: pointer;
    }

    .link-btn:hover {
        text-decoration: underline;
    }

    .option-empty {
        margin: 0;
        font-size: 0.75rem;
        color: var(--cds-text-03);
    }

    .option-head-row {
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 0.5rem;
        font-size: 0.625rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cds-text-03);
        padding: 0 0.125rem;
    }

    .option-head-row span:last-child {
        width: 5.25rem;
    }

    .option-row {
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 0.5rem;
        align-items: center;
    }

    .option-actions {
        display: flex;
        align-items: center;
        gap: 0.0625rem;
    }

    .option-warn {
        margin: 0.125rem 0 0 0;
        font-size: 0.75rem;
        color: var(--cds-support-03, #f1c21b);
    }

    @media (max-width: 900px) {
        .variable-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
