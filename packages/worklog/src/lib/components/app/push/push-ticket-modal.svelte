<script lang="ts">
    import { onMount } from "svelte";
    import { Modal, InlineNotification, Loading } from "carbon-components-svelte";
    import { Checkmark, Warning, View } from "carbon-icons-svelte";
    import type { Ticket } from "$lib/components/app/types";
    import type {
        PushTarget,
        PushResult,
        PushPreview,
        PushVariableValue,
    } from "$lib/push/types";
    import { getWorkspace } from "$lib/hooks/workspace.svelte";
    import { getPushHook, PushTargetRepo } from "$lib/push";
    import {
        parseVariables,
        initialVariableValues,
    } from "$lib/push/field-catalog";
    import { getDb } from "$lib/db";

    interface Props {
        ticket: Ticket;
        open: boolean;
        onClose: () => void;
        onResult?: (result: PushResult) => void;
    }

    let { ticket, open, onClose, onResult }: Props = $props();

    const workspace = getWorkspace();
    const push = getPushHook(() => workspace.path);

    let targets = $state<PushTarget[]>([]);
    let selectedTargetId = $state("");
    let variableValues = $state<Record<string, PushVariableValue>>({});
    let preview = $state<PushPreview | null>(null);
    let previewLoading = $state(false);
    let showPreview = $state(false);
    let pushing = $state(false);
    let result = $state<PushResult | null>(null);
    let loadError = $state<string | null>(null);

    // ── Derived ──────────────────────────────────────────────────────────────
    const selectedTarget = $derived(
        targets.find((t) => t.id === selectedTargetId) ?? null,
    );

    const varDefs = $derived(
        selectedTarget ? parseVariables(selectedTarget.variables) : [],
    );

    /** Snapshot so the preview effect re-runs on any variable edit. */
    const varSnapshot = $derived(JSON.stringify(variableValues));

    const missingRequired = $derived(preview?.missingVariables ?? []);

    const missingLabels = $derived(
        missingRequired.map((key) => {
            const def = varDefs.find((d) => d.key === key);
            return def?.label || key;
        }),
    );

    const canPush = $derived(
        !!selectedTarget && !pushing && missingRequired.length === 0,
    );

    // ── Load targets on mount (component is created per open) ────────────────
    onMount(() => {
        void loadTargets();
    });

    async function loadTargets() {
        loadError = null;
        try {
            if (!workspace.path) return;
            const db = await getDb(workspace.path);
            const all = await PushTargetRepo.list(db);
            targets = all.filter((t) => t.enabled === 1);
            if (targets.length > 0) {
                selectedTargetId = targets[0].id;
            }
        } catch (e) {
            console.error("[push-modal] Failed to load targets:", e);
            loadError = e instanceof Error ? e.message : String(e);
            targets = [];
        }
    }

    // Reset variable values whenever the chosen target changes.
    $effect(() => {
        const target = selectedTarget;
        if (!target) {
            variableValues = {};
            return;
        }
        variableValues = initialVariableValues(parseVariables(target.variables)) as Record<
            string,
            PushVariableValue
        >;
    });

    // Rebuild the request preview whenever target or variable values change.
    $effect(() => {
        const target = selectedTarget;
        const _snap = varSnapshot;
        if (!target) {
            preview = null;
            return;
        }
        void runPreview(target);
    });

    async function runPreview(target: PushTarget) {
        previewLoading = true;
        try {
            preview = await push.previewPush(ticket, target, variableValues);
        } finally {
            previewLoading = false;
        }
    }

    // ── Variable setters ─────────────────────────────────────────────────────
    function setVariable(key: string, value: PushVariableValue) {
        variableValues = { ...variableValues, [key]: value };
    }

    function toggleMulti(key: string, value: string, checked: boolean) {
        const current = variableValues[key];
        const arr = Array.isArray(current) ? [...current] : [];
        const next = checked
            ? Array.from(new Set([...arr, value]))
            : arr.filter((v) => v !== value);
        setVariable(key, next);
    }

    // ── Actions ──────────────────────────────────────────────────────────────
    async function handlePush() {
        if (!selectedTarget) return;
        pushing = true;
        result = null;
        try {
            const pushResult = await push.pushTicket(
                ticket,
                selectedTarget.id,
                variableValues,
            );
            result = pushResult;
            onResult?.(pushResult);
        } catch (e) {
            result = {
                success: false,
                record: null as unknown as PushResult["record"],
                message: e instanceof Error ? e.message : String(e),
            };
        } finally {
            pushing = false;
        }
    }

    function handleClose() {
        result = null;
        onClose();
    }
</script>

{#if open}
    <Modal
        size="lg"
        {open}
        primaryButtonText={result?.success ? "完成" : pushing ? "推送中..." : "确认推送"}
        secondaryButtonText={result ? "关闭" : "取消"}
        primaryButtonDisabled={result?.success ? false : !canPush}
        on:click:button--secondary={handleClose}
        on:click:button--primary={result?.success ? handleClose : handlePush}
        on:close={handleClose}
    >
        <h3 slot="heading">远程推送工单</h3>

        <div class="push-modal">
            <!-- Ticket under push -->
            <div class="ticket-info">
                <span class="ticket-id-label">#{ticket.id}</span>
                <span class="ticket-title-label">{ticket.title}</span>
            </div>

            {#if result}
                <!-- Result -->
                <div class="result-banner" class:success={result.success}>
                    {#if result.success}
                        <Checkmark size={20} />
                        <div>
                            <strong>推送成功</strong>
                            <p>{result.message}</p>
                        </div>
                    {:else}
                        <Warning size={20} />
                        <div>
                            <strong>推送失败</strong>
                            <p>{result.message}</p>
                        </div>
                    {/if}
                </div>

                {#if result.record?.request_body}
                    <details class="payload-details">
                        <summary>查看实际发送的请求体</summary>
                        <pre class="payload-pre">{JSON.stringify(
                                JSON.parse(result.record.request_body),
                                null,
                                2,
                            )}</pre>
                    </details>
                {/if}
            {:else}
                {#if loadError}
                    <InlineNotification
                        kind="error"
                        title="加载推送目标失败"
                        subtitle={loadError}
                        hideCloseButton
                    />
                {:else if targets.length === 0}
                    <InlineNotification
                        kind="info"
                        title="暂无可用的推送目标"
                        subtitle="请先在「设置 > 远程推送」中配置并启用一个推送目标。"
                        hideCloseButton
                    />
                {:else}
                    <!-- Target picker -->
                    <label class="field">
                        <span class="field-label">推送目标</span>
                        <select
                            class="field-input"
                            bind:value={selectedTargetId}
                        >
                            {#each targets as t}
                                <option value={t.id}>{t.name}</option>
                            {/each}
                        </select>
                    </label>

                    {#if selectedTarget}
                        <p class="target-endpoint">
                            <code>{selectedTarget.http_method}</code>
                            {selectedTarget.endpoint_url}
                        </p>
                    {/if}

                    <!-- Variables -->
                    {#if varDefs.length > 0}
                        <section class="section">
                            <h4 class="section-title">
                                推送参数
                                <span class="section-hint">
                                    这些值只在本次推送中使用，用于填充目标系统要求的字段
                                </span>
                            </h4>

                            <div class="var-list">
                                {#each varDefs as def (def.key)}
                                    <div class="var-row">
                                        <label class="field" for="var-{def.key}">
                                            <span class="field-label">
                                                {def.label || def.key}
                                                {#if def.required}
                                                    <span class="required">*</span>
                                                {/if}
                                                <span class="var-key">({def.key})</span>
                                            </span>

                                            {#if def.type === "textarea"}
                                                <textarea
                                                    id="var-{def.key}"
                                                    class="field-input"
                                                    rows="3"
                                                    placeholder={def.placeholder ??
                                                        ""}
                                                    value={String(
                                                        variableValues[
                                                            def.key
                                                        ] ?? "",
                                                    )}
                                                    oninput={(e) =>
                                                        setVariable(
                                                            def.key,
                                                            e.currentTarget
                                                                .value,
                                                        )}
                                                ></textarea>
                                            {:else if def.type === "select"}
                                                <select
                                                    id="var-{def.key}"
                                                    class="field-input"
                                                    value={String(
                                                        variableValues[
                                                            def.key
                                                        ] ?? "",
                                                    )}
                                                    onchange={(e) =>
                                                        setVariable(
                                                            def.key,
                                                            e.currentTarget
                                                                .value,
                                                        )}
                                                >
                                                    <option value="">
                                                        请选择…
                                                    </option>
                                                    {#each def.options ??
                                                        [] as opt}
                                                        <option
                                                            value={opt.value}
                                                        >
                                                            {opt.label}
                                                        </option>
                                                    {/each}
                                                </select>
                                            {:else if def.type === "multiselect"}
                                                <div class="multi-list">
                                                    {#each def.options ?? [] as opt}
                                                        <label class="native-checkbox">
                                                            <input
                                                                type="checkbox"
                                                                checked={Array.isArray(
                                                                    variableValues[
                                                                        def.key
                                                                    ],
                                                                ) &&
                                                                    (
                                                                        variableValues[
                                                                            def
                                                                                .key
                                                                        ] as string[]
                                                                    ).includes(
                                                                        opt.value,
                                                                    )}
                                                                onchange={(e) =>
                                                                    toggleMulti(
                                                                        def.key,
                                                                        opt.value,
                                                                        e
                                                                            .currentTarget
                                                                            .checked,
                                                                    )}
                                                            />
                                                            <span>{opt.label}</span>
                                                        </label>
                                                    {/each}
                                                </div>
                                            {:else if def.type === "boolean"}
                                                <label class="native-checkbox">
                                                    <input
                                                        type="checkbox"
                                                        checked={variableValues[
                                                            def.key
                                                        ] === true}
                                                        onchange={(e) =>
                                                            setVariable(
                                                                def.key,
                                                                e.currentTarget
                                                                    .checked,
                                                            )}
                                                    />
                                                    <span>是</span>
                                                </label>
                                            {:else}
                                                <input
                                                    id="var-{def.key}"
                                                    class="field-input"
                                                    type={def.type === "number"
                                                        ? "number"
                                                        : def.type === "date"
                                                          ? "date"
                                                          : "text"}
                                                    placeholder={def.placeholder ??
                                                        ""}
                                                    value={String(
                                                        variableValues[
                                                            def.key
                                                        ] ?? "",
                                                    )}
                                                    oninput={(e) =>
                                                        setVariable(
                                                            def.key,
                                                            e.currentTarget
                                                                .value,
                                                        )}
                                                />
                                            {/if}
                                        </label>
                                    </div>
                                {/each}
                            </div>
                        </section>
                    {/if}

                    <!-- Missing required warning -->
                    {#if missingLabels.length > 0}
                        <InlineNotification
                            kind="warning"
                            lowContrast
                            title="还有必填参数未填写"
                            subtitle={missingLabels.join("、")}
                            hideCloseButton
                        />
                    {/if}

                    <!-- Preview -->
                    <section class="section">
                        <button
                            type="button"
                            class="preview-toggle"
                            onclick={() => (showPreview = !showPreview)}
                        >
                            <View size={14} />
                            {showPreview ? "收起请求预览" : "查看请求预览"}
                        </button>

                        {#if showPreview}
                            {#if previewLoading}
                                <Loading
                                    small
                                    withOverlay={false}
                                    description="正在生成预览..."
                                />
                            {:else if preview}
                                <div class="preview">
                                    <div class="preview-line">
                                        <span class="preview-label">地址</span>
                                        <code class="preview-value"
                                            >{preview.method} {preview.url}</code
                                        >
                                    </div>
                                    <div class="preview-line">
                                        <span class="preview-label">请求头</span>
                                        <pre class="payload-pre">{JSON.stringify(
                                                preview.headers,
                                                null,
                                                2,
                                            )}</pre>
                                    </div>
                                    <div class="preview-line">
                                        <span class="preview-label">请求体</span>
                                        <pre class="payload-pre">{preview.body}</pre>
                                    </div>
                                </div>
                            {/if}
                        {/if}
                    </section>
                {/if}
            {/if}

            {#if pushing}
                <Loading withOverlay={false} description="正在推送..." />
            {/if}
        </div>
    </Modal>
{/if}

<style>
    .push-modal {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-height: 32rem;
        overflow-y: auto;
        padding-right: 0.25rem;
    }

    .ticket-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem;
        background: var(--cds-ui-01);
        border-radius: 4px;
    }

    .ticket-id-label {
        font-family: var(--cds-code-01-font-family);
        font-size: 0.75rem;
        color: var(--cds-text-02);
    }

    .ticket-title-label {
        font-weight: 500;
        color: var(--cds-text-01);
    }

    /* ── Result ───────────────────────────────────────────────────────────── */
    .result-banner {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1rem;
        border-radius: 6px;
        background: color-mix(in srgb, var(--cds-support-01) 12%, transparent);
        color: var(--cds-support-01);
    }

    .result-banner.success {
        background: color-mix(in srgb, var(--cds-support-02) 12%, transparent);
        color: var(--cds-support-02);
    }

    .result-banner strong {
        display: block;
        margin-bottom: 0.25rem;
    }

    .result-banner p {
        margin: 0;
        font-size: 0.8125rem;
        opacity: 0.9;
        word-break: break-word;
    }

    /* ── Fields ───────────────────────────────────────────────────────────── */
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

    .required {
        color: var(--cds-support-01);
        margin-left: 0.125rem;
    }

    .var-key {
        font-weight: 400;
        color: var(--cds-text-03);
        font-family: var(--cds-code-01-font-family);
        margin-left: 0.25rem;
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

    .target-endpoint {
        margin: -0.5rem 0 0 0;
        font-size: 0.75rem;
        color: var(--cds-text-03);
        word-break: break-all;
    }

    .target-endpoint code {
        font-family: var(--cds-code-01-font-family);
        background: var(--cds-ui-02);
        padding: 0.0625rem 0.3125rem;
        border-radius: 2px;
        margin-right: 0.25rem;
    }

    /* ── Sections ─────────────────────────────────────────────────────────── */
    .section {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .section-title {
        margin: 0;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--cds-text-01);
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.5rem;
    }

    .section-hint {
        font-weight: 400;
        font-size: 0.75rem;
        color: var(--cds-text-03);
    }

    .var-list {
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
        padding: 0.75rem;
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        background: var(--cds-ui-01);
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

    .multi-list {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 0.5rem;
        background: var(--cds-field-01);
        border-radius: 4px;
    }

    /* ── Preview ──────────────────────────────────────────────────────────── */
    .preview-toggle {
        all: unset;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
        color: var(--cds-link-01, #78a9ff);
        cursor: pointer;
        align-self: flex-start;
    }

    .preview-toggle:hover {
        text-decoration: underline;
    }

    .preview {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.5rem;
    }

    .preview-line {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
    }

    .preview-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cds-text-02);
    }

    .preview-value {
        font-size: 0.75rem;
        font-family: var(--cds-code-01-font-family);
        word-break: break-all;
        color: var(--cds-text-01);
    }

    .payload-pre {
        margin: 0;
        padding: 0.5rem;
        background: var(--cds-ui-02);
        border-radius: 4px;
        font-size: 0.75rem;
        font-family: var(--cds-code-01-font-family);
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 14rem;
        overflow-y: auto;
        color: var(--cds-text-01);
    }

    .payload-details {
        font-size: 0.8125rem;
    }

    .payload-details summary {
        cursor: pointer;
        color: var(--cds-link-01, #78a9ff);
        margin-bottom: 0.5rem;
    }
</style>
