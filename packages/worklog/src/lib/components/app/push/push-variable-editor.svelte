<script lang="ts">
    import { Button } from "carbon-components-svelte";
    import { Add, TrashCan } from "carbon-icons-svelte";
    import { optionsToText, textToOptions } from "$lib/push/field-catalog";
    import type { PushVariableDef, PushVariableType } from "$lib/push/types";

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

    function keyWarning(v: PushVariableDef, index: number): string | null {
        if (!v.key.trim()) return "变量 Key 不能为空";
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.key))
            return "建议使用字母/数字/下划线，且不以数字开头";
        if (variables.some((o, i) => i !== index && o.key === v.key))
            return "变量 Key 重复";
        return null;
    }
</script>

<div class="variable-editor">
    <header class="variable-header">
        <div>
            <h3>推送变量</h3>
            <p class="variable-desc">
                变量在「请求体字段」中被引用后，会在每次远程推送时由用户填写。
                适合目标系统要求人工选择的字段（如工单类型），支持手动输入或下拉选择。
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
                                    updateVariable(i, {
                                        type: e.currentTarget
                                            .value as PushVariableType,
                                    })}
                            >
                                {#each TYPE_OPTIONS as t}
                                    <option value={t.value}>{t.label}</option>
                                {/each}
                            </select>
                        </label>
                        <label class="field">
                            <span class="field-label">默认值</span>
                            <input
                                class="field-input"
                                type="text"
                                placeholder="可留空"
                                value={v.default_value ?? ""}
                                oninput={(e) =>
                                    updateVariable(i, {
                                        default_value: e.currentTarget.value,
                                    })}
                            />
                        </label>
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
                            <span class="used-tag">已被请求体字段引用</span>
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
                            <label class="field">
                                <span class="field-label">
                                    可选项（每行一条，可用 显示名=值）
                                </span>
                                <textarea
                                    class="field-input mono"
                                    rows="4"
                                    placeholder={"Bug=bug\nFeature=feature\nTask=task"}
                                    value={optionsToText(v.options)}
                                    oninput={(e) =>
                                        updateVariable(i, {
                                            options: textToOptions(
                                                e.currentTarget.value,
                                            ),
                                        })}
                                ></textarea>
                            </label>
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
        color: var(--cds-text-02);
        cursor: pointer;
    }

    .icon-btn:hover {
        background: var(--cds-hover-ui);
    }

    .icon-btn--danger:hover {
        color: var(--cds-support-01);
    }

    .variable-options {
        margin-top: 0.5rem;
        padding-top: 0.5rem;
        border-top: 1px dashed var(--cds-ui-03);
    }

    @media (max-width: 900px) {
        .variable-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
