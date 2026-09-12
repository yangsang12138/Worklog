<script lang="ts">
    import type {
        PushSourceConfig,
        FieldSourceKind,
        PushVariableDef,
    } from "$lib/push/types";
    import {
        ALL_FIELD_SOURCES,
        catalogByGroup,
        defaultSourceConfig,
        type CatalogGroup,
    } from "$lib/push/field-catalog";
    import * as m from "$lib/paraglide/messages.js";

    interface Props {
        config: PushSourceConfig;
        /** Defined variables, exposed as switchable "fields" of the variable source. */
        variables?: PushVariableDef[];
    }

    let { config = $bindable(), variables = [] }: Props = $props();

    function msg(key: string, fallback: string): string {
        const fn = (m as unknown as Record<string, () => string>)[key];
        return typeof fn === "function" ? fn() : fallback;
    }

    /** Sources that draw their value from the catalog and therefore own fields. */
    const FIELD_GROUPS: { kind: FieldSourceKind; group: CatalogGroup }[] = [
        { kind: "ticket", group: "ticket" },
        { kind: "board", group: "board" },
        { kind: "app", group: "app" },
    ];

    const SOURCE_META: Record<
        FieldSourceKind,
        { label: string; desc: string }
    > = {
        ticket: {
            label: "待办字段",
            desc: "引用本应用待办上的数据，如标题、描述、状态",
        },
        board: { label: "看板字段", desc: "引用待办所属看板的信息" },
        app: { label: "应用字段", desc: "工作区名称、当前用户、应用版本等" },
        constant: { label: "常量", desc: "固定字面量，目标系统要求的写死字段" },
        variable: {
            label: "变量",
            desc: "推送时由用户填写或选择的值",
        },
        mapped: {
            label: "待办字段（值映射）",
            desc: "取待办字段后按映射表转换成目标系统的枚举值",
        },
    };

    /** Which group panel is expanded, if any. */
    let expanded = $state<CatalogGroup | null>("ticket");

    function isSourceEnabled(kind: FieldSourceKind): boolean {
        return config.enabled_sources.includes(kind);
    }

    function toggleSource(kind: FieldSourceKind) {
        const next = isSourceEnabled(kind)
            ? config.enabled_sources.filter((s) => s !== kind)
            : [...config.enabled_sources, kind];
        // Keep the canonical ordering so the picker is stable.
        config = {
            ...config,
            enabled_sources: ALL_FIELD_SOURCES.filter((s) => next.includes(s)),
        };
    }

    function groupFields(group: CatalogGroup) {
        return catalogByGroup(group);
    }

    function isFieldEnabled(group: CatalogGroup, key: string): boolean {
        return (config.enabled_fields[group] ?? []).includes(key);
    }

    function toggleField(group: CatalogGroup, key: string) {
        const current = config.enabled_fields[group] ?? [];
        const next = current.includes(key)
            ? current.filter((k) => k !== key)
            : [...current, key];
        config = {
            ...config,
            enabled_fields: { ...config.enabled_fields, [group]: next },
        };
    }

    function groupEnabledCount(group: CatalogGroup): number {
        return (config.enabled_fields[group] ?? []).length;
    }

    function groupTotalCount(group: CatalogGroup): number {
        return groupFields(group).length;
    }

    function setGroupAll(group: CatalogGroup, on: boolean) {
        config = {
            ...config,
            enabled_fields: {
                ...config.enabled_fields,
                [group]: on ? groupFields(group).map((f) => f.key) : [],
            },
        };
    }

    function resetAll() {
        config = defaultSourceConfig();
    }

    function enableAllSources() {
        config = { ...config, enabled_sources: [...ALL_FIELD_SOURCES] };
    }

    const totalEnabledFields = $derived(
        Object.values(config.enabled_fields).reduce(
            (sum, list) => sum + list.length,
            0,
        ),
    );

    // ── Variable switches ────────────────────────────────────────────────────
    // `enabled_variables` is an explicit allow-list; the parser seeds it from
    // the target's current variables, so a freshly created target starts with
    // everything on.
    const enabledVariableKeys = $derived(config.enabled_variables);

    function isVariableEnabled(key: string): boolean {
        return enabledVariableKeys.includes(key);
    }

    function toggleVariable(key: string) {
        const next = isVariableEnabled(key)
            ? enabledVariableKeys.filter((k) => k !== key)
            : [...enabledVariableKeys, key];
        config = { ...config, enabled_variables: next };
    }

    function setAllVariables(on: boolean) {
        config = {
            ...config,
            enabled_variables: on ? variables.map((v) => v.key) : [],
        };
    }
</script>

<div class="source-config">
    <header class="sc-header">
        <div>
            <h3>字段来源</h3>
            <p class="sc-desc">
                关闭用不到的来源，可以让「请求体字段」「URL 参数」里的下拉选项更精简。
                每个来源下的字段也可以逐个关闭。
            </p>
        </div>
        <div class="sc-header-actions">
            <button type="button" class="link-btn" onclick={enableAllSources}>
                全部来源开启
            </button>
            <button type="button" class="link-btn" onclick={resetAll}>
                重置为默认
            </button>
        </div>
    </header>

    <!-- ── Source level switches ─────────────────────────────────────────── -->
    <section class="sc-section">
        <h4 class="sc-section-title">
            来源开关
            <span class="sc-count">
                已开启 {config.enabled_sources.length} / {ALL_FIELD_SOURCES.length}
            </span>
        </h4>

        <div class="switch-list">
            {#each ALL_FIELD_SOURCES as kind (kind)}
                {@const meta = SOURCE_META[kind]}
                <div class="switch-row" class:off={!isSourceEnabled(kind)}>
                    <button
                        type="button"
                        class="switch"
                        class:on={isSourceEnabled(kind)}
                        role="switch"
                        aria-checked={isSourceEnabled(kind)}
                        aria-label="{meta.label}：{isSourceEnabled(kind) ? '已开启' : '已关闭'}"
                        onclick={() => toggleSource(kind)}
                    >
                        <span class="switch-track">
                            <span class="switch-thumb"></span>
                        </span>
                    </button>
                    <div class="switch-text">
                        <span class="switch-label">{meta.label}</span>
                        <span class="switch-desc">{meta.desc}</span>
                    </div>
                </div>
            {/each}
        </div>
    </section>

    <!-- ── Field level switches ──────────────────────────────────────────── -->
    <section class="sc-section">
        <h4 class="sc-section-title">
            字段开关
            <span class="sc-count">已开启 {totalEnabledFields} 个字段</span>
        </h4>

        <div class="group-list">
            {#each FIELD_GROUPS as g (g.group)}
                {@const open = expanded === g.group}
                <div class="group" class:disabled={!isSourceEnabled(g.kind)}>
                    <button
                        type="button"
                        class="group-head"
                        onclick={() => (expanded = open ? null : g.group)}
                    >
                        <span class="group-caret" class:open>▸</span>
                        <span class="group-name">
                            {SOURCE_META[g.kind].label}
                        </span>
                        <span class="group-badge">
                            {groupEnabledCount(g.group)} / {groupTotalCount(g.group)}
                        </span>
                        {#if !isSourceEnabled(g.kind)}
                            <span class="group-note">来源已关闭</span>
                        {/if}
                    </button>

                    {#if open}
                        <div class="group-body">
                            <div class="group-tools">
                                <button
                                    type="button"
                                    class="link-btn"
                                    onclick={() => setGroupAll(g.group, true)}
                                >
                                    全选
                                </button>
                                <button
                                    type="button"
                                    class="link-btn"
                                    onclick={() => setGroupAll(g.group, false)}
                                >
                                    全不选
                                </button>
                            </div>

                            <div class="field-grid">
                                {#each groupFields(g.group) as f (f.key)}
                                    <label class="field-check">
                                        <input
                                            type="checkbox"
                                            checked={isFieldEnabled(g.group, f.key)}
                                            onchange={() =>
                                                toggleField(g.group, f.key)}
                                        />
                                        <span class="field-check-label">
                                            {msg(f.label_key, f.label)}
                                        </span>
                                        {#if f.hint}
                                            <span class="field-check-hint">
                                                {f.hint}
                                            </span>
                                        {/if}
                                    </label>
                                {/each}
                            </div>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    </section>

    <!-- ── Variable switches ─────────────────────────────────────────────── -->
    {#if variables.length > 0}
        <section class="sc-section">
            <h4 class="sc-section-title">
                变量开关
                <span class="sc-count">
                    已开启 {enabledVariableKeys.length} / {variables.length}
                </span>
                <button
                    type="button"
                    class="link-btn inline"
                    onclick={() => setAllVariables(true)}
                >
                    全选
                </button>
                <button
                    type="button"
                    class="link-btn inline"
                    onclick={() => setAllVariables(false)}
                >
                    全不选
                </button>
            </h4>

            <div class="switch-list">
                {#each variables as v (v.key)}
                    <button
                        type="button"
                        class="switch-row as-button"
                        class:off={!isVariableEnabled(v.key)}
                        onclick={() => toggleVariable(v.key)}
                    >
                        <span
                            class="switch"
                            class:on={isVariableEnabled(v.key)}
                            role="switch"
                            aria-checked={isVariableEnabled(v.key)}
                        >
                            <span class="switch-track">
                                <span class="switch-thumb"></span>
                            </span>
                        </span>
                        <span class="switch-text">
                            <span class="switch-label">
                                {v.label || v.key}
                            </span>
                            <span class="switch-desc">
                                {v.key} · {v.type}
                            </span>
                        </span>
                    </button>
                {/each}
            </div>
        </section>
    {/if}
</div>

<style>
    .source-config {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    .sc-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
    }

    .sc-header h3 {
        margin: 0 0 0.25rem 0;
        font-size: 0.9375rem;
        font-weight: 600;
    }

    .sc-desc {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--cds-text-02);
        line-height: 1.5;
        max-width: 62ch;
    }

    .sc-header-actions {
        display: flex;
        gap: 0.75rem;
        flex-shrink: 0;
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

    .link-btn.inline {
        text-transform: none;
        letter-spacing: 0;
        font-weight: 400;
    }

    .sc-section {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .sc-section-title {
        margin: 0;
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cds-text-02);
    }

    .sc-count {
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
        color: var(--cds-text-03);
    }

    /* ── Switches ─────────────────────────────────────────────────────────── */
    .switch-list {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .switch-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        background: var(--cds-ui-01);
        text-align: left;
    }

    .switch-row.as-button {
        all: unset;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        box-sizing: border-box;
        width: 100%;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        background: var(--cds-ui-01);
        cursor: pointer;
        text-align: left;
    }

    .switch-row.as-button:hover {
        border-color: var(--cds-interactive-03, #4589ff);
    }

    .switch-row.as-button:focus-visible {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: 2px;
    }

    .switch-row.off {
        opacity: 0.65;
    }

    .switch {
        all: unset;
        flex-shrink: 0;
        cursor: pointer;
    }

    .switch:focus-visible {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: 2px;
    }

    .switch-track {
        display: block;
        position: relative;
        width: 2rem;
        height: 1rem;
        border-radius: 0.5rem;
        background: var(--cds-ui-04, #8d8d8d);
        transition: background 0.15s ease;
    }

    .switch.on .switch-track {
        background: var(--cds-support-02, #24a148);
    }

    .switch-thumb {
        position: absolute;
        top: 0.125rem;
        left: 0.125rem;
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 50%;
        background: #ffffff;
        transition: transform 0.15s ease;
    }

    .switch.on .switch-thumb {
        transform: translateX(1rem);
    }

    .switch-text {
        display: flex;
        flex-direction: column;
        gap: 0.0625rem;
        min-width: 0;
    }

    .switch-label {
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--cds-text-01);
    }

    .switch-desc {
        font-size: 0.75rem;
        color: var(--cds-text-03);
    }

    /* ── Field groups ─────────────────────────────────────────────────────── */
    .group-list {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .group {
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        background: var(--cds-ui-01);
        overflow: hidden;
    }

    .group.disabled .group-head {
        opacity: 0.6;
    }

    .group-head {
        all: unset;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        box-sizing: border-box;
        padding: 0.5rem 0.75rem;
        cursor: pointer;
    }

    .group-head:hover {
        background: var(--cds-hover-ui);
    }

    .group-caret {
        display: inline-block;
        font-size: 0.625rem;
        color: var(--cds-text-03);
        transition: transform 0.15s ease;
    }

    .group-caret.open {
        transform: rotate(90deg);
    }

    .group-name {
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--cds-text-01);
    }

    .group-badge {
        font-size: 0.6875rem;
        padding: 0.0625rem 0.375rem;
        border-radius: 8px;
        background: var(--cds-ui-03);
        color: var(--cds-text-02);
    }

    .group-note {
        font-size: 0.6875rem;
        color: var(--cds-support-03, #f1c21b);
    }

    .group-body {
        padding: 0.5rem 0.75rem 0.75rem;
        border-top: 1px solid var(--cds-ui-03);
    }

    .group-tools {
        display: flex;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
    }

    .field-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.25rem 1rem;
    }

    .field-check {
        display: flex;
        align-items: baseline;
        gap: 0.375rem;
        font-size: 0.8125rem;
        color: var(--cds-text-01);
        cursor: pointer;
        min-width: 0;
    }

    .field-check input {
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
        accent-color: var(--cds-interactive-01, #0f62fe);
        cursor: pointer;
        transform: translateY(0.125rem);
    }

    .field-check-label {
        flex-shrink: 0;
    }

    .field-check-hint {
        font-size: 0.6875rem;
        color: var(--cds-text-03);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    @media (max-width: 900px) {
        .field-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
