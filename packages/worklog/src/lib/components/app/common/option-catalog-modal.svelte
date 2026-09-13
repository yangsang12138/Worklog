<!--
  Catalog manager for ticket attributes.

  Priority levels, ticket types and tags are all "a name, a colour, and a list
  order", so one dialog serves all three. It is opened from the entry point
  beside each field in the new-ticket modal, which is what makes the attributes
  configurable *where they are used* instead of only in settings.
-->
<script lang="ts">
    import { Modal, TextInput, Button, Tag } from "carbon-components-svelte";
    import {
        Add,
        ArrowDown,
        ArrowUp,
        Checkmark,
        Close,
        Edit,
        TrashCan,
    } from "carbon-icons-svelte";

    import { untrack } from "svelte";

    import { getWorkspaceShellContext } from "$lib/hooks/workspace-shell-context";
    import * as m from "$lib/paraglide/messages.js";

    type CatalogKind = "priority" | "type" | "tag";

    let {
        open = $bindable(false),
        kind,
    }: {
        open: boolean;
        kind: CatalogKind;
    } = $props();

    const { ticketPrioritiesApi, ticketTypesApi, tagsApi } =
        getWorkspaceShellContext();

    interface Entry {
        id: string;
        name: string;
        color: string;
        isDefault: boolean;
    }

    /** Colours offered to a new entry, cycled by position. */
    const PALETTE = [
        "#da1e28",
        "#ff832b",
        "#f1c21b",
        "#24a148",
        "#007d79",
        "#0f62fe",
        "#8a3ffc",
        "#d02670",
        "#525252",
    ];

    const entries = $derived.by<Entry[]>(() => {
        if (kind === "priority") {
            return ticketPrioritiesApi.priorities.map((priority) => ({
                id: priority.id,
                name: priority.name,
                color: priority.color,
                isDefault: priority.is_default,
            }));
        }
        if (kind === "type") {
            return ticketTypesApi.types.map((type) => ({
                id: type.id,
                name: type.name,
                color: type.color,
                isDefault: type.is_default,
            }));
        }
        return tagsApi.tags.map((tag) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color,
            isDefault: false,
        }));
    });

    const heading = $derived(
        kind === "priority"
            ? m.catalog_title_priority()
            : kind === "type"
              ? m.catalog_title_type()
              : m.catalog_title_tag(),
    );

    const hint = $derived(
        kind === "priority"
            ? m.catalog_hint_priority()
            : kind === "type"
              ? m.catalog_hint_type()
              : m.catalog_hint_tag(),
    );

    const addLabel = $derived(
        kind === "priority"
            ? m.catalog_add_priority()
            : kind === "type"
              ? m.catalog_add_type()
              : m.catalog_add_tag(),
    );

    let draftName = $state("");
    let draftColor = $state(PALETTE[5]);
    let editingId = $state<string | null>(null);
    let editingName = $state("");
    let editingColor = $state("");
    let busy = $state(false);
    let error = $state<string | null>(null);
    /** Entry awaiting delete confirmation, and how many tickets use it. */
    let confirmingId = $state<string | null>(null);
    let confirmingUsage = $state(0);

    // A fresh draft each time the dialog opens, so a cancelled colour or a
    // half-typed name never leaks into the next visit.
    //
    // `open` is the only dependency: reading `entries` here would reset the
    // draft every time the list reloads, wiping what the user just typed.
    $effect(() => {
        if (!open) return;
        untrack(() => {
            draftName = "";
            draftColor = PALETTE[entries.length % PALETTE.length];
            editingId = null;
            confirmingId = null;
            error = null;
        });
    });

    function duplicate(name: string, ignoreId?: string): boolean {
        const needle = name.trim().toLowerCase();
        return entries.some(
            (entry) =>
                entry.id !== ignoreId &&
                entry.name.trim().toLowerCase() === needle,
        );
    }

    async function handleAdd() {
        const name = draftName.trim();
        if (!name) {
            error = m.catalog_error_empty();
            return;
        }
        if (duplicate(name)) {
            error = m.catalog_error_duplicate({ name });
            return;
        }

        busy = true;
        error = null;
        try {
            if (kind === "priority") {
                await ticketPrioritiesApi.create({ name, color: draftColor });
            } else if (kind === "type") {
                await ticketTypesApi.create({
                    name,
                    color: draftColor,
                    icon: null,
                    is_default: false,
                });
            } else {
                await tagsApi.create({ name, color: draftColor });
            }
            draftName = "";
            draftColor = PALETTE[(entries.length + 1) % PALETTE.length];
        } catch (e) {
            error = String(e);
        } finally {
            busy = false;
        }
    }

    function startEdit(entry: Entry) {
        editingId = entry.id;
        editingName = entry.name;
        editingColor = entry.color;
        error = null;
    }

    async function commitEdit() {
        if (!editingId) return;
        const name = editingName.trim();
        if (!name) {
            error = m.catalog_error_empty();
            return;
        }
        if (duplicate(name, editingId)) {
            error = m.catalog_error_duplicate({ name });
            return;
        }

        busy = true;
        error = null;
        try {
            if (kind === "priority") {
                await ticketPrioritiesApi.update(editingId, {
                    name,
                    color: editingColor,
                });
            } else if (kind === "type") {
                await ticketTypesApi.update(editingId, {
                    name,
                    color: editingColor,
                });
            } else {
                await tagsApi.update(editingId, {
                    name,
                    color: editingColor,
                });
            }
            editingId = null;
        } catch (e) {
            error = String(e);
        } finally {
            busy = false;
        }
    }

    /**
     * Ask before deleting, and say how much a priority delete would affect.
     *
     * Deleting a level does not rewrite the tickets that use it — they keep
     * their stored id and fall back to showing it — so the count is the only
     * warning the user gets that the catalog is no longer the whole story.
     */
    async function requestDelete(entry: Entry) {
        error = null;
        confirmingId = entry.id;
        confirmingUsage =
            kind === "priority" ? await ticketPrioritiesApi.usage(entry.id) : 0;
    }

    async function handleDelete(entry: Entry) {
        busy = true;
        error = null;
        try {
            if (kind === "priority") {
                await ticketPrioritiesApi.remove(entry.id);
            } else if (kind === "type") {
                await ticketTypesApi.remove(entry.id);
            } else {
                await tagsApi.remove(entry.id);
            }
            if (editingId === entry.id) editingId = null;
            confirmingId = null;
        } catch (e) {
            error = String(e);
        } finally {
            busy = false;
        }
    }

    async function handleSetDefault(entry: Entry) {
        if (entry.isDefault) return;
        busy = true;
        error = null;
        try {
            if (kind === "priority") {
                await ticketPrioritiesApi.update(entry.id, {
                    is_default: true,
                });
            } else if (kind === "type") {
                await ticketTypesApi.update(entry.id, { is_default: true });
            }
        } catch (e) {
            error = String(e);
        } finally {
            busy = false;
        }
    }

    /**
     * Move a priority one slot up or down.
     *
     * Order is the priority's meaning — it is what "most urgent first" sorts
     * by — so reordering swaps ranks with the neighbour rather than rewriting
     * the whole list.
     */
    async function move(index: number, direction: -1 | 1) {
        const target = index + direction;
        if (target < 0 || target >= entries.length) return;

        const current = ticketPrioritiesApi.priorities[index];
        const neighbour = ticketPrioritiesApi.priorities[target];
        if (!current || !neighbour) return;

        busy = true;
        try {
            await ticketPrioritiesApi.update(current.id, {
                rank: neighbour.rank,
            });
            await ticketPrioritiesApi.update(neighbour.id, {
                rank: current.rank,
            });
        } catch (e) {
            error = String(e);
        } finally {
            busy = false;
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            void (editingId ? commitEdit() : handleAdd());
        }
    }
</script>

<Modal
    bind:open
    size="sm"
    modalHeading={heading}
    primaryButtonText={m.catalog_done()}
    on:click:button--primary={() => (open = false)}
    on:keydown={handleKeydown}
>
    <p class="catalog-hint">{hint}</p>

    {#if error}
        <p class="catalog-error">{error}</p>
    {/if}

    <ul class="catalog-list">
        {#each entries as entry, index (entry.id)}
            <li class="catalog-item">
                {#if editingId === entry.id}
                    <div class="catalog-edit">
                        <input
                            type="color"
                            class="color-input"
                            bind:value={editingColor}
                            aria-label={m.catalog_color()}
                        />
                        <TextInput size="sm" bind:value={editingName} />
                        <Button
                            size="small"
                            kind="ghost"
                            icon={Checkmark}
                            iconDescription={m.modal_save_changes()}
                            disabled={busy}
                            onclick={commitEdit}
                        />
                        <Button
                            size="small"
                            kind="ghost"
                            icon={Close}
                            iconDescription={m.modal_cancel()}
                            onclick={() => (editingId = null)}
                        />
                    </div>
                {:else}
                    <div class="catalog-display">
                        <span
                            class="color-dot"
                            style="background-color: {entry.color}"
                        ></span>
                        <span class="catalog-name">{entry.name}</span>
                        {#if entry.isDefault}
                            <Tag size="sm" type="blue">{m.catalog_default()}</Tag>
                        {/if}
                    </div>
                    <div class="catalog-actions">
                        {#if confirmingId === entry.id}
                            {#if confirmingUsage > 0}
                                <span class="catalog-usage"
                                    >{m.catalog_delete_in_use({
                                        count: confirmingUsage,
                                    })}</span
                                >
                            {/if}
                            <Button
                                size="small"
                                kind="danger"
                                disabled={busy}
                                onclick={() => handleDelete(entry)}
                            >
                                {m.catalog_delete_confirm()}
                            </Button>
                            <Button
                                size="small"
                                kind="ghost"
                                disabled={busy}
                                onclick={() => (confirmingId = null)}
                            >
                                {m.modal_cancel()}
                            </Button>
                        {:else}
                            {#if kind === "priority"}
                                <Button
                                    size="small"
                                    kind="ghost"
                                    icon={ArrowUp}
                                    iconDescription={m.catalog_move_up()}
                                    disabled={busy || index === 0}
                                    onclick={() => move(index, -1)}
                                />
                                <Button
                                    size="small"
                                    kind="ghost"
                                    icon={ArrowDown}
                                    iconDescription={m.catalog_move_down()}
                                    disabled={busy ||
                                        index === entries.length - 1}
                                    onclick={() => move(index, 1)}
                                />
                            {/if}
                            {#if kind !== "tag" && !entry.isDefault}
                                <Button
                                    size="small"
                                    kind="ghost"
                                    onclick={() => handleSetDefault(entry)}
                                    disabled={busy}
                                >
                                    {m.catalog_set_default()}
                                </Button>
                            {/if}
                            <Button
                                size="small"
                                kind="ghost"
                                icon={Edit}
                                iconDescription={m.catalog_rename()}
                                disabled={busy}
                                onclick={() => startEdit(entry)}
                            />
                            <Button
                                size="small"
                                kind="danger-ghost"
                                icon={TrashCan}
                                iconDescription={m.catalog_delete()}
                                disabled={busy}
                                onclick={() => requestDelete(entry)}
                            />
                        {/if}
                    </div>
                {/if}
            </li>
        {:else}
            <li class="catalog-empty">{m.catalog_empty()}</li>
        {/each}
    </ul>

    <div class="catalog-add">
        <input
            type="color"
            class="color-input"
            bind:value={draftColor}
            aria-label={m.catalog_color()}
        />
        <TextInput
            size="sm"
            bind:value={draftName}
            placeholder={m.catalog_new_placeholder()}
            labelText=""
        />
        <Button size="small" icon={Add} disabled={busy} onclick={handleAdd}>
            {addLabel}
        </Button>
    </div>
</Modal>

<style>
    .catalog-hint {
        margin: 0 0 0.75rem;
        font-size: 0.75rem;
        color: var(--cds-text-helper, #6f6f6f);
        line-height: 1.5;
    }

    .catalog-error {
        margin: 0 0 0.75rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.75rem;
        color: var(--cds-support-01, #da1e28);
        background: color-mix(
            in srgb,
            var(--cds-support-01, #da1e28) 10%,
            transparent
        );
        border-radius: 4px;
    }

    .catalog-list {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 16rem;
        overflow-y: auto;
        border: 1px solid var(--cds-ui-03, #e0e0e0);
        border-radius: 4px;
    }

    .catalog-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.25rem 0.5rem;
        min-height: 2.5rem;
        border-bottom: 1px solid var(--cds-ui-03, #e0e0e0);
    }

    .catalog-item:last-child {
        border-bottom: none;
    }

    .catalog-display,
    .catalog-edit {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
    }

    .catalog-edit {
        flex: 1;
    }

    .catalog-edit :global(.bx--text-input) {
        min-width: 8rem;
    }

    .color-dot {
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .color-input {
        width: 1.75rem;
        height: 1.75rem;
        padding: 0;
        border: 1px solid var(--cds-ui-04, #8d8d8d);
        border-radius: 2px;
        background: none;
        cursor: pointer;
        flex-shrink: 0;
    }

    .catalog-name {
        font-size: 0.8125rem;
        color: var(--cds-text-01, #161616);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .catalog-actions {
        display: flex;
        align-items: center;
        flex-shrink: 0;
    }

    .catalog-usage {
        font-size: 0.6875rem;
        color: var(--cds-text-helper, #6f6f6f);
        margin-right: 0.5rem;
        white-space: nowrap;
    }

    .catalog-empty {
        padding: 1rem;
        text-align: center;
        font-size: 0.75rem;
        color: var(--cds-text-helper, #6f6f6f);
        list-style: none;
    }

    .catalog-add {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid var(--cds-ui-03, #e0e0e0);
    }

    .catalog-add :global(.bx--form-item) {
        flex: 1;
        margin: 0;
    }
</style>
