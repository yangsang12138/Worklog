<script lang="ts">
    import { InlineLoading, Tag, Button } from "carbon-components-svelte";
    import { Renew, SendAlt, Warning, Checkmark } from "carbon-icons-svelte";
    import { getWorkspace } from "$lib/hooks/workspace.svelte";
    import { getPushHook } from "$lib/push/push-hook.svelte";
    import { getDb, TicketRepo } from "$lib/db";

    interface Props {
        boardId: string;
    }

    let { boardId }: Props = $props();

    const workspace = getWorkspace();
    const push = getPushHook(() => workspace.path);

    let statusFilter = $state<string>("all");
    let ticketsMap = $state<Record<string, string>>({});

    // Load push records when board changes
    $effect(() => {
        if (workspace.path && boardId) {
            void push.loadRecords({ board_id: boardId });
            void loadTickets();
        }
    });

    async function loadTickets() {
        if (!workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            const tickets = await TicketRepo.listAllTickets(db);
            ticketsMap = Object.fromEntries(tickets.map((t: any) => [t.id, t.title]));
        } catch {
            ticketsMap = {};
        }
    }

    function handleRefresh() {
        void push.loadRecords({ board_id: boardId });
    }

    const filteredRecords = $derived(
        statusFilter === "all"
            ? push.records
            : push.records.filter((r) => r.status === statusFilter),
    );

    function statusTagColor(status: string): "green" | "red" | "warm-gray" {
        if (status === "success") return "green";
        if (status === "failed") return "red";
        return "warm-gray";
    }

    function statusLabel(status: string): string {
        if (status === "success") return "成功";
        if (status === "failed") return "失败";
        return "待推送";
    }

    function formatDuration(ms: number | null): string {
        if (ms === null || ms === undefined) return "-";
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    }

    function formatTimestamp(ts: string): string {
        const d = new Date(ts);
        return d.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
</script>

<div class="push-record-board">
    <header class="record-header">
        <h2>远程推送记录</h2>
        <div class="header-actions">
            <select
                class="filter-select"
                aria-label="筛选状态"
                bind:value={statusFilter}
            >
                <option value="all">全部状态</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
                <option value="pending">待推送</option>
            </select>
            <Button
                kind="ghost"
                size="small"
                icon={Renew}
                onclick={handleRefresh}
            >
                刷新
            </Button>
        </div>
    </header>

    {#if push.loading}
        <div class="loading-wrap">
            <InlineLoading description="正在加载推送记录..." />
        </div>
    {:else if filteredRecords.length === 0}
        <div class="empty-state">
            <SendAlt size={32} />
            <p>暂无推送记录</p>
            <span class="empty-hint">从工单菜单中选择「远程推送」来推送数据。</span>
        </div>
    {:else}
        <div class="records-table-wrap">
            <table class="push-records-table">
                <thead>
                    <tr>
                        <th>工单 ID</th>
                        <th>状态</th>
                        <th>推送时间</th>
                        <th>耗时</th>
                        <th>响应码</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    {#each filteredRecords as record (record.id)}
                        <tr>
                            <td>
                                <span class="ticket-link">#{record.ticket_id}</span>
                                {#if ticketsMap[record.ticket_id]}
                                    <span class="ticket-title-cell">{ticketsMap[record.ticket_id]}</span>
                                {/if}
                            </td>
                            <td>
                                <Tag type={statusTagColor(record.status)} size="sm">
                                    {statusLabel(record.status)}
                                </Tag>
                            </td>
                            <td>
                                <span class="timestamp">{formatTimestamp(record.created_at)}</span>
                            </td>
                            <td>
                                <span class="duration">{formatDuration(record.duration_ms)}</span>
                            </td>
                            <td>
                                {#if record.response_status}
                                    <code class="status-code">{record.response_status}</code>
                                {:else}
                                    <span class="no-value">-</span>
                                {/if}
                            </td>
                            <td class="action-cell">
                                {#if record.error_message}
                                    <span class="error-tip" title={record.error_message}>
                                        <Warning size={14} />
                                    </span>
                                {:else if record.status === "success"}
                                    <Checkmark size={14} color="var(--cds-support-02)" />
                                {:else if record.status === "failed"}
                                    <Button
                                        kind="ghost"
                                        size="small"
                                        icon={Renew}
                                        iconDescription="重新推送"
                                    >
                                        重试
                                    </Button>
                                {/if}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>

<style>
    .push-record-board {
        padding: 1rem;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: auto;
    }

    .record-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;
        flex-shrink: 0;
    }

    .record-header h2 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .filter-select {
        height: 2rem;
        padding: 0 0.5rem;
        font-size: 0.8125rem;
        font-family: inherit;
        color: var(--cds-text-01);
        background: var(--cds-field-01);
        border: none;
        border-bottom: 1px solid var(--cds-ui-04, #8d8d8d);
        outline: none;
    }

    .filter-select:focus {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: -2px;
    }

    .loading-wrap {
        display: flex;
        justify-content: center;
        padding: 3rem;
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 3rem 1rem;
        color: var(--cds-text-02);
        text-align: center;
    }

    .empty-hint {
        font-size: 0.8125rem;
        opacity: 0.7;
    }

    .records-table-wrap {
        flex: 1;
        overflow: auto;
    }

    .push-records-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8125rem;
    }

    .push-records-table thead {
        position: sticky;
        top: 0;
        z-index: 1;
    }

    .push-records-table th {
        text-align: left;
        padding: 0.625rem 0.75rem;
        font-weight: 600;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--cds-text-02);
        background: var(--cds-ui-background);
        border-bottom: 1px solid var(--cds-ui-03);
        white-space: nowrap;
    }

    .push-records-table td {
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--cds-ui-03);
        color: var(--cds-text-01);
        vertical-align: middle;
    }

    .push-records-table tbody tr:hover {
        background: var(--cds-hover-ui);
    }

    .ticket-link {
        font-family: var(--cds-code-01-font-family);
        font-size: 0.75rem;
        color: var(--cds-interactive-01);
        margin-right: 0.5rem;
    }

    .ticket-title-cell {
        font-size: 0.8125rem;
        color: var(--cds-text-01);
    }

    .timestamp {
        font-size: 0.75rem;
        color: var(--cds-text-02);
    }

    .duration {
        font-size: 0.75rem;
        font-family: var(--cds-code-01-font-family);
        color: var(--cds-text-02);
    }

    .status-code {
        font-family: var(--cds-code-01-font-family);
        font-size: 0.75rem;
        background: var(--cds-ui-02);
        padding: 0.0625rem 0.375rem;
        border-radius: 2px;
    }

    .no-value {
        color: var(--cds-text-03);
    }

    .action-cell {
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .error-tip {
        cursor: help;
        color: var(--cds-support-01);
        display: inline-flex;
        align-items: center;
    }
</style>