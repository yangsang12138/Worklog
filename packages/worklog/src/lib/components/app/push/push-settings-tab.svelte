<script lang="ts">
    import { onMount } from "svelte";
    import { Modal, InlineLoading, Tag } from "carbon-components-svelte";
    import { Add, TrashCan, Edit, SendAlt } from "carbon-icons-svelte";
    import { getWorkspace } from "$lib/hooks/workspace.svelte";
    import { getPushHook } from "$lib/push/push-hook.svelte";
    import {
        parseBindings,
        parseVariables,
        parseSourceConfig,
        serializeSourceConfig,
        serializeBindings,
        defaultSourceConfig,
    } from "$lib/push/field-catalog";
    import type {
        PushTarget,
        CreatePushTargetInput,
        UpdatePushTargetInput,
        FieldBinding,
        PushVariableDef,
        PushSourceConfig,
    } from "$lib/push/types";
    import PushPayloadBuilder from "./push-payload-builder.svelte";
    import PushVariableEditor from "./push-variable-editor.svelte";
    import PushSourceConfigPanel from "./push-source-config.svelte";
    import PushHeaderEditor from "./push-header-editor.svelte";

    const workspace = getWorkspace();
    const push = getPushHook(() => workspace.path);

    // ── Modal state ──────────────────────────────────────────────────────────
    type EditorTab =
        | "basic"
        | "sources"
        | "headers"
        | "params"
        | "payload"
        | "variables";

    let showModal = $state(false);
    let editingTargetId = $state<string | null>(null);
    let saving = $state(false);
    let editorTab = $state<EditorTab>("basic");
    let deleteConfirmId = $state<string | null>(null);

    // ── Form fields ──────────────────────────────────────────────────────────
    let formName = $state("");
    let formDescription = $state("");
    let formEndpointUrl = $state("");
    let formMethod = $state("POST");
    let formHeaders = $state('{\n  "Content-Type": "application/json"\n}');
    let formTimeout = $state(30000);
    let formRetryCount = $state(0);
    let formEnabled = $state(true);

    // Structured configuration
    let formBindings = $state<FieldBinding[]>([]);
    let formQueryParams = $state<FieldBinding[]>([]);
    let formVariables = $state<PushVariableDef[]>([]);
    let formSourceConfig = $state<PushSourceConfig>(defaultSourceConfig());

    /**
     * Variable keys observed at the last sync. Used to tell a genuinely new
     * variable (auto-enable it) apart from one the user switched off on
     * purpose (leave it off).
     */
    let knownVarKeys = $state<string[]>([]);

    function resetForm() {
        formName = "";
        formDescription = "";
        formEndpointUrl = "";
        formMethod = "POST";
        formHeaders = '{\n  "Content-Type": "application/json"\n}';
        formTimeout = 30000;
        formRetryCount = 0;
        formEnabled = true;
        formBindings = [];
        formQueryParams = [];
        formVariables = [];
        formSourceConfig = defaultSourceConfig();
        knownVarKeys = [];
        editingTargetId = null;
        editorTab = "basic";
    }

    function openNewModal() {
        resetForm();
        showModal = true;
    }

    function openEditModal(target: PushTarget) {
        formName = target.name;
        formDescription = target.description;
        formEndpointUrl = target.endpoint_url;
        formMethod = target.http_method || "POST";
        formHeaders = target.headers;
        formTimeout = target.timeout_ms;
        formRetryCount = target.retry_count;
        formEnabled = target.enabled === 1;
        formBindings = parseBindings(target.payload_fields);
        formQueryParams = parseBindings(target.query_params);
        formVariables = parseVariables(target.variables);
        // Seed the scope from the target's own variables so a config saved
        // before this option existed still offers everything.
        formSourceConfig = parseSourceConfig(
            target.source_config,
            formVariables,
        );
        knownVarKeys = formVariables.map((v) => v.key).filter(Boolean);
        editingTargetId = target.id;
        editorTab = "basic";
        showModal = true;
    }

    async function handleSave() {
        saving = true;
        try {
            const input: CreatePushTargetInput = {
                name: formName.trim(),
                description: formDescription.trim(),
                endpoint_url: formEndpointUrl.trim(),
                http_method: formMethod,
                headers: formHeaders,
                payload_fields: serializeBindings(formBindings),
                query_params: serializeBindings(formQueryParams),
                variables: JSON.stringify(formVariables),
                source_config: serializeSourceConfig(formSourceConfig),
                timeout_ms: formTimeout,
                retry_count: formRetryCount,
                enabled: formEnabled ? 1 : 0,
            };

            if (editingTargetId) {
                await push.updateTarget(
                    editingTargetId,
                    input as UpdatePushTargetInput,
                );
            } else {
                await push.createTarget(input);
            }
            showModal = false;
        } catch (e) {
            console.error("Failed to save push target:", e);
        } finally {
            saving = false;
        }
    }

    async function handleDelete(id: string) {
        try {
            await push.deleteTarget(id);
            deleteConfirmId = null;
        } catch (e) {
            console.error("Failed to delete push target:", e);
        }
    }

    // ── Derived ──────────────────────────────────────────────────────────────
    const usedVariableKeys = $derived(
        [...formBindings, ...formQueryParams]
            .filter((b) => b.kind === "variable" && b.variable_key)
            .map((b) => b.variable_key as string),
    );

    const canSave = $derived(
        formName.trim().length > 0 &&
            formEndpointUrl.trim().length > 0 &&
            !saving,
    );

    const TAB_ITEMS: { id: EditorTab; label: string }[] = [
        { id: "basic", label: "基本信息" },
        { id: "sources", label: "字段来源" },
        { id: "headers", label: "请求头" },
        { id: "params", label: "URL 参数" },
        { id: "payload", label: "请求体字段" },
        { id: "variables", label: "推送变量" },
    ];

    function tabBadge(id: EditorTab): number | null {
        if (id === "payload") return formBindings.length || null;
        if (id === "params") return formQueryParams.length || null;
        if (id === "variables") return formVariables.length || null;
        return null;
    }

    /** Header count shown on the 请求头 tab. */
    const headerCount = $derived.by(() => {
        try {
            const obj = JSON.parse(formHeaders || "{}");
            return typeof obj === "object" && obj !== null
                ? Object.keys(obj).length
                : 0;
        } catch {
            return 0;
        }
    });

    // Keep the variable allow-list in sync as variables are added/removed:
    // a brand-new variable starts enabled, a deleted one is dropped, and a
    // variable the user switched off on purpose stays off.
    $effect(() => {
        if (!showModal) return;

        const keys = formVariables.map((v) => v.key).filter(Boolean);
        const added = keys.filter((k) => !knownVarKeys.includes(k));
        const removed = knownVarKeys.filter((k) => !keys.includes(k));
        if (added.length === 0 && removed.length === 0) return;

        knownVarKeys = keys;
        formSourceConfig = {
            ...formSourceConfig,
            enabled_variables: [
                ...formSourceConfig.enabled_variables.filter((k) =>
                    keys.includes(k),
                ),
                ...added,
            ],
        };
    });

    onMount(() => {
        void push.loadTargets();
    });
</script>

<div class="push-settings-tab">
    <section class="settings-section">
        <div class="section-header">
            <h2>远程推送目标</h2>
            <button type="button" class="primary-btn" onclick={openNewModal}>
                <Add size={14} />
                新增目标
            </button>
        </div>
        <p class="section-desc">
            按推送目标维护一个 POST 请求：地址、请求头、URL 参数，以及请求体字段的来源映射。
            字段可以取自工单/看板/应用数据、固定常量，或设为推送时填写的变量。
        </p>

        {#if push.loading}
            <div class="loading-wrap">
                <InlineLoading description="正在加载..." />
            </div>
        {:else if push.targets.length === 0}
            <div class="empty-state">
                <SendAlt size={32} />
                <p>还没有配置推送目标。点击上方按钮创建一个。</p>
            </div>
        {:else}
            <div class="target-list">
                {#each push.targets as target (target.id)}
                    <div class="target-card" class:disabled={!target.enabled}>
                        <div class="target-card-header">
                            <div class="target-info">
                                <strong class="target-name">{target.name}</strong>
                                <span class="target-url">{target.endpoint_url}</span>
                            </div>
                            <div class="target-badges">
                                {#if target.last_push_at}
                                    <Tag type="green" size="sm">已推送</Tag>
                                {/if}
                                <Tag
                                    type={target.enabled ? "teal" : "cool-gray"}
                                    size="sm"
                                >
                                    {target.enabled ? "启用" : "停用"}
                                </Tag>
                            </div>
                        </div>

                        {#if target.description}
                            <p class="target-desc">{target.description}</p>
                        {/if}

                        <div class="target-meta">
                            <span class="meta-item">
                                Method: <code>{target.http_method}</code>
                            </span>
                            <span class="meta-item">
                                字段: {parseBindings(target.payload_fields).length}
                            </span>
                            <span class="meta-item">
                                参数: {parseBindings(target.query_params).length}
                            </span>
                            <span class="meta-item">
                                变量: {parseVariables(target.variables).length}
                            </span>
                            <span class="meta-item">
                                超时: {target.timeout_ms}ms
                            </span>
                        </div>

                        <div class="target-actions">
                            <button
                                type="button"
                                class="action-btn"
                                onclick={() => openEditModal(target)}
                            >
                                <Edit size={14} />
                                编辑
                            </button>
                            <button
                                type="button"
                                class="action-btn action-btn--danger"
                                onclick={() => (deleteConfirmId = target.id)}
                            >
                                <TrashCan size={14} />
                                删除
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </section>
</div>

<!-- ── Create / Edit Modal ────────────────────────────────────────────────── -->
{#if showModal}
    <Modal
        size="lg"
        open={true}
        primaryButtonText={editingTargetId ? "保存更改" : "创建目标"}
        secondaryButtonText="取消"
        on:click:button--secondary={() => (showModal = false)}
        on:click:button--primary={handleSave}
        primaryButtonDisabled={!canSave}
    >
        <h3 slot="heading">
            {editingTargetId ? "编辑推送目标" : "新增推送目标"}
        </h3>

        <div class="editor">
            <!-- Tab strip -->
            <div class="editor-tabs" role="tablist">
                {#each TAB_ITEMS as item}
                    <button
                        type="button"
                        role="tab"
                        aria-selected={editorTab === item.id}
                        class="editor-tab"
                        class:active={editorTab === item.id}
                        onclick={() => (editorTab = item.id)}
                    >
                        {item.label}
                        {#if item.id === "headers" && headerCount > 0}
                            <span class="editor-tab-badge">{headerCount}</span>
                        {:else if tabBadge(item.id) !== null}
                            <span class="editor-tab-badge">{tabBadge(item.id)}</span>
                        {/if}
                    </button>
                {/each}
            </div>

            <div class="editor-body">
                {#if editorTab === "basic"}
                    <div class="editor-form">
                        <label class="field">
                            <span class="field-label">目标名称 *</span>
                            <input
                                class="field-input"
                                type="text"
                                placeholder="例如：公司工单系统"
                                bind:value={formName}
                            />
                        </label>

                        <label class="field">
                            <span class="field-label">描述</span>
                            <input
                                class="field-input"
                                type="text"
                                placeholder="可选描述"
                                bind:value={formDescription}
                            />
                        </label>

                        <label class="field">
                            <span class="field-label">Endpoint URL *</span>
                            <input
                                class="field-input mono"
                                type="text"
                                placeholder="https://ticket.example.com/api/issues"
                                bind:value={formEndpointUrl}
                            />
                        </label>

                        <div class="form-row form-row--3">
                            <label class="field">
                                <span class="field-label">HTTP 方法</span>
                                <input
                                    class="field-input"
                                    type="text"
                                    value={formMethod}
                                    readonly
                                />
                            </label>
                            <label class="field">
                                <span class="field-label">超时 (ms)</span>
                                <input
                                    class="field-input"
                                    type="number"
                                    bind:value={formTimeout}
                                />
                            </label>
                            <label class="field">
                                <span class="field-label">重试次数</span>
                                <input
                                    class="field-input"
                                    type="number"
                                    bind:value={formRetryCount}
                                />
                            </label>
                        </div>

                        <!-- Availability toggle: a visible, bordered control -->
                        <div class="toggle-field">
                            <span class="field-label">目标状态</span>
                            <button
                                type="button"
                                class="toggle-btn"
                                class:on={formEnabled}
                                role="switch"
                                aria-checked={formEnabled}
                                onclick={() => (formEnabled = !formEnabled)}
                            >
                                <span class="switch-track">
                                    <span class="switch-thumb"></span>
                                </span>
                                <span class="toggle-text">
                                    {formEnabled ? "已启用" : "已停用"}
                                </span>
                                <span class="toggle-hint">
                                    {formEnabled
                                        ? "推送弹窗中可选择此目标"
                                        : "推送弹窗中不再出现此目标"}
                                </span>
                            </button>
                        </div>
                    </div>
                {:else if editorTab === "sources"}
                    <PushSourceConfigPanel
                        bind:config={formSourceConfig}
                        variables={formVariables}
                    />
                {:else if editorTab === "headers"}
                    <PushHeaderEditor
                        bind:headers={formHeaders}
                        variables={formVariables}
                    />
                {:else if editorTab === "params"}
                    <PushPayloadBuilder
                        bind:bindings={formQueryParams}
                        variables={formVariables}
                        sourceConfig={formSourceConfig}
                        mode="query"
                    />
                {:else if editorTab === "payload"}
                    <PushPayloadBuilder
                        bind:bindings={formBindings}
                        variables={formVariables}
                        sourceConfig={formSourceConfig}
                        mode="body"
                    />
                {:else if editorTab === "variables"}
                    <PushVariableEditor
                        bind:variables={formVariables}
                        usedKeys={usedVariableKeys}
                    />
                {/if}
            </div>
        </div>
    </Modal>
{/if}

<!-- ── Delete Confirm ─────────────────────────────────────────────────────── -->
{#if deleteConfirmId}
    <Modal
        open={true}
        danger
        primaryButtonText="删除"
        secondaryButtonText="取消"
        on:click:button--primary={() => handleDelete(deleteConfirmId!)}
        on:click:button--secondary={() => (deleteConfirmId = null)}
    >
        <h3 slot="heading">确认删除</h3>
        <p>确定要删除此推送目标吗？相关的推送记录也会一并删除。此操作无法撤销。</p>
    </Modal>
{/if}

<style>
    .push-settings-tab {
        padding: 0 0 2rem 0;
    }

    .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.5rem;
    }

    .section-header h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
    }

    .primary-btn {
        all: unset;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 1rem;
        font-size: 0.8125rem;
        color: #ffffff;
        background: var(--cds-interactive-01, #0f62fe);
        border-radius: 2px;
        cursor: pointer;
    }

    .primary-btn:hover {
        background: var(--cds-hover-primary, #0353e9);
    }

    .primary-btn:focus-visible {
        outline: 2px solid var(--cds-focus, #ffffff);
        outline-offset: -3px;
    }

    .section-desc {
        font-size: 0.875rem;
        color: var(--cds-text-02);
        margin: 0 0 1.5rem 0;
        line-height: 1.5;
        max-width: 72ch;
    }

    .loading-wrap {
        display: flex;
        justify-content: center;
        padding: 2rem;
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        padding: 3rem 1rem;
        color: var(--cds-text-02);
        text-align: center;
    }

    .target-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .target-card {
        background: var(--cds-ui-01);
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        padding: 1rem;
    }

    .target-card.disabled {
        opacity: 0.6;
    }

    .target-card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.5rem;
    }

    .target-info {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
    }

    .target-name {
        font-size: 1rem;
        font-weight: 600;
        color: var(--cds-text-01);
    }

    .target-url {
        font-size: 0.8125rem;
        font-family: var(--cds-code-01-font-family);
        color: var(--cds-text-02);
        word-break: break-all;
    }

    .target-badges {
        display: flex;
        gap: 0.25rem;
        flex-shrink: 0;
    }

    .target-desc {
        margin: 0.5rem 0 0 0;
        font-size: 0.8125rem;
        color: var(--cds-text-02);
    }

    .target-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-top: 0.5rem;
        font-size: 0.75rem;
        color: var(--cds-text-03);
    }

    .meta-item code {
        font-family: var(--cds-code-01-font-family);
        background: var(--cds-ui-02);
        padding: 0.0625rem 0.375rem;
        border-radius: 2px;
    }

    .target-actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.75rem;
        border-top: 1px solid var(--cds-ui-03);
        padding-top: 0.75rem;
    }

    .action-btn {
        all: unset;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.3125rem 0.75rem;
        font-size: 0.8125rem;
        color: var(--cds-text-01);
        border: 1px solid var(--cds-ui-04, #8d8d8d);
        border-radius: 4px;
        cursor: pointer;
    }

    .action-btn:hover {
        background: var(--cds-hover-ui);
        border-color: var(--cds-text-01);
    }

    .action-btn:focus-visible {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: 1px;
    }

    .action-btn--danger {
        color: var(--cds-support-01, #fa4d56);
        border-color: color-mix(
            in srgb,
            var(--cds-support-01, #fa4d56) 45%,
            transparent
        );
    }

    .action-btn--danger:hover {
        background: color-mix(
            in srgb,
            var(--cds-support-01, #fa4d56) 12%,
            transparent
        );
        border-color: var(--cds-support-01, #fa4d56);
    }

    /* ── Editor ───────────────────────────────────────────────────────────── */
    .editor {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-height: 24rem;
    }

    .editor-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 0;
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .editor-tab {
        all: unset;
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.8125rem;
        color: var(--cds-text-02);
        cursor: pointer;
        border-bottom: 2px solid transparent;
    }

    .editor-tab:hover {
        color: var(--cds-text-01);
        background: var(--cds-hover-ui);
    }

    .editor-tab.active {
        color: var(--cds-text-01);
        font-weight: 600;
        border-bottom-color: var(--cds-interactive-01);
    }

    .editor-tab-badge {
        font-size: 0.625rem;
        padding: 0.0625rem 0.3125rem;
        border-radius: 8px;
        background: var(--cds-ui-03);
        color: var(--cds-text-02);
    }

    .editor-body {
        flex: 1;
        max-height: 30rem;
        overflow-y: auto;
        padding-right: 0.25rem;
    }

    .editor-form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .form-row {
        display: grid;
        gap: 1rem;
    }

    .form-row--3 {
        grid-template-columns: 1fr 1fr 1fr;
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

    .mono {
        font-family: var(--cds-code-01-font-family, "IBM Plex Mono", monospace);
    }

    /* ── Availability toggle ──────────────────────────────────────────────── */
    .toggle-field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .toggle-btn {
        all: unset;
        display: flex;
        align-items: center;
        gap: 0.625rem;
        box-sizing: border-box;
        width: 100%;
        padding: 0.625rem 0.75rem;
        border: 1px solid var(--cds-ui-03);
        border-left: 3px solid var(--cds-ui-04, #8d8d8d);
        border-radius: 6px;
        background: var(--cds-ui-01);
        cursor: pointer;
    }

    .toggle-btn:hover {
        background: var(--cds-hover-ui);
    }

    .toggle-btn.on {
        border-color: var(--cds-support-02, #24a148);
        border-left-color: var(--cds-support-02, #24a148);
    }

    .toggle-btn:focus-visible {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: 2px;
    }

    .switch-track {
        display: block;
        position: relative;
        width: 2rem;
        height: 1rem;
        flex-shrink: 0;
        border-radius: 0.5rem;
        background: var(--cds-ui-04, #8d8d8d);
        transition: background 0.15s ease;
    }

    .toggle-btn.on .switch-track {
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

    .toggle-btn.on .switch-thumb {
        transform: translateX(1rem);
    }

    .toggle-text {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--cds-text-01);
    }

    .toggle-hint {
        font-size: 0.75rem;
        color: var(--cds-text-03);
    }
</style>
