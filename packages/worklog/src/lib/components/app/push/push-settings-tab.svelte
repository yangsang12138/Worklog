<script lang="ts">
    import { onMount } from "svelte";
    import { Modal, InlineLoading, Tag } from "carbon-components-svelte";
    import {
        Add,
        TrashCan,
        Edit,
        SendAlt,
        Download,
        Upload,
    } from "carbon-icons-svelte";
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
    import {
        exportPushTargetsToFile,
        pickImportFile,
        applyImport,
    } from "$lib/push/push-config-io";
    import { getDb } from "$lib/db";
    import {
        DEFAULT_SUCCESS_CHECK,
        evaluateSuccess,
        parseSuccessCheck,
        serializeSuccessCheck,
        summarizeSuccessCheck,
        type PushSuccessCheck,
        type PushSuccessOp,
    } from "$lib/push/success-check";
    import { notifications } from "$lib/hooks/notifications.svelte";
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
        | "variables"
        | "success";

    // Kept out of the template: Svelte would read `{{...}}` as an expression.
    const URL_VAR_HINT = '{{变量Key}}';

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
    /** How the target's response decides success — '' equivalent when mode is "http". */
    let formSuccessCheck = $state<PushSuccessCheck>({ ...DEFAULT_SUCCESS_CHECK });
    /** Scratch response body for the "试一下" box on the 成功判定 tab. */
    let sampleResponse = $state("");

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
        formSuccessCheck = { ...DEFAULT_SUCCESS_CHECK };
        sampleResponse = "";
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
        formSuccessCheck = parseSuccessCheck(target.success_check);
        sampleResponse = "";
        editingTargetId = target.id;
        editorTab = "basic";
        showModal = true;
    }

    async function handleSave() {
        // Validate first and jump to the tab that owns the offending field, so
        // a disabled-looking save never leaves the user guessing.
        const problem = validateForm();
        if (problem) {
            editorTab = problem.tab;
            notifications.add({
                kind: "error",
                title: "无法保存",
                subtitle: problem.message,
                timeout: 5000,
            });
            return;
        }

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
                success_check: serializeSuccessCheck(formSuccessCheck),
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

            notifications.add({
                kind: "success",
                title: editingTargetId ? "已保存" : "已创建",
                subtitle: `推送目标「${input.name}」已保存。`,
                timeout: 3000,
            });
            showModal = false;
        } catch (e) {
            console.error("Failed to save push target:", e);
            notifications.add({
                kind: "error",
                title: "保存失败",
                subtitle: e instanceof Error ? e.message : String(e),
                timeout: 8000,
            });
        } finally {
            saving = false;
        }
    }

    /** First blocking validation problem, together with the tab that owns it. */
    function validateForm(): { tab: EditorTab; message: string } | null {
        if (!formName.trim())
            return { tab: "basic", message: "请填写「目标名称」。" };
        if (!formEndpointUrl.trim())
            return {
                tab: "params",
                message: "请填写「请求地址 (Endpoint URL)」。",
            };
        if (formSuccessCheck.mode === "json" && !formSuccessCheck.path.trim())
            return {
                tab: "success",
                message: "成功判定选了「响应 JSON 字段」，请填写字段路径（如 __sys__.status）。",
            };
        return null;
    }

    async function handleDelete(id: string) {
        try {
            await push.deleteTarget(id);
            deleteConfirmId = null;
        } catch (e) {
            console.error("Failed to delete push target:", e);
        }
    }

    // ── Import / export ──────────────────────────────────────────────────────
    let ioBusy = $state(false);

    async function handleExportAll() {
        if (push.targets.length === 0 || ioBusy) return;
        ioBusy = true;
        try {
            const dateSuffix = new Date().toISOString().split("T")[0];
            const ok = await exportPushTargetsToFile(
                push.targets,
                `worklog-push-targets_${dateSuffix}`,
                "导出推送目标配置",
                "Worklog 推送配置",
            );
            if (ok) {
                notifications.add({
                    kind: "success",
                    title: "导出成功",
                    subtitle: `已导出 ${push.targets.length} 个推送目标配置。`,
                    timeout: 3000,
                });
            }
        } catch (e) {
            notifications.add({
                kind: "error",
                title: "导出失败",
                subtitle: e instanceof Error ? e.message : String(e),
                timeout: 5000,
            });
        } finally {
            ioBusy = false;
        }
    }

    async function handleExportOne(target: PushTarget) {
        if (ioBusy) return;
        ioBusy = true;
        try {
            const ok = await exportPushTargetsToFile(
                [target],
                `push-target_${target.name}`,
                "导出推送目标配置",
                "Worklog 推送配置",
            );
            if (ok) {
                notifications.add({
                    kind: "success",
                    title: "导出成功",
                    subtitle: `已导出「${target.name}」的配置。`,
                    timeout: 3000,
                });
            }
        } catch (e) {
            notifications.add({
                kind: "error",
                title: "导出失败",
                subtitle: e instanceof Error ? e.message : String(e),
                timeout: 5000,
            });
        } finally {
            ioBusy = false;
        }
    }

    async function handleImport() {
        if (ioBusy || !workspace.path) return;
        ioBusy = true;
        try {
            const incoming = await pickImportFile(
                "导入推送目标配置",
                "Worklog 推送配置",
            );
            if (!incoming) return; // cancelled

            if (incoming.length === 0) {
                notifications.add({
                    kind: "warning",
                    title: "没有可导入的配置",
                    subtitle: "文件中未找到带名称与请求地址的有效目标。",
                    timeout: 5000,
                });
                return;
            }

            const db = await getDb(workspace.path);
            const summary = await applyImport(db, incoming);
            await push.loadTargets();

            const parts: string[] = [];
            if (summary.created > 0) parts.push(`新增 ${summary.created} 个`);
            if (summary.updated > 0) parts.push(`更新 ${summary.updated} 个`);
            notifications.add({
                kind: "success",
                title: "导入完成",
                subtitle: parts.join("，") || "没有变化",
                timeout: 5000,
            });
        } catch (e) {
            notifications.add({
                kind: "error",
                title: "导入失败",
                subtitle: e instanceof Error ? e.message : String(e),
                timeout: 6000,
            });
        } finally {
            ioBusy = false;
        }
    }

    // ── Derived ──────────────────────────────────────────────────────────────
    const usedVariableKeys = $derived(
        [...formBindings, ...formQueryParams]
            .filter((b) => b.kind === "variable" && b.variable_key)
            .map((b) => b.variable_key as string),
    );

    /** Human-readable list of what is still missing (shown above the editor). */
    const missingRequired = $derived.by(() => {
        const out: string[] = [];
        if (!formName.trim()) out.push("目标名称");
        if (!formEndpointUrl.trim()) out.push("请求地址");
        return out;
    });

    /**
     * Live verdict for the scratch response on the 成功判定 tab: a rule can be
     * proven there before it is saved (and before a real push is risked).
     * Assumes HTTP 200 — the interesting case is a body that says "rejected".
     */
    const sampleVerdict = $derived(
        sampleResponse.trim() === ""
            ? null
            : evaluateSuccess(formSuccessCheck, 200, sampleResponse),
    );

    function patchSuccessCheck(patch: Partial<PushSuccessCheck>) {
        formSuccessCheck = { ...formSuccessCheck, ...patch };
    }

    const OP_OPTIONS: { value: PushSuccessOp; label: string }[] = [
        { value: "eq", label: "等于" },
        { value: "ne", label: "不等于" },
        { value: "in", label: "属于（逗号分隔）" },
        { value: "exists", label: "存在即可" },
        { value: "truthy", label: "为真（非 0/非空）" },
        { value: "regex", label: "匹配正则" },
    ];

    const TAB_ITEMS: { id: EditorTab; label: string }[] = [
        { id: "basic", label: "基本信息" },
        { id: "sources", label: "字段来源" },
        { id: "headers", label: "请求头" },
        { id: "params", label: "URL 与参数" },
        { id: "payload", label: "请求体字段" },
        { id: "variables", label: "推送变量" },
        { id: "success", label: "成功判定" },
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
            <div class="section-actions">
                <button
                    type="button"
                    class="action-btn"
                    disabled={ioBusy}
                    onclick={handleImport}
                >
                    <Upload size={14} />
                    导入配置
                </button>
                <button
                    type="button"
                    class="action-btn"
                    disabled={ioBusy || push.targets.length === 0}
                    onclick={handleExportAll}
                >
                    <Download size={14} />
                    导出全部
                </button>
                <button type="button" class="primary-btn" onclick={openNewModal}>
                    <Add size={14} />
                    新增目标
                </button>
            </div>
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
                            <span
                                class="meta-item"
                                class:meta-item--rule={!!target.success_check}
                                title="推送成功/失败的判定标准"
                            >
                                判定: {summarizeSuccessCheck(
                                    parseSuccessCheck(target.success_check),
                                )}
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
                                class="action-btn"
                                disabled={ioBusy}
                                onclick={() => handleExportOne(target)}
                            >
                                <Download size={14} />
                                导出
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
        bind:open={showModal}
        primaryButtonText={editingTargetId ? "保存更改" : "创建目标"}
        secondaryButtonText="取消"
        on:click:button--secondary={() => (showModal = false)}
        on:click:button--primary={handleSave}
        primaryButtonDisabled={saving}
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
                {#if missingRequired.length > 0}
                    <div class="required-banner">
                        还需填写：{missingRequired.join("、")}
                    </div>
                {/if}

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

                        <p class="form-note">
                            请求地址与查询参数在「URL 与参数」页签配置。
                        </p>

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
                    <div class="params-tab">
                        <div class="url-block">
                            <label class="field">
                                <span class="field-label">请求地址 (Endpoint URL) *</span>
                                <input
                                    class="field-input mono"
                                    class:invalid={!formEndpointUrl.trim()}
                                    type="text"
                                    placeholder="https://ticket.example.com/api/issues"
                                    bind:value={formEndpointUrl}
                                />
                            </label>
                            {#if !formEndpointUrl.trim()}
                                <p class="url-warn">
                                    请填写请求地址，推送时需要它来发起 POST 请求。
                                </p>
                            {:else}
                                <p class="url-hint">
                                    值里可以引用推送变量，写成 <code>{URL_VAR_HINT}</code>。
                                </p>
                            {/if}
                        </div>

                        <div class="params-divider"></div>

                        <PushPayloadBuilder
                            bind:bindings={formQueryParams}
                            variables={formVariables}
                            sourceConfig={formSourceConfig}
                            mode="query"
                        />
                    </div>
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
                {:else if editorTab === "success"}
                    <div class="success-tab">
                        <p class="form-note">
                            目标系统经常在 HTTP 200 的响应体里拒绝提交（例如
                            <code>__sys__.status = -1</code>）。不配规则时任何 2xx
                            都会记为成功、工单卡片徽标变绿，但远端可能什么都没建。
                        </p>

                        <label class="field">
                            <span class="field-label">判定方式</span>
                            <select
                                class="field-input"
                                value={formSuccessCheck.mode}
                                onchange={(e) =>
                                    patchSuccessCheck({
                                        mode: e.currentTarget
                                            .value as PushSuccessCheck["mode"],
                                    })}
                            >
                                <option value="http">
                                    HTTP 状态码（2xx 即视为受理成功）
                                </option>
                                <option value="json">
                                    响应 JSON 字段（推荐）
                                </option>
                            </select>
                        </label>

                        {#if formSuccessCheck.mode === "json"}
                            <div class="form-row form-row--3">
                                <label class="field">
                                    <span class="field-label">字段路径 *</span>
                                    <input
                                        class="field-input mono"
                                        type="text"
                                        placeholder="__sys__.status"
                                        value={formSuccessCheck.path}
                                        oninput={(e) =>
                                            patchSuccessCheck({
                                                path: e.currentTarget.value,
                                            })}
                                    />
                                </label>
                                <label class="field">
                                    <span class="field-label">比较方式</span>
                                    <select
                                        class="field-input"
                                        value={formSuccessCheck.op}
                                        onchange={(e) =>
                                            patchSuccessCheck({
                                                op: e.currentTarget
                                                    .value as PushSuccessOp,
                                            })}
                                    >
                                        {#each OP_OPTIONS as o}
                                            <option value={o.value}>
                                                {o.label}
                                            </option>
                                        {/each}
                                    </select>
                                </label>
                                <label class="field">
                                    <span class="field-label">期望值</span>
                                    <input
                                        class="field-input mono"
                                        type="text"
                                        placeholder="0"
                                        value={formSuccessCheck.value}
                                        oninput={(e) =>
                                            patchSuccessCheck({
                                                value: e.currentTarget.value,
                                            })}
                                    />
                                </label>
                            </div>

                            <div class="form-row form-row--3">
                                <label class="field">
                                    <span class="field-label">
                                        消息字段（可选）
                                    </span>
                                    <input
                                        class="field-input mono"
                                        type="text"
                                        placeholder="__sys__.msg"
                                        value={formSuccessCheck.message_path}
                                        oninput={(e) =>
                                            patchSuccessCheck({
                                                message_path:
                                                    e.currentTarget.value,
                                            })}
                                    />
                                </label>
                                <label class="field">
                                    <span class="field-label">
                                        响应中无此路径时
                                    </span>
                                    <select
                                        class="field-input"
                                        value={formSuccessCheck.when_missing}
                                        onchange={(e) =>
                                            patchSuccessCheck({
                                                when_missing: e.currentTarget
                                                    .value as PushSuccessCheck["when_missing"],
                                            })}
                                    >
                                        <option value="fail">
                                            判为失败（推荐）
                                        </option>
                                        <option value="http">
                                            按 HTTP 状态码判定
                                        </option>
                                    </select>
                                </label>
                                <label class="field">
                                    <span class="field-label">
                                        响应不是 JSON 时
                                    </span>
                                    <select
                                        class="field-input"
                                        value={formSuccessCheck.when_not_json}
                                        onchange={(e) =>
                                            patchSuccessCheck({
                                                when_not_json:
                                                    e.currentTarget
                                                        .value as PushSuccessCheck["when_not_json"],
                                            })}
                                    >
                                        <option value="fail">
                                            判为失败（推荐）
                                        </option>
                                        <option value="http">
                                            按 HTTP 状态码判定
                                        </option>
                                    </select>
                                </label>
                            </div>

                            <p class="form-note">
                                当前规则：<code
                                    >{summarizeSuccessCheck(
                                        formSuccessCheck,
                                    )}</code
                                >
                            </p>

                            <!-- Prove the rule before saving it -->
                            <div class="rule-test">
                                <span class="field-label">
                                    试一下（粘贴一段响应体，按 HTTP 200 判定）
                                </span>
                                <textarea
                                    class="field-input mono"
                                    rows="4"
                                    placeholder={'{"__sys__":{"status":0,"msg":"提交成功"}}'}
                                    bind:value={sampleResponse}
                                ></textarea>
                                {#if sampleVerdict}
                                    <p
                                        class="rule-test-result"
                                        class:ok={sampleVerdict.ok}
                                        class:bad={!sampleVerdict.ok}
                                    >
                                        {sampleVerdict.ok
                                            ? "判定：成功"
                                            : "判定：失败"}
                                        · {sampleVerdict.reason}
                                    </p>
                                {/if}
                            </div>
                        {:else}
                            <p class="form-note">
                                当前规则：HTTP 2xx 即视为受理成功（不校验响应体）。
                                远端在响应体里拒绝提交时，这里会看不出问题。
                            </p>
                        {/if}
                    </div>
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
        on:close={() => (deleteConfirmId = null)}
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

    .section-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
    }

    .section-actions .action-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
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

    /* A configured success rule is the thing that stops 200-but-rejected pushes
       from being reported as successes, so it gets to stand out. */
    .meta-item--rule {
        color: var(--cds-link-01, #78a9ff);
        font-family: var(--cds-code-01-font-family);
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

    .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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

    .required-banner {
        margin-bottom: 0.75rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.8125rem;
        color: var(--cds-support-03, #f1c21b);
        background: color-mix(
            in srgb,
            var(--cds-support-03, #f1c21b) 12%,
            transparent
        );
        border-left: 3px solid var(--cds-support-03, #f1c21b);
        border-radius: 2px;
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

    /* ── URL 与参数 tab ───────────────────────────────────────────────────── */
    .params-tab {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .url-block {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .url-block .field-input.invalid {
        border-bottom-color: var(--cds-support-01, #fa4d56);
    }

    .url-hint {
        margin: 0;
        font-size: 0.75rem;
        color: var(--cds-text-03);
    }

    .url-hint code {
        font-family: var(--cds-code-01-font-family);
        background: var(--cds-ui-02);
        padding: 0.0625rem 0.25rem;
        border-radius: 2px;
    }

    .url-warn {
        margin: 0;
        font-size: 0.75rem;
        color: var(--cds-support-01, #fa4d56);
    }

    .params-divider {
        height: 1px;
        background: var(--cds-ui-03);
        margin: 0.25rem 0;
    }

    .form-note {
        margin: 0;
        font-size: 0.75rem;
        color: var(--cds-text-03);
    }

    /* ── 成功判定 tab ─────────────────────────────────────────────────────── */
    .success-tab {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .success-tab code {
        font-family: var(--cds-code-01-font-family);
        background: var(--cds-ui-02);
        padding: 0.0625rem 0.25rem;
        border-radius: 2px;
        color: var(--cds-text-02);
    }

    .rule-test {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 0.75rem;
        background: var(--cds-ui-02);
        border-radius: 4px;
    }

    .rule-test textarea {
        height: auto;
        padding: 0.5rem 0.625rem;
        line-height: 1.45;
        resize: vertical;
    }

    .rule-test-result {
        margin: 0;
        font-size: 0.8125rem;
        word-break: break-word;
        color: var(--cds-text-02);
    }

    .rule-test-result.ok {
        color: var(--cds-support-02, #24a148);
    }

    .rule-test-result.bad {
        color: var(--cds-support-01, #fa4d56);
    }
</style>
