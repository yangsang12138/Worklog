<!--
  The date half of the schedule row, built the same way as the hour and minute
  boxes beside it:

    点击框内   — a text box: type the date. "2025-06-15", "2025/6/15" and
                 "20250615" are all the same day and all accepted; text that is
                 not a real calendar day reverts when you leave.
    点击按钮   — opens a month calendar, which is the better tool when you are
                 browsing rather than typing.

  A native `<input type="date">` does both of those too, but only in the way the
  host engine decides — its segments differ per platform and typing into them is
  fiddly in the WebViews this app runs in. Owning the control keeps the two
  affordances explicit and keeps the behaviour identical everywhere.

  Like the time boxes, it has no disabled state: a field that cannot be filled
  is a dead end.
-->
<script lang="ts">
    import { Calendar } from "carbon-icons-svelte";

    import { getReactiveLocale } from "$lib/hooks/locale.svelte";
    import {
        dateKeyOf,
        monthGrid,
        normalizeDateInput,
        parseStoredDateTime,
    } from "$lib/utils/ticket-datetime";
    import * as m from "$lib/paraglide/messages.js";

    let {
        value = "",
        label,
        placeholder = "YYYY-MM-DD",
        onPick,
    }: {
        /** The committed date, "YYYY-MM-DD", or "" when unset. */
        value: string;
        label: string;
        placeholder?: string;
        onPick: (value: string) => void;
    } = $props();

    const locale = $derived(getReactiveLocale());

    let root = $state<HTMLElement | null>(null);
    let open = $state(false);
    /** First of the month on show. */
    let viewMonth = $state(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

    /**
     * Text being typed, or null when the box mirrors the committed value — the
     * same split the time boxes use, so normalising cannot rewrite the text
     * under the caret while someone is still typing a date.
     */
    let typed = $state<string | null>(null);
    const draft = $derived(typed ?? value);

    const todayKey = $derived(dateKeyOf(new Date()));

    const monthLabel = $derived(
        viewMonth.toLocaleDateString(locale, { year: "numeric", month: "long" }),
    );

    /** Weekday initials, Monday first, in the active language. */
    const weekdayLabels = $derived.by(() => {
        const format = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
        // 2024-01-01 was a Monday, so this walks Mon..Sun.
        return Array.from({ length: 7 }, (_, i) =>
            format.format(new Date(2024, 0, 1 + i)),
        );
    });

    const weeks = $derived(monthGrid(viewMonth.getFullYear(), viewMonth.getMonth()));

    function commit(raw: string): boolean {
        const normalized = normalizeDateInput(raw);
        if (normalized === null) return false;
        onPick(normalized);
        return true;
    }

    function handleInput(event: Event & { currentTarget: HTMLInputElement }) {
        const raw = event.currentTarget.value;
        typed = raw;

        // Commit as soon as what is typed is a whole date; a half-typed one
        // ("2025-06") commits nothing and is simply still being typed.
        commit(raw);
    }

    function handleBlur() {
        const raw = draft;
        typed = null;
        // Unusable text disappears: the box falls back to the stored date.
        commit(raw);
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Enter") {
            // Never let Enter reach the ticket dialog's buttons.
            event.stopPropagation();
            return;
        }

        if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            open = false;
        }
    }

    function showMonthOf(value: string) {
        const parsed = parseStoredDateTime(value) ?? new Date();
        viewMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    }

    function toggle() {
        if (open) {
            open = false;
            return;
        }
        showMonthOf(value);
        open = true;
    }

    function stepMonth(delta: number) {
        viewMonth = new Date(
            viewMonth.getFullYear(),
            viewMonth.getMonth() + delta,
            1,
        );
    }

    function pick(key: string) {
        typed = null;
        onPick(key);
        open = false;
    }

    function handleWindowMouseDown(event: MouseEvent) {
        if (!open || !root) return;
        if (!root.contains(event.target as Node)) open = false;
    }
</script>

<svelte:window onmousedown={handleWindowMouseDown} />

<div class="df" bind:this={root}>
    <input
        class="df-input"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        spellcheck="false"
        maxlength="10"
        {placeholder}
        value={draft}
        aria-label={label}
        oninput={handleInput}
        onblur={handleBlur}
        onkeydown={handleKeydown}
    />

    <button
        type="button"
        class="df-toggle"
        aria-label={m.schedule_pick_date()}
        aria-expanded={open}
        title={m.schedule_pick_date()}
        tabindex="-1"
        onmousedown={(e) => e.preventDefault()}
        onclick={toggle}
    >
        <Calendar size={13} />
    </button>

    {#if open}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            class="df-calendar"
            role="group"
            aria-label={m.schedule_pick_date()}
            onkeydown={handleKeydown}
        >
            <div class="df-cal-head">
                <button
                    type="button"
                    class="df-nav"
                    aria-label={m.schedule_prev_month()}
                    title={m.schedule_prev_month()}
                    onclick={() => stepMonth(-1)}
                >
                    ‹
                </button>
                <span class="df-cal-title">{monthLabel}</span>
                <button
                    type="button"
                    class="df-nav"
                    aria-label={m.schedule_next_month()}
                    title={m.schedule_next_month()}
                    onclick={() => stepMonth(1)}
                >
                    ›
                </button>
            </div>

            <div class="df-week">
                {#each weekdayLabels as weekday (weekday)}
                    <span class="df-weekday">{weekday}</span>
                {/each}
            </div>

            {#each weeks as week, weekIndex (weekIndex)}
                <div class="df-week">
                    {#each week as cell (cell.key)}
                        <button
                            type="button"
                            class="df-day"
                            class:df-day--outside={!cell.inMonth}
                            class:df-day--today={cell.key === todayKey}
                            class:df-day--selected={cell.key === value}
                            aria-current={cell.key === value ? "date" : undefined}
                            onclick={() => pick(cell.key)}
                        >
                            {cell.date.getDate()}
                        </button>
                    {/each}
                </div>
            {/each}

            <div class="df-cal-foot">
                <button
                    type="button"
                    class="df-today"
                    onclick={() => pick(todayKey)}
                >
                    {m.schedule_today()}
                </button>
            </div>
        </div>
    {/if}
</div>

<style>
    .df {
        position: relative;
        display: flex;
        align-items: stretch;
        flex: 1;
        min-width: 0;
        height: 1.75rem;
        background: var(--cds-field-01, #f4f4f4);
        border: 1px solid var(--cds-ui-04, #8d8d8d);
        border-radius: 2px;
    }

    .df:focus-within {
        outline: 2px solid var(--cds-interactive-01, #0f62fe);
        outline-offset: -2px;
    }

    .df-input {
        box-sizing: border-box;
        flex: 1;
        min-width: 0;
        padding: 0 0.25rem 0 0.5rem;
        background: transparent;
        border: none;
        outline: none;
        font-family: inherit;
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums;
        color: var(--cds-text-primary, #161616);
    }

    .df-input::placeholder {
        color: var(--cds-text-placeholder, #a8a8a8);
    }

    .df-toggle {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        flex-shrink: 0;
        color: var(--cds-text-helper, #6f6f6f);
        cursor: pointer;
    }

    .df-toggle:hover {
        background: var(--cds-hover-ui, #e5e5e5);
        color: var(--cds-text-primary, #161616);
    }

    /* ── Month calendar ────────────────────────────────────────────────────── */
    .df-calendar {
        position: absolute;
        top: calc(100% + 0.125rem);
        left: 0;
        z-index: 9500;
        width: 15rem;
        padding: 0.5rem;
        background: var(--cds-ui-01, #ffffff);
        border: 1px solid var(--cds-ui-03, #e0e0e0);
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
    }

    .df-cal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.25rem;
        margin-bottom: 0.375rem;
    }

    .df-cal-title {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--cds-text-primary, #161616);
    }

    .df-nav {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 2px;
        font-size: 0.875rem;
        color: var(--cds-text-secondary, #525252);
        cursor: pointer;
    }

    .df-nav:hover {
        background: var(--cds-hover-ui, #e5e5e5);
        color: var(--cds-text-primary, #161616);
    }

    .df-week {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 0.0625rem;
    }

    .df-weekday {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 1.25rem;
        font-size: 0.625rem;
        font-weight: 600;
        color: var(--cds-text-helper, #6f6f6f);
    }

    .df-day {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 1.5rem;
        border-radius: 2px;
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums;
        color: var(--cds-text-primary, #161616);
        cursor: pointer;
    }

    .df-day:hover {
        background: var(--cds-hover-ui, #e5e5e5);
    }

    .df-day--outside {
        color: var(--cds-text-placeholder, #a8a8a8);
    }

    .df-day--today {
        font-weight: 700;
        box-shadow: inset 0 0 0 1px var(--cds-interactive-01, #0f62fe);
    }

    .df-day--selected {
        background: var(--cds-interactive-01, #0f62fe);
        color: #ffffff;
    }

    .df-cal-foot {
        display: flex;
        justify-content: flex-end;
        margin-top: 0.375rem;
        padding-top: 0.375rem;
        border-top: 1px solid var(--cds-ui-03, #e0e0e0);
    }

    .df-today {
        all: unset;
        padding: 0.1875rem 0.5rem;
        border-radius: 2px;
        font-size: 0.6875rem;
        color: var(--cds-interactive-01, #0f62fe);
        cursor: pointer;
    }

    .df-today:hover {
        background: var(--cds-hover-ui, #e5e5e5);
    }
</style>
