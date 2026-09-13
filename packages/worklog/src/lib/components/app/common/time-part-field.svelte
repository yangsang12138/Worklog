<!--
  One number in a time — an hour or a minute.

  A `<select>` forces you to find the value in a list, which is the wrong trade
  for 60 minutes. So this is a combobox with both halves of that job split
  exactly as the two affordances suggest:

    点击框内     — a plain text box: type the number, and it commits as soon as
                   what you typed is a real value ("7" counts as 07).
    点击箭头     — opens the full list, with the current value marked, for
                   choosing instead of typing.

  Invalid text is never guessed at: the field shows what you typed while you are
  in it, and reverts to the last good value when you leave.

  It is always editable — no `disabled` state exists. An earlier version greyed
  these out until a date was chosen, which left a fresh ticket with no way to
  enter a time at all.
-->
<script lang="ts">
    import { ChevronDown } from "carbon-icons-svelte";

    import { normalizeTimePart } from "$lib/utils/ticket-datetime";

    let {
        value = "",
        options,
        label,
        onPick,
    }: {
        /** The committed value, e.g. "09". */
        value: string;
        /** Every value the list offers, in order, e.g. "00".."23". */
        options: string[];
        label: string;
        onPick: (value: string) => void;
    } = $props();

    const max = $derived(Number(options[options.length - 1] ?? 0));

    let root = $state<HTMLElement | null>(null);
    let input = $state<HTMLInputElement | null>(null);
    let list = $state<HTMLElement | null>(null);

    let open = $state(false);
    let highlighted = $state(-1);

    /**
     * Text being typed, or null when the box mirrors the committed value.
     *
     * This is what keeps typing and outside updates from fighting: while the
     * user is entering something the box shows their text verbatim (so
     * normalising "7" to "07" cannot rewrite it under the caret), and the
     * moment they leave — or pick from the list — it goes back to mirroring the
     * value. A copy in `$state` with an effect to sync it would need that
     * effect to read what it writes, which is exactly how the picker stopped
     * saving dates in the first place.
     */
    let typed = $state<string | null>(null);
    const draft = $derived(typed ?? value);

    function normalize(raw: string): string | null {
        return normalizeTimePart(raw, max);
    }

    function handleInput(event: Event & { currentTarget: HTMLInputElement }) {
        const raw = event.currentTarget.value;
        typed = raw;

        // Commit only what is already a real value, so an in-between keystroke
        // ("1" on the way to "14") stores something valid rather than nothing.
        const normalized = normalize(raw);
        if (normalized !== null) onPick(normalized);
    }

    function handleBlur() {
        const normalized = normalize(draft);

        // Leaving the box hands it back to the committed value: a normalised
        // reading is stored, and unusable text simply disappears rather than
        // being guessed at ("75" minutes must not become 59).
        typed = null;
        if (normalized !== null) onPick(normalized);
    }

    function openList() {
        open = true;
        highlighted = Math.max(0, options.indexOf(value));
        void Promise.resolve().then(() => {
            list
                ?.querySelector<HTMLElement>("[data-highlighted]")
                ?.scrollIntoView({ block: "nearest" });
        });
    }

    function toggleList() {
        if (open) open = false;
        else openList();
    }

    function pick(next: string) {
        typed = null;
        onPick(next);
        open = false;
        // Focus returns to the box so the next Tab carries on from here rather
        // than from the top of the dialog.
        input?.focus();
    }

    function move(step: number) {
        if (!open) {
            openList();
            return;
        }
        const last = options.length - 1;
        highlighted = Math.min(last, Math.max(0, highlighted + step));
        list
            ?.querySelector<HTMLElement>("[data-highlighted]")
            ?.scrollIntoView({ block: "nearest" });
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            move(event.key === "ArrowDown" ? 1 : -1);
            return;
        }

        if (event.key === "Enter") {
            // Never let Enter reach the ticket dialog's buttons.
            event.stopPropagation();
            if (open && highlighted >= 0) {
                event.preventDefault();
                pick(options[highlighted]);
            }
            return;
        }

        if (event.key === "Escape" && open) {
            // Close the list and stop there: the panel has its own Escape.
            event.preventDefault();
            event.stopPropagation();
            open = false;
        }
    }

    function handleWindowMouseDown(event: MouseEvent) {
        if (!open || !root) return;
        if (!root.contains(event.target as Node)) open = false;
    }
</script>

<svelte:window onmousedown={handleWindowMouseDown} />

<div class="tp" bind:this={root}>
    <input
        class="tp-input"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        spellcheck="false"
        maxlength="2"
        bind:this={input}
        value={draft}
        aria-label={label}
        oninput={handleInput}
        onblur={handleBlur}
        onkeydown={handleKeydown}
    />

    <button
        type="button"
        class="tp-toggle"
        aria-label={label}
        aria-expanded={open}
        title={label}
        tabindex="-1"
        onmousedown={(e) => e.preventDefault()}
        onclick={toggleList}
    >
        <ChevronDown size={12} />
    </button>

    {#if open}
        <div class="tp-list" bind:this={list}>
            {#each options as option, index (option)}
                <button
                    type="button"
                    class="tp-option"
                    class:tp-option--current={option === value}
                    class:tp-option--highlighted={index === highlighted}
                    data-highlighted={index === highlighted ? "" : undefined}
                    onclick={() => pick(option)}
                >
                    {option}
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .tp {
        position: relative;
        display: flex;
        align-items: stretch;
        flex-shrink: 0;
        height: 1.75rem;
        background: var(--cds-field-01, #f4f4f4);
        border: 1px solid var(--cds-ui-04, #8d8d8d);
        border-radius: 2px;
    }

    .tp:focus-within {
        outline: 2px solid var(--cds-interactive-01, #0f62fe);
        outline-offset: -2px;
    }

    .tp-input {
        box-sizing: border-box;
        width: 2.25rem;
        padding: 0 0 0 0.375rem;
        background: transparent;
        border: none;
        outline: none;
        font-family: inherit;
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums;
        color: var(--cds-text-primary, #161616);
    }

    .tp-toggle {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.125rem;
        flex-shrink: 0;
        color: var(--cds-text-helper, #6f6f6f);
        cursor: pointer;
    }

    .tp-toggle:hover {
        background: var(--cds-hover-ui, #e5e5e5);
        color: var(--cds-text-primary, #161616);
    }

    .tp-list {
        position: absolute;
        top: calc(100% + 0.125rem);
        left: 0;
        z-index: 9500;
        min-width: 3.25rem;
        max-height: 9rem;
        overflow-y: auto;
        padding: 0.125rem;
        background: var(--cds-ui-01, #ffffff);
        border: 1px solid var(--cds-ui-03, #e0e0e0);
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
    }

    .tp-option {
        all: unset;
        display: block;
        box-sizing: border-box;
        width: 100%;
        padding: 0.25rem 0.5rem;
        border-radius: 2px;
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums;
        color: var(--cds-text-primary, #161616);
        cursor: pointer;
    }

    .tp-option--highlighted {
        background: var(--cds-hover-ui, #e5e5e5);
    }

    .tp-option--current {
        font-weight: 600;
        color: var(--cds-interactive-01, #0f62fe);
    }
</style>
