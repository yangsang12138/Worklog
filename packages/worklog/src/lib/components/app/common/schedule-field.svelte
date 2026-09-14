<!--
  The ticket's time interval — one row, one result.

  A ticket's start and due are two halves of one answer ("when does this
  happen"), so they are shown as a single line rather than two independent
  fields, and they are set one of two ways:

    相对时间 — pick a range (within 3 days, half a month, or a custom length
               precise to the minute). The start is now and the due is the
               range's far point; the range name is kept only for this dialog
               session, because what gets saved is always an exact time.
    绝对时间 — pick the start and the due directly, to the minute, with "now"
               for the start.

  Both modes write the same two stored values, so nothing downstream (Gantt,
  calendar, sorting, push) has to know which way they were chosen.
-->
<script lang="ts">
    import { untrack } from "svelte";
    import { ContentSwitcher, Switch } from "carbon-components-svelte";
    import { Close, SettingsAdjust, Time } from "carbon-icons-svelte";
    import DateField from "./date-field.svelte";
    import TimePartField from "./time-part-field.svelte";

    import { getReactiveLocale } from "$lib/hooks/locale.svelte";
    import {
        RELATIVE_PRESETS,
        applyScheduleRange,
        combineDateAndTime,
        describeSchedule,
        hourAndMinute,
        isEndBeforeStart,
        nowStored,
        toDatePart,
        todayDatePart,
        toTimePart,
        type RelativeSpec,
        type RelativeUnit,
    } from "$lib/utils/ticket-datetime";
    import * as m from "$lib/paraglide/messages.js";

    let {
        start = $bindable(""),
        due = $bindable(""),
        disabled = false,
    }: {
        start: string;
        due: string;
        disabled?: boolean;
    } = $props();

    const locale = $derived(getReactiveLocale());

    let open = $state(false);
    let container = $state<HTMLElement | null>(null);
    let panel = $state<HTMLElement | null>(null);
    /** Anchored to the right edge when the panel would leave the viewport. */
    let alignRight = $state(false);

    let mode = $state<0 | 1>(0); // 0 = relative, 1 = absolute

    /**
     * The range this value came from, if it came from one.
     *
     * Session-only: it labels the result bar and highlights the chosen preset,
     * but it is deliberately not stored — a range is resolved to real times the
     * moment it is applied.
     */
    let appliedRange = $state<{ id: string; label: string } | null>(null);

    let customAmount = $state(3);
    let customUnit = $state<RelativeUnit>("day");

    /**
     * The absolute controls, as separate parts.
     *
     * Hours and minutes are distinct controls, so they are distinct state, and
     * every one of them stays editable at all times. The fallback hours are
     * what an untouched picker shows: 09:00 for a start and 18:00 for a due,
     * which are far more useful first guesses for a work log than the midnight
     * a blank field would otherwise imply. Picking a time with no date yet
     * adopts today (see `setTimePart`).
     */
    const DEFAULT_START_HOUR = "09";
    const DEFAULT_DUE_HOUR = "18";

    let startDate = $state("");
    let startHour = $state(DEFAULT_START_HOUR);
    let startMinute = $state("00");
    let dueDate = $state("");
    let dueHour = $state(DEFAULT_DUE_HOUR);
    let dueMinute = $state("00");

    const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
    const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

    const display = $derived(describeSchedule(start, due, locale));
    const backwards = $derived(isEndBeforeStart(start, due));
    const hasValue = $derived(Boolean(start) || Boolean(due));

    // Adopt the stored values into the absolute controls — for the dialog
    // reopening on another ticket, for a range being applied, and so on.
    //
    // `start` and `due` are the ONLY things this may depend on. Reading the
    // controls back here (an earlier version compared against `startDate` &c.)
    // makes the effect re-run the instant the user touches a picker and put the
    // old value straight back: the chosen date was erased before `change` could
    // commit it, so picking a date appeared to do nothing at all.
    $effect(() => {
        const nextStart = start;
        const nextDue = due;

        untrack(() => {
            const startParts = hourAndMinute(nextStart, DEFAULT_START_HOUR);
            const dueParts = hourAndMinute(nextDue, DEFAULT_DUE_HOUR);

            startDate = toDatePart(nextStart);
            startHour = startParts.hour;
            startMinute = startParts.minute;
            dueDate = toDatePart(nextDue);
            dueHour = dueParts.hour;
            dueMinute = dueParts.minute;
        });
    });

    // The row spans the dialog, so only a panel reaching past the viewport
    // needs flipping.
    $effect(() => {
        if (!open || !panel) return;
        alignRight = panel.getBoundingClientRect().right > window.innerWidth - 8;
    });

    const unitOptions: Array<{ value: RelativeUnit; label: string }> = [
        { value: "minute", get label() { return m.dt_unit_minute(); } },
        { value: "hour", get label() { return m.dt_unit_hour(); } },
        { value: "day", get label() { return m.dt_unit_day(); } },
        { value: "week", get label() { return m.dt_unit_week(); } },
        { value: "month", get label() { return m.dt_unit_month(); } },
    ];

    function presetLabel(id: string): string {
        switch (id) {
            case "1d":
                return m.dt_preset_1d();
            case "3d":
                return m.dt_preset_3d();
            case "7d":
                return m.dt_preset_7d();
            case "15d":
                return m.dt_preset_half_month();
            default:
                return m.dt_preset_1_month();
        }
    }

    function unitLabel(unit: RelativeUnit): string {
        return (
            unitOptions.find((option) => option.value === unit)?.label ?? unit
        );
    }

    /** Apply a range: start now, due at the range's far point. */
    function applyRange(id: string, spec: RelativeSpec, label: string) {
        const interval = applyScheduleRange(spec);
        start = interval.start;
        due = interval.due;
        appliedRange = { id, label };
    }

    function applyCustomRange() {
        const amount = Math.max(1, Math.floor(Number(customAmount) || 1));
        applyRange("custom", { amount, unit: customUnit }, `${amount} ${unitLabel(customUnit)}`);
    }

    /**
     * Write the absolute controls back to the stored values.
     *
     * Hand-set values are absolute by definition, so any range label is dropped
     * here — the result bar stops claiming it came from a range the user has
     * since edited past.
     *
     * An end only counts when its date exists: an hour on its own is not a
     * moment, so a cleared date clears that end rather than leaving a value
     * behind that the result bar would then have to explain. This is about a
     * date being *cleared*, not about a time being chosen first — that case
     * adopts today.
     */
    function commitAbsolute() {
        start = startDate
            ? combineDateAndTime(startDate, `${startHour}:${startMinute}`)
            : "";
        due = dueDate
            ? combineDateAndTime(dueDate, `${dueHour}:${dueMinute}`)
            : "";
        appliedRange = null;
    }

    /**
     * Adopt a picked or typed date.
     *
     * The date field only ever reports a complete calendar day — it validates
     * what was typed itself — so there is nothing to guard here. Clearing an
     * end is done from the result bar or the panel footer, not by emptying the
     * box, which would be indistinguishable from a half-typed date.
     */
    function setDate(which: "start" | "due", value: string) {
        if (which === "start") startDate = value;
        else dueDate = value;
        commitAbsolute();
    }

    /**
     * Record a chosen hour or minute.
     *
     * The time boxes are never disabled, so this also has to answer "which day
     * is that time on?" when no date is set yet: today. It is the same reading
     * the 18:00 shortcut already uses, and the result bar shows the day it
     * picked, so nothing is hidden. Disabling the boxes until a date existed
     * instead meant a fresh ticket could not be given a time at all.
     */
    function setTimePart(
        which: "start" | "due",
        part: "hour" | "minute",
        value: string,
    ) {
        if (which === "start") {
            if (!startDate) startDate = todayDatePart();
            if (part === "hour") startHour = value;
            else startMinute = value;
        } else {
            if (!dueDate) dueDate = todayDatePart();
            if (part === "hour") dueHour = value;
            else dueMinute = value;
        }
        commitAbsolute();
    }

    function setNow() {
        const now = nowStored();
        const parts = hourAndMinute(now, DEFAULT_START_HOUR);
        startDate = toDatePart(now);
        startHour = parts.hour;
        startMinute = parts.minute;
        commitAbsolute();
    }

    function setDueEndOfDay() {
        if (!dueDate) dueDate = toDatePart(due) || toDatePart(nowStored());
        dueHour = "18";
        dueMinute = "00";
        commitAbsolute();
    }

    function clearAll() {
        start = "";
        due = "";
        appliedRange = null;
    }

    function toggle() {
        if (disabled) return;
        open = !open;
        if (open) {
            // Open on whichever side produced the current value.
            mode = appliedRange ? 0 : 1;
            customAmount = 3;
            customUnit = "day";
        }
    }

    function handleWindowMouseDown(event: MouseEvent) {
        if (!open || !container) return;
        if (!container.contains(event.target as Node)) open = false;
    }

    function handlePanelKeydown(event: KeyboardEvent) {
        // The panel lives inside the ticket modal: Enter must not submit the
        // ticket and Escape must close the panel, not the dialog.
        if (event.key === "Enter" || event.key === "Escape") {
            event.stopPropagation();
            if (event.key === "Escape") open = false;
        }
    }
</script>

<svelte:window onmousedown={handleWindowMouseDown} />

<div class="sc-field" bind:this={container}>
    <div class="sc-label-row">
        <span class="cds--label">{m.schedule_label()}</span>
    </div>

    <div class="sc-control">
        <button
            type="button"
            class="sc-bar"
            class:sc-bar--empty={!hasValue}
            class:sc-bar--invalid={backwards}
            aria-expanded={open}
            {disabled}
            onclick={toggle}
        >
            <Time size={13} />

            {#if hasValue}
                <span
                    class="sc-mode"
                    class:sc-mode--relative={Boolean(appliedRange)}
                >
                    {appliedRange ? m.dt_relative() : m.dt_absolute()}
                </span>
            {/if}

            <span class="sc-result">
                {#if display.kind === "unset"}
                    {m.dt_unset()}
                {:else if display.kind === "start"}
                    {m.schedule_from({ at: display.at })}
                {:else if display.kind === "due"}
                    {m.schedule_until({ at: display.at })}
                {:else}
                    <span class="sc-moment">{display.start}</span>
                    <span class="sc-arrow">→</span>
                    <span class="sc-moment">{display.due}</span>
                {/if}
            </span>

            {#if appliedRange}
                <span class="sc-range">{appliedRange.label}</span>
            {/if}

            <span class="sc-gear"><SettingsAdjust size={13} /></span>
        </button>

        {#if hasValue}
            <button
                type="button"
                class="sc-clear"
                title={m.schedule_clear()}
                aria-label={m.schedule_clear()}
                onclick={clearAll}
            >
                <Close size={14} />
            </button>
        {/if}
    </div>

    {#if backwards}
        <p class="sc-warning">{m.schedule_end_before_start()}</p>
    {/if}

    {#if open}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            class="sc-panel"
            class:sc-panel--right={alignRight}
            role="group"
            aria-label={m.schedule_label()}
            bind:this={panel}
            onkeydown={handlePanelKeydown}
        >
            <ContentSwitcher bind:selectedIndex={mode} size="sm">
                <Switch text={m.dt_relative()} />
                <Switch text={m.dt_absolute()} />
            </ContentSwitcher>

            {#if mode === 0}
                <div class="sc-section">
                    <span class="sc-section-label">{m.schedule_range()}</span>
                    <div class="sc-chips">
                        {#each RELATIVE_PRESETS as preset (preset.id)}
                            <button
                                type="button"
                                class="sc-chip"
                                class:sc-chip--active={appliedRange?.id ===
                                    preset.id}
                                onclick={() =>
                                    applyRange(
                                        preset.id,
                                        { amount: preset.amount, unit: preset.unit },
                                        presetLabel(preset.id),
                                    )}
                            >
                                {presetLabel(preset.id)}
                            </button>
                        {/each}
                    </div>
                </div>

                <div class="sc-section">
                    <span class="sc-section-label">{m.schedule_custom_range()}</span>
                    <div class="sc-custom-row">
                        <label class="sc-custom-field">
                            <span>{m.dt_amount()}</span>
                            <input
                                class="sc-input"
                                type="number"
                                min="1"
                                bind:value={customAmount}
                            />
                        </label>
                        <label class="sc-custom-field">
                            <span>{m.dt_unit()}</span>
                            <select
                                class="sc-input sc-select"
                                bind:value={customUnit}
                            >
                                {#each unitOptions as unit (unit.value)}
                                    <option value={unit.value}
                                        >{unit.label}</option
                                    >
                                {/each}
                            </select>
                        </label>
                        <button
                            type="button"
                            class="sc-apply"
                            onclick={applyCustomRange}
                        >
                            {m.dt_apply()}
                        </button>
                    </div>
                </div>

                <p class="sc-hint">{m.dt_relative_hint()}</p>
            {:else}
                <div class="sc-absolute-row">
                    <span class="sc-absolute-label">{m.schedule_start()}</span>
                    <DateField
                        value={startDate}
                        label={m.schedule_start()}
                        onPick={(value) => setDate("start", value)}
                    />
                    <div class="sc-time">
                        <TimePartField
                            value={startHour}
                            options={HOURS}
                            label={m.schedule_hour()}
                            onPick={(value) =>
                                setTimePart("start", "hour", value)}
                        />
                        <span class="sc-colon">:</span>
                        <TimePartField
                            value={startMinute}
                            options={MINUTES}
                            label={m.schedule_minute()}
                            onPick={(value) =>
                                setTimePart("start", "minute", value)}
                        />
                    </div>
                    <button type="button" class="sc-chip" onclick={setNow}>
                        {m.dt_now()}
                    </button>
                </div>

                <div class="sc-absolute-row">
                    <span class="sc-absolute-label">{m.schedule_end()}</span>
                    <DateField
                        value={dueDate}
                        label={m.schedule_end()}
                        onPick={(value) => setDate("due", value)}
                    />
                    <div class="sc-time">
                        <TimePartField
                            value={dueHour}
                            options={HOURS}
                            label={m.schedule_hour()}
                            onPick={(value) =>
                                setTimePart("due", "hour", value)}
                        />
                        <span class="sc-colon">:</span>
                        <TimePartField
                            value={dueMinute}
                            options={MINUTES}
                            label={m.schedule_minute()}
                            onPick={(value) =>
                                setTimePart("due", "minute", value)}
                        />
                    </div>
                    <button
                        type="button"
                        class="sc-chip"
                        onclick={setDueEndOfDay}
                    >
                        {m.dt_end_of_day()}
                    </button>
                </div>
            {/if}

            {#if backwards}
                <p class="sc-warning">{m.schedule_end_before_start()}</p>
            {/if}

            <div class="sc-footer">
                <button
                    type="button"
                    class="sc-footer-btn"
                    disabled={!hasValue}
                    onclick={clearAll}
                >
                    {m.schedule_clear()}
                </button>
                <button
                    type="button"
                    class="sc-footer-btn sc-footer-btn--primary"
                    onclick={() => (open = false)}
                >
                    {m.schedule_done()}
                </button>
            </div>
        </div>
    {/if}
</div>

<style>
    .sc-field {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
    }

    .sc-label-row :global(.cds--label) {
        margin-bottom: 0.25rem;
        font-size: 0.75rem;
        color: var(--cds-text-secondary, #525252);
    }

    .sc-control {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .sc-bar {
        all: unset;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        box-sizing: border-box;
        flex: 1;
        min-width: 0;
        height: 2rem;
        padding: 0 0.75rem;
        background: var(--cds-field-01, #f4f4f4);
        border: 1px solid var(--cds-ui-04, #8d8d8d);
        border-radius: 2px;
        font-size: 0.75rem;
        color: var(--cds-text-primary, #161616);
        cursor: pointer;
        transition: border-color 70ms ease;
    }

    .sc-bar:hover {
        border-color: var(--cds-ui-05, #161616);
    }

    .sc-bar:focus-visible {
        outline: 2px solid var(--cds-interactive-01, #0f62fe);
        outline-offset: -2px;
    }

    .sc-bar--empty {
        color: var(--cds-text-placeholder, #a8a8a8);
    }

    .sc-bar--invalid {
        border-color: var(--cds-support-03, #f1c21b);
        box-shadow: inset 2px 0 0 var(--cds-support-03, #f1c21b);
    }

    /* How the value was produced, so the mode is not hidden inside the panel. */
    .sc-mode {
        flex-shrink: 0;
        padding: 0.0625rem 0.375rem;
        border-radius: 999px;
        font-size: 0.625rem;
        font-weight: 600;
        background: var(--cds-ui-03, #e0e0e0);
        color: var(--cds-text-secondary, #525252);
    }

    .sc-mode--relative {
        background: color-mix(
            in srgb,
            var(--cds-interactive-01, #0f62fe) 15%,
            transparent
        );
        color: var(--cds-interactive-01, #0f62fe);
    }

    .sc-result {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .sc-moment {
        font-variant-numeric: tabular-nums;
    }

    .sc-arrow {
        color: var(--cds-text-helper, #6f6f6f);
    }

    .sc-range {
        flex-shrink: 0;
        font-size: 0.6875rem;
        color: var(--cds-text-helper, #6f6f6f);
    }

    .sc-gear {
        display: flex;
        align-items: center;
        margin-left: auto;
        flex-shrink: 0;
        color: var(--cds-text-helper, #6f6f6f);
    }

    .sc-clear {
        all: unset;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 2rem;
        height: 2rem;
        border-radius: 2px;
        color: var(--cds-text-helper, #6f6f6f);
        cursor: pointer;
    }

    .sc-clear:hover {
        background: var(--cds-hover-ui, #e5e5e5);
        color: var(--cds-text-primary, #161616);
    }

    .sc-warning {
        margin: 0.375rem 0 0;
        font-size: 0.6875rem;
        color: var(--cds-support-03, #f1c21b);
    }

    /* ── Configuration panel ───────────────────────────────────────────────── */
    .sc-panel {
        position: absolute;
        top: calc(100% + 0.25rem);
        left: 0;
        z-index: 9000;
        width: 26rem;
        max-width: calc(100vw - 3rem);
        padding: 0.875rem;
        background: var(--cds-ui-01, #ffffff);
        border: 1px solid var(--cds-ui-03, #e0e0e0);
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
    }

    .sc-panel--right {
        left: auto;
        right: 0;
    }

    .sc-panel :global(.bx--content-switcher) {
        width: 100%;
        height: 1.75rem;
    }

    .sc-panel :global(.bx--content-switcher-btn) {
        padding-inline: 0.5rem;
        font-size: 0.6875rem;
    }

    .sc-section {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .sc-section-label {
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--cds-text-secondary, #525252);
    }

    .sc-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
    }

    .sc-chip {
        all: unset;
        padding: 0.25rem 0.625rem;
        border: 1px solid var(--cds-ui-04, #8d8d8d);
        border-radius: 999px;
        font-size: 0.6875rem;
        color: var(--cds-text-02, #525252);
        cursor: pointer;
        white-space: nowrap;
        transition:
            background 70ms ease,
            border-color 70ms ease;
    }

    .sc-chip:hover {
        background: var(--cds-hover-ui, #e5e5e5);
        border-color: var(--cds-interactive-03, #0f62fe);
    }

    .sc-chip--active {
        background: var(--cds-interactive-01, #0f62fe);
        border-color: var(--cds-interactive-01, #0f62fe);
        color: #ffffff;
    }

    .sc-custom-row {
        display: flex;
        align-items: flex-end;
        gap: 0.5rem;
    }

    .sc-custom-field {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        font-size: 0.6875rem;
        color: var(--cds-text-helper, #6f6f6f);
    }

    .sc-custom-field:first-child {
        width: 5rem;
    }

    .sc-custom-field:nth-child(2) {
        flex: 1;
    }

    .sc-input {
        box-sizing: border-box;
        width: 100%;
        height: 1.75rem;
        padding: 0 0.5rem;
        background: var(--cds-field-01, #f4f4f4);
        border: 1px solid var(--cds-ui-04, #8d8d8d);
        border-radius: 2px;
        font-family: inherit;
        font-size: 0.75rem;
        color: var(--cds-text-primary, #161616);
        outline: none;
    }

    .sc-input:focus {
        outline: 2px solid var(--cds-interactive-01, #0f62fe);
        outline-offset: -2px;
    }

    .sc-select {
        cursor: pointer;
    }

    .sc-time {
        display: flex;
        align-items: center;
        gap: 0.125rem;
        flex-shrink: 0;
    }

    .sc-colon {
        font-size: 0.75rem;
        color: var(--cds-text-helper, #6f6f6f);
    }

    .sc-apply {
        all: unset;
        padding: 0 0.75rem;
        height: 1.75rem;
        background: var(--cds-interactive-01, #0f62fe);
        color: #fff;
        font-size: 0.6875rem;
        border-radius: 2px;
        cursor: pointer;
        white-space: nowrap;
    }

    .sc-apply:hover {
        background: var(--cds-hover-primary, #0043ce);
    }

    .sc-hint {
        margin: 0;
        font-size: 0.625rem;
        line-height: 1.5;
        color: var(--cds-text-helper, #6f6f6f);
    }

    .sc-absolute-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .sc-absolute-label {
        flex: 0 0 2.25rem;
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--cds-text-secondary, #525252);
    }

    .sc-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--cds-ui-03, #e0e0e0);
    }

    .sc-footer-btn {
        all: unset;
        padding: 0.3125rem 0.875rem;
        border-radius: 2px;
        font-size: 0.75rem;
        color: var(--cds-text-02, #525252);
        cursor: pointer;
    }

    .sc-footer-btn:hover:not([disabled]) {
        background: var(--cds-hover-ui, #e5e5e5);
    }

    .sc-footer-btn[disabled] {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .sc-footer-btn--primary {
        background: var(--cds-interactive-01, #0f62fe);
        color: #ffffff;
    }

    .sc-footer-btn--primary:hover {
        background: var(--cds-hover-primary, #0043ce);
    }
</style>
