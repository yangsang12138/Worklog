<!--
  Workspace switcher — always-visible entry point for changing the active
  workspace. Renders the current workspace name in the toolbar and exposes
  switch / recent / close actions from a dropdown menu.
-->
<script lang="ts">
    import { ChevronDown, Close, FolderOpen, Time } from "carbon-icons-svelte";

    import { getWorkspace, workspaceFolderName } from "$lib/hooks/workspace.svelte";
    import { useWorkspaceActions } from "$lib/hooks/workspace-actions.svelte";
    import * as m from "$lib/paraglide/messages.js";

    const workspace = getWorkspace();
    const actions = useWorkspaceActions();

    let open = $state(false);
    let rootEl = $state<HTMLElement | null>(null);
    let menuEl = $state<HTMLElement | null>(null);
    let triggerEl = $state<HTMLButtonElement | null>(null);

    const name = $derived(workspace.meta?.name || m.settings_default_workspace());
    const path = $derived(workspace.path ?? "");
    // The active workspace is always shown in the header block, so it is
    // filtered out of the quick-switch list.
    const recents = $derived(
        workspace.recents.filter((item) => item !== workspace.path),
    );
    const busy = $derived(workspace.status === "loading");

    function toggle() {
        open = !open;
    }

    function closeMenu() {
        open = false;
    }

    async function handleSwitch() {
        closeMenu();
        await actions.switchWorkspace();
    }

    async function handleOpenPath(target: string) {
        closeMenu();
        await actions.openWorkspaceAt(target);
    }

    async function handleClose() {
        closeMenu();
        await actions.closeWorkspace();
    }

    /** Move focus between menu items (roving focus, as expected of role="menu"). */
    function focusItem(step: number | "first" | "last") {
        const items = Array.from(
            menuEl?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled)',
            ) ?? [],
        );
        if (items.length === 0) return;

        if (step === "first") {
            items[0].focus();
            return;
        }
        if (step === "last") {
            items[items.length - 1].focus();
            return;
        }

        const current = items.indexOf(
            document.activeElement as HTMLButtonElement,
        );
        const next =
            current === -1
                ? step > 0
                    ? 0
                    : items.length - 1
                : (current + step + items.length) % items.length;
        items[next].focus();
    }

    // The dropdown extends below the header band, where the side nav (same
    // z-index, later in DOM order) would paint over it. The `ws-menu-open` flag
    // on <html> lifts the header only while the menu is open — see layout.css.
    $effect(() => {
        const root = document.documentElement;
        root.classList.toggle("ws-menu-open", open);

        return () => root.classList.remove("ws-menu-open");
    });

    // Close on outside click / Escape while the menu is open.
    $effect(() => {
        if (!open) return;

        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (rootEl && target && !rootEl.contains(target)) {
                open = false;
            }
        };
        const onKeydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                open = false;
                triggerEl?.focus();
                return;
            }

            if (event.key === "ArrowDown") {
                event.preventDefault();
                event.stopPropagation();
                focusItem(1);
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                focusItem(-1);
                return;
            }
            if (event.key === "Home") {
                event.preventDefault();
                focusItem("first");
                return;
            }
            if (event.key === "End") {
                event.preventDefault();
                focusItem("last");
            }
        };

        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeydown, true);

        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeydown, true);
        };
    });
</script>

{#if workspace.status === "ready"}
    <div class="ws-switcher" bind:this={rootEl}>
        <button
            bind:this={triggerEl}
            type="button"
            class="ws-trigger"
            class:ws-trigger--open={open}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={m.workspace_switcher_aria_label()}
            title={path}
            onclick={toggle}
        >
            <span class="ws-trigger-icon"><FolderOpen size={16} /></span>
            <span class="ws-trigger-name">{name}</span>
            <span
                class="ws-trigger-chevron"
                class:ws-trigger-chevron--open={open}
            >
                <ChevronDown size={16} />
            </span>
        </button>

        {#if open}
            <div class="ws-menu" role="menu" bind:this={menuEl}>
                <div class="ws-menu-current">
                    <span class="ws-menu-eyebrow">{m.workspace_current()}</span>
                    <span class="ws-menu-name" title={name}>{name}</span>
                    <span class="ws-menu-path" title={path}>{path}</span>
                </div>

                <button
                    type="button"
                    role="menuitem"
                    class="ws-menu-item ws-menu-item--primary"
                    disabled={busy}
                    onclick={handleSwitch}
                >
                    <FolderOpen size={16} />
                    <span class="ws-menu-item-labels">
                        <span class="ws-menu-item-label">{m.workspace_switch()}</span>
                        <span class="ws-menu-item-sub">{m.workspace_switch_subtitle()}</span>
                    </span>
                </button>

                {#if recents.length > 0}
                    <div class="ws-menu-divider"></div>
                    <div class="ws-menu-section">{m.workspace_recent()}</div>
                    {#each recents as recent (recent)}
                        <button
                            type="button"
                            role="menuitem"
                            class="ws-menu-item"
                            title={recent}
                            onclick={() => handleOpenPath(recent)}
                        >
                            <Time size={16} />
                            <span class="ws-menu-item-labels">
                                <span class="ws-menu-item-label"
                                    >{workspaceFolderName(recent)}</span
                                >
                                <span class="ws-menu-item-sub">{recent}</span>
                            </span>
                        </button>
                    {/each}
                {/if}

                <div class="ws-menu-divider"></div>

                <button
                    type="button"
                    role="menuitem"
                    class="ws-menu-item ws-menu-item--danger"
                    onclick={handleClose}
                >
                    <Close size={16} />
                    <span class="ws-menu-item-labels">
                        <span class="ws-menu-item-label">{m.workspace_close()}</span>
                    </span>
                </button>
            </div>
        {/if}
    </div>
{/if}

<style>
    .ws-switcher {
        position: relative;
        display: flex;
        align-items: center;
        /* Clear the app logo (absolutely positioned, 100px wide, 1rem margins)
           that shares this slot, leaving a comfortable gap after it. */
        margin-left: 8.5rem;
    }

    .ws-trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        max-width: 15rem;
        height: 2.25rem;
        padding: 0 0.625rem;
        border: 1px solid transparent;
        border-radius: 0.25rem;
        background: transparent;
        color: inherit;
        font-family: inherit;
        font-size: 0.875rem;
        font-weight: 500;
        line-height: 1;
        cursor: pointer;
        transition: background-color 110ms cubic-bezier(0.2, 0, 0.38, 0.9);
    }

    .ws-trigger:hover,
    .ws-trigger--open {
        background: color-mix(in srgb, currentColor 14%, transparent);
    }

    .ws-trigger:focus-visible {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: -2px;
    }

    .ws-trigger-icon,
    .ws-trigger-chevron {
        display: inline-flex;
        flex-shrink: 0;
        align-items: center;
        opacity: 0.85;
    }

    .ws-trigger-chevron {
        transition: transform 110ms cubic-bezier(0.2, 0, 0.38, 0.9);
    }

    .ws-trigger-chevron--open {
        transform: rotate(180deg);
    }

    .ws-trigger-name {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    /* ── Dropdown ─────────────────────────────────────────────── */
    .ws-menu {
        position: absolute;
        top: calc(100% + 0.5rem);
        left: 0;
        z-index: 8500;
        display: flex;
        flex-direction: column;
        min-width: 20rem;
        max-width: 26rem;
        padding: 0.375rem;
        border: 1px solid var(--cds-ui-03, #e0e0e0);
        border-radius: 0.5rem;
        background: var(--cds-ui-background, #ffffff);
        color: var(--cds-text-01, #161616);
        box-shadow:
            0 12px 32px rgba(0, 0, 0, 0.24),
            0 2px 8px rgba(0, 0, 0, 0.12);
        animation: ws-menu-in 120ms cubic-bezier(0.2, 0, 0.38, 0.9);
    }

    @keyframes ws-menu-in {
        from {
            opacity: 0;
            transform: translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .ws-menu-current {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding: 0.5rem 0.75rem 0.625rem;
    }

    .ws-menu-eyebrow,
    .ws-menu-section {
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--cds-text-02, #525252);
    }

    .ws-menu-name {
        overflow: hidden;
        font-size: 0.875rem;
        font-weight: 600;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .ws-menu-path {
        overflow: hidden;
        font-size: 0.75rem;
        color: var(--cds-text-02, #525252);
        /* Long paths are truncated from the left so the folder stays readable. */
        direction: rtl;
        unicode-bidi: plaintext;
        text-align: left;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .ws-menu-section {
        padding: 0.375rem 0.75rem 0.25rem;
    }

    .ws-menu-divider {
        height: 1px;
        margin: 0.25rem 0.25rem;
        background: var(--cds-ui-03, #e0e0e0);
    }

    .ws-menu-item {
        display: flex;
        align-items: flex-start;
        gap: 0.625rem;
        width: 100%;
        padding: 0.5rem 0.75rem;
        border: none;
        border-radius: 0.375rem;
        background: transparent;
        color: inherit;
        font-family: inherit;
        font-size: 0.875rem;
        text-align: left;
        cursor: pointer;
        transition: background-color 110ms cubic-bezier(0.2, 0, 0.38, 0.9);
    }

    .ws-menu-item:hover {
        background: var(--cds-hover-ui, #e5e5e5);
    }

    .ws-menu-item:focus-visible {
        outline: 2px solid var(--cds-focus, #0f62fe);
        outline-offset: -2px;
    }

    .ws-menu-item:disabled {
        color: var(--cds-disabled-02, #c6c6c6);
        cursor: not-allowed;
    }

    .ws-menu-item--danger:hover {
        color: var(--cds-support-01, #da1e28);
    }

    .ws-menu-item :global(svg) {
        flex-shrink: 0;
        margin-top: 0.0625rem;
        opacity: 0.85;
    }

    .ws-menu-item-labels {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
    }

    .ws-menu-item-label {
        overflow: hidden;
        font-weight: 500;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .ws-menu-item-sub {
        overflow: hidden;
        font-size: 0.75rem;
        color: var(--cds-text-02, #525252);
        white-space: nowrap;
        text-overflow: ellipsis;
    }
</style>
