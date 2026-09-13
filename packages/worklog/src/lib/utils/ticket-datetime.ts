/**
 * Ticket start/due values.
 *
 * A stored value is a *local wall-clock* string with minute precision:
 *
 *     YYYY-MM-DDTHH:mm
 *
 * Legacy rows hold a date-only `YYYY-MM-DD`. Both forms are parsed here by
 * hand: `new Date("2025-01-04")` is parsed as UTC midnight by the language, so
 * a naive parse would shift a date-only value to the previous day for anyone
 * west of Greenwich. Everything downstream (Gantt, calendar, sorting, push)
 * can keep using `new Date(value)`; only the paths that must agree on "which
 * local day is this" go through these helpers.
 *
 * Nothing here imports Svelte or the locale hook: the locale is a parameter, so
 * the rules below (range → interval, how an interval reads, whether it is
 * backwards) are plain functions that can be tested directly.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

export type RelativeUnit = "minute" | "hour" | "day" | "week" | "month";

export interface RelativeSpec {
    amount: number;
    unit: RelativeUnit;
}

/**
 * The quick picks offered for a relative time.
 *
 * These describe an offset from *now* — "3天内" means "three days from the
 * moment this ticket is created" — and are converted to a concrete date and
 * time when the ticket is saved.
 */
export const RELATIVE_PRESETS: Array<RelativeSpec & { id: string }> = [
    { id: "1d", amount: 1, unit: "day" },
    { id: "3d", amount: 3, unit: "day" },
    { id: "7d", amount: 7, unit: "day" },
    { id: "15d", amount: 15, unit: "day" },
    { id: "1mo", amount: 1, unit: "month" },
];

/** Minutes in each unit — months are handled separately (variable length). */
const MINUTES_PER_UNIT: Record<Exclude<RelativeUnit, "month">, number> = {
    minute: 1,
    hour: 60,
    day: 60 * 24,
    week: 60 * 24 * 7,
};

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

/** Format a `Date` as the stored local, minute-precision value. */
export function toStoredDateTime(date: Date): string {
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

/** The `YYYY-MM-DD` part of a stored value, or "" when it holds none. */
export function toDatePart(value: string | null | undefined): string {
    if (!value) return "";
    const match = DATE_ONLY.exec(value) ?? DATE_TIME.exec(value);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

/** The `HH:mm` part of a stored value; "" for a date-only value. */
export function toTimePart(value: string | null | undefined): string {
    if (!value) return "";
    const match = DATE_TIME.exec(value);
    return match ? `${match[4]}:${match[5]}` : "";
}

/**
 * The hour and minute of a stored value, as zero-padded strings.
 *
 * The dialog shows the two as separate controls, so they are read separately
 * here too. A value with no time of day (a legacy date-only row) reports
 * `fallbackHour`: a picker has to show *something*, and the caller is the one
 * that knows whether that hour is a real choice or just a starting point.
 */
export function hourAndMinute(
    value: string | null | undefined,
    fallbackHour: string,
): { hour: string; minute: string } {
    const time = toTimePart(value);
    if (!time) return { hour: fallbackHour, minute: "00" };
    return { hour: time.slice(0, 2), minute: time.slice(3, 5) };
}

/**
 * Normalise a typed hour or minute into the value the pickers use.
 *
 * The hour and minute fields are comboboxes: the list is for choosing, but the
 * box is for typing, and typed text arrives in whatever shape the person
 * prefers ("7", "07", "7 a"). Returns null when there is no usable number, so
 * the caller can decide whether to keep or revert — silently committing a
 * clamped guess (75 minutes becoming 59) would be worse than saying nothing.
 */
export function normalizeTimePart(raw: string, max: number): string | null {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;

    const parsed = Number(digits);
    if (!Number.isFinite(parsed) || parsed > max) return null;

    return String(parsed).padStart(2, "0");
}

/**
 * Parse a stored value into a local `Date`, or null when it holds no date.
 *
 * A date-only value lands on local midnight, which is what "starts on the 4th"
 * means to the person who typed it.
 */
export function parseStoredDateTime(value: string | null | undefined): Date | null {
    if (!value) return null;

    const dateTime = DATE_TIME.exec(value);
    if (dateTime) {
        return new Date(
            Number(dateTime[1]),
            Number(dateTime[2]) - 1,
            Number(dateTime[3]),
            Number(dateTime[4]),
            Number(dateTime[5]),
        );
    }

    const dateOnly = DATE_ONLY.exec(value);
    if (dateOnly) {
        return new Date(
            Number(dateOnly[1]),
            Number(dateOnly[2]) - 1,
            Number(dateOnly[3]),
        );
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whether a stored value carries a time-of-day, or only a date. */
export function hasTimePart(value: string | null | undefined): boolean {
    return !!value && DATE_TIME.test(value);
}

/**
 * Join a `YYYY-MM-DD` and an `HH:mm` into a stored value.
 *
 * A missing time falls back to 00:00 so a half-filled field still stores a
 * valid, comparable date rather than an unparseable fragment.
 */
export function combineDateAndTime(date: string, time: string): string {
    if (!date) return "";
    const [hours, minutes] = time ? time.split(":") : ["00", "00"];
    return `${date}T${pad(Number(hours) || 0)}:${pad(Number(minutes) || 0)}`;
}

/** Now, rounded down to the minute — the value "now" stores. */
export function nowStored(): string {
    return toStoredDateTime(new Date());
}

/**
 * The *local* date of an instant, as the date part of a stored value.
 *
 * Local on purpose: `toISOString().slice(0, 10)` is the tempting version and it
 * is wrong for anyone west of Greenwich in the evening, where it already reads
 * as tomorrow.
 */
export function dateKeyOf(date: Date = new Date()): string {
    return toDatePart(toStoredDateTime(date));
}

/** Today's local date. */
export function todayDatePart(now: Date = new Date()): string {
    return dateKeyOf(now);
}

/** Days in a month. `month` is 1-based; leap years included. */
export function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

/**
 * Normalise a typed date into the stored form, or null when it is not a date.
 *
 * The date box is typed into as well as picked from, and people write dates
 * differently: "2025-06-15", "2025/6/15", "20250615". All of those are the same
 * day, so all of them are accepted — in year-first order only, since that is
 * what the field shows and guessing between dd/mm and mm/dd is how dates get
 * silently swapped. Anything that is not a real calendar day (month 13, 31
 * April, 30 February) is rejected rather than rolled over into the next month.
 */
export function normalizeDateInput(raw: string): string | null {
    const parts = raw.trim().split(/[^0-9]+/).filter(Boolean);

    let year: number;
    let month: number;
    let day: number;

    if (parts.length === 3) {
        if (parts[0].length !== 4) return null;
        [year, month, day] = parts.map(Number);
    } else {
        const digits = raw.replace(/\D/g, "");
        if (digits.length !== 8) return null;
        year = Number(digits.slice(0, 4));
        month = Number(digits.slice(4, 6));
        day = Number(digits.slice(6, 8));
    }

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return null;
    }
    if (year < 1000 || year > 9999) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > daysInMonth(year, month)) return null;

    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface CalendarCell {
    date: Date;
    /** Local date key, "YYYY-MM-DD". */
    key: string;
    /** False for the days that only fill the grid around the month. */
    inMonth: boolean;
}

/**
 * Six weeks of days covering a month, Monday first.
 *
 * Six rows always, so the calendar does not change height as months change; a
 * picker that jumps under the cursor is worse than a little empty space. The
 * leading and trailing days belong to the neighbouring months and are marked so
 * the caller can mute them. `month` is 0-based, matching `Date`.
 */
export function monthGrid(year: number, month: number): CalendarCell[][] {
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7; // Monday = 0
    const weeks: CalendarCell[][] = [];

    for (let week = 0; week < 6; week++) {
        const days: CalendarCell[] = [];
        for (let day = 0; day < 7; day++) {
            const date = new Date(year, month, 1 - lead + week * 7 + day);
            days.push({
                date,
                key: dateKeyOf(date),
                inMonth: date.getMonth() === month,
            });
        }
        weeks.push(days);
    }

    return weeks;
}

/**
 * Resolve a relative offset against an anchor time.
 *
 * Month arithmetic clamps to the end of the target month (31 Jan + 1 month is
 * 28/29 Feb) rather than rolling into the following month, so "1 month out"
 * never lands later than the user expects.
 */
export function addRelative(spec: RelativeSpec, from: Date = new Date()): Date {
    const result = new Date(from.getTime());

    if (spec.unit === "month") {
        const targetDay = result.getDate();
        result.setDate(1);
        result.setMonth(result.getMonth() + spec.amount);
        const lastDay = new Date(
            result.getFullYear(),
            result.getMonth() + 1,
            0,
        ).getDate();
        result.setDate(Math.min(targetDay, lastDay));
        return result;
    }

    result.setMinutes(result.getMinutes() + spec.amount * MINUTES_PER_UNIT[spec.unit]);
    return result;
}

/** Resolve a relative offset straight to the value that gets stored. */
export function relativeToStored(spec: RelativeSpec, from: Date = new Date()): string {
    return toStoredDateTime(addRelative(spec, from));
}

// ── The ticket's time interval ──────────────────────────────────────────────

export interface ScheduleInterval {
    /** Stored start value. */
    start: string;
    /** Stored due value. */
    due: string;
}

/**
 * Turn a chosen range into a concrete start and due.
 *
 * A range answers "how far ahead should this finish", so it anchors at the
 * moment of the choice: the work starts now and is due at the range's far
 * point. Both ends come from the same anchor, so "3 days" is exactly 72 hours
 * and never off by the milliseconds between two separate `new Date()` calls.
 */
export function applyScheduleRange(
    spec: RelativeSpec,
    from: Date = new Date(),
): ScheduleInterval {
    return {
        start: toStoredDateTime(from),
        due: relativeToStored(spec, from),
    };
}

/**
 * True when both ends are set and the due falls before the start.
 *
 * A date-only due covers its whole day — the same reading as {@link isOverdueValue},
 * where such a deadline expires at the end of that day. Without this, a ticket
 * dated "the 15th" would look backwards against a start of "the 15th at 14:30".
 */
export function isEndBeforeStart(
    start: string | null | undefined,
    due: string | null | undefined,
): boolean {
    const from = parseStoredDateTime(start);
    const to = parseStoredDateTime(due);
    if (!from || !to) return false;

    if (!hasTimePart(due)) to.setHours(23, 59, 59, 999);
    return to.getTime() < from.getTime();
}

/**
 * How an interval should read, with each moment already formatted.
 *
 * Which words wrap the moments ("starts…", "due…") is a translation concern, so
 * this reports the *shape* and the component picks the wording.
 */
export type ScheduleDisplay =
    | { kind: "unset" }
    | { kind: "start"; at: string }
    | { kind: "due"; at: string }
    | { kind: "interval"; start: string; due: string };

/** Whole local calendar days from `reference` to `moment`. */
function dayOffset(moment: Date, reference: Date): number {
    const day = new Date(moment.getFullYear(), moment.getMonth(), moment.getDate());
    const base = new Date(
        reference.getFullYear(),
        reference.getMonth(),
        reference.getDate(),
    );
    return Math.round((day.getTime() - base.getTime()) / 86_400_000);
}

/**
 * A short, readable moment: "今天 18:00", "明天 09:30", "1月4日 18:00", and with
 * the year once it stops being this one.
 *
 * "Today"/"tomorrow" come from `Intl.RelativeTimeFormat`, so they are correct in
 * every UI language without a message key per phrase. Engines without it (older
 * WebKitGTK) simply fall through to the date form.
 *
 * `withTime` is false for a stored date-only value: such a row never had a
 * time, and printing the midnight it parses to would invent one.
 */
export function formatScheduleMoment(
    moment: Date,
    locale: string,
    withTime = true,
): string {
    const time = withTime
        ? ` ${pad(moment.getHours())}:${pad(moment.getMinutes())}`
        : "";
    const offset = dayOffset(moment, new Date());

    if (withTime && Math.abs(offset) <= 1 && typeof Intl.RelativeTimeFormat === "function") {
        try {
            const relative = new Intl.RelativeTimeFormat(locale, {
                numeric: "auto",
            });
            return `${relative.format(offset, "day")}${time}`;
        } catch {
            // Fall through to the date form.
        }
    }

    const sameYear = moment.getFullYear() === new Date().getFullYear();
    const date = moment.toLocaleDateString(locale, {
        year: sameYear ? undefined : "numeric",
        month: "short",
        day: "numeric",
    });

    return `${date}${time}`;
}

/** Describe a stored interval for display. */
export function describeSchedule(
    start: string | null | undefined,
    due: string | null | undefined,
    locale: string,
): ScheduleDisplay {
    const startMoment = parseStoredDateTime(start);
    const dueMoment = parseStoredDateTime(due);

    if (startMoment && dueMoment) {
        return {
            kind: "interval",
            start: formatScheduleMoment(startMoment, locale, hasTimePart(start)),
            due: formatScheduleMoment(dueMoment, locale, hasTimePart(due)),
        };
    }

    if (startMoment) {
        return {
            kind: "start",
            at: formatScheduleMoment(startMoment, locale, hasTimePart(start)),
        };
    }

    if (dueMoment) {
        return {
            kind: "due",
            at: formatScheduleMoment(dueMoment, locale, hasTimePart(due)),
        };
    }

    return { kind: "unset" };
}

/** Display a stored value in the given locale, with or without the time. */
export function formatStoredDateTime(
    value: string | null | undefined,
    locale: string,
): string {
    const date = parseStoredDateTime(value);
    if (!date) return "—";

    if (!hasTimePart(value)) {
        return date.toLocaleDateString(locale, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    return date.toLocaleString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** True when a due value is in the past; done tickets are never overdue. */
export function isOverdueValue(
    value: string | null | undefined,
    status: string,
): boolean {
    if (!value || status === "done") return false;
    const due = parseStoredDateTime(value);
    if (!due) return false;

    // A date-only deadline expires at the end of that day, not at midnight.
    if (!hasTimePart(value)) due.setHours(23, 59, 59, 999);
    return due.getTime() < Date.now();
}
