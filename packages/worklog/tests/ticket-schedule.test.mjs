/**
 * Tests for the ticket's time interval.
 *
 * The dialog sets a start and a due one of two ways — a relative range or two
 * exact moments — but always stores the same two values, so what matters here
 * is that the arithmetic and the wording hold without a browser:
 *
 *   - a range anchors at one instant (a "3 day" range is exactly 72 hours, not
 *     72 hours plus however long two `new Date()` calls were apart);
 *   - an interval reads correctly whether one end, both, or neither is set;
 *   - a backwards interval is reported, not silently accepted.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    applyScheduleRange,
    dateKeyOf,
    daysInMonth,
    monthGrid,
    normalizeDateInput,
    combineDateAndTime,
    describeSchedule,
    formatScheduleMoment,
    hourAndMinute,
    isEndBeforeStart,
    normalizeTimePart,
    parseStoredDateTime,
    todayDatePart,
    relativeToStored,
} from '../src/lib/utils/ticket-datetime.ts';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

/** Source of the `$effect` block that contains `needle`, braces balanced. */
function effectBlockContaining(source, needle) {
    let index = source.indexOf('$effect(() => {');

    while (index !== -1) {
        let depth = 0;
        let end = index;

        for (let i = source.indexOf('{', index); i < source.length; i++) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') {
                depth--;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }

        const block = source.slice(index, end + 1);
        if (block.includes(needle)) return block;
        index = source.indexOf('$effect(() => {', end);
    }

    return null;
}

/** A fixed local instant, so nothing depends on when the suite runs. */
const ANCHOR = new Date(2025, 5, 15, 14, 30, 0);

function shift(value, ms) {
    return new Date(value.getTime() + ms);
}

test('a relative range starts now and ends at the range far point', () => {
    const interval = applyScheduleRange({ amount: 3, unit: 'day' }, ANCHOR);

    assert.equal(interval.start, '2025-06-15T14:30');
    assert.equal(interval.due, '2025-06-18T14:30');
});

test('both ends of a range come from the same instant', () => {
    // Anchoring twice would make the due drift by however long the dialog took
    // between the two calls; the seconds are dropped together, not separately.
    const precise = new Date(2025, 5, 15, 14, 30, 59, 999);
    const interval = applyScheduleRange({ amount: 1, unit: 'hour' }, precise);

    assert.equal(interval.start, '2025-06-15T14:30');
    assert.equal(interval.due, '2025-06-15T15:30');
    assert.equal(
        parseStoredDateTime(interval.due).getTime() -
            parseStoredDateTime(interval.start).getTime(),
        60 * 60 * 1000,
    );
});

test('every unit the dialog offers resolves', () => {
    const cases = [
        [{ amount: 45, unit: 'minute' }, '2025-06-15T15:15'],
        [{ amount: 6, unit: 'hour' }, '2025-06-15T20:30'],
        [{ amount: 7, unit: 'day' }, '2025-06-22T14:30'],
        [{ amount: 2, unit: 'week' }, '2025-06-29T14:30'],
        [{ amount: 1, unit: 'month' }, '2025-07-15T14:30'],
    ];

    for (const [spec, expectedDue] of cases) {
        const interval = applyScheduleRange(spec, ANCHOR);
        assert.equal(interval.due, expectedDue, `${spec.amount} ${spec.unit}`);
        assert.equal(interval.start, '2025-06-15T14:30');
    }
});

test('a month range clamps to the end of a shorter month', () => {
    // 31 January + 1 month is the end of February, not 3 March.
    const interval = applyScheduleRange(
        { amount: 1, unit: 'month' },
        new Date(2025, 0, 31, 9, 0),
    );

    assert.equal(interval.due, '2025-02-28T09:00');
});

test('the relative helper and the interval agree', () => {
    const spec = { amount: 15, unit: 'day' };
    assert.equal(
        applyScheduleRange(spec, ANCHOR).due,
        relativeToStored(spec, ANCHOR),
    );
});

test('an interval with both ends reads as start then due', () => {
    const display = describeSchedule(
        '2025-06-15T14:30',
        '2025-06-18T18:00',
        'zh-CN',
    );

    assert.equal(display.kind, 'interval');
    assert.match(display.start, /15/);
    assert.match(display.due, /18/);
});

test('an interval with one end reads by name, not with a blank arrow', () => {
    assert.equal(
        describeSchedule('2025-06-15T14:30', '', 'zh-CN').kind,
        'start',
    );
    assert.equal(describeSchedule('', '2025-06-18T18:00', 'zh-CN').kind, 'due');
});

test('an interval with neither end is unset', () => {
    assert.equal(describeSchedule('', '', 'zh-CN').kind, 'unset');
    assert.equal(describeSchedule(null, null, 'en').kind, 'unset');
});

test('today and tomorrow are named, later days are dated', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0);
    const tomorrow = shift(today, 24 * 60 * 60 * 1000);

    // Wording comes from Intl, so the assertion is on the time, not the word.
    assert.match(formatScheduleMoment(today, 'zh-CN'), /^今天 18:00$/);
    assert.match(formatScheduleMoment(tomorrow, 'zh-CN'), /^明天 18:00$/);
    assert.match(formatScheduleMoment(today, 'en'), /18:00$/);

    const later = shift(today, 10 * 24 * 60 * 60 * 1000);
    assert.ok(!formatScheduleMoment(later, 'zh-CN').startsWith('今天'));
});

test('a date in another year keeps its year', () => {
    const nextYear = new Date(new Date().getFullYear() + 1, 0, 4, 18, 0);
    const text = formatScheduleMoment(nextYear, 'zh-CN');

    assert.match(text, new RegExp(String(nextYear.getFullYear())));
    assert.match(text, /18:00$/);
});

test('a date-only value is shown without an invented time', () => {
    // Legacy rows never had a time; printing the midnight they parse to would
    // claim a precision the row does not have.
    const display = describeSchedule('2025-06-15', '2025-06-18', 'zh-CN');

    assert.equal(display.kind, 'interval');
    assert.ok(!display.start.includes(':'), display.start);
    assert.ok(!display.due.includes(':'), display.due);

    // A minute-precision value still shows its time.
    const timed = describeSchedule('2025-06-15T14:30', '', 'zh-CN');
    assert.match(timed.at, /14:30/);
});

test('a backwards interval is reported', () => {
    assert.equal(
        isEndBeforeStart('2025-06-18T18:00', '2025-06-15T14:30'),
        true,
    );
    assert.equal(
        isEndBeforeStart('2025-06-15T14:30', '2025-06-18T18:00'),
        false,
    );
});

test('a backwards interval is only reported when both ends exist', () => {
    assert.equal(isEndBeforeStart('', ''), false);
    assert.equal(isEndBeforeStart('2025-06-15T14:30', ''), false);
    assert.equal(isEndBeforeStart('', '2025-06-15T14:30'), false);
});

test('an equal start and due is not backwards', () => {
    assert.equal(
        isEndBeforeStart('2025-06-15T14:30', '2025-06-15T14:30'),
        false,
    );
});

test('a date-only due covers its whole day', () => {
    // Legacy rows hold date-only values. Such a deadline means "sometime that
    // day", so it is not backwards against a later start on the same day —
    // the same reading the overdue rule uses.
    assert.equal(isEndBeforeStart('2025-06-15T14:30', '2025-06-15'), false);
    assert.equal(isEndBeforeStart('2025-06-15T14:30', '2025-06-14'), true);
});

test('hour and minute are read out separately, zero padded', () => {
    // The pickers are two selects, so the values have to match their options
    // exactly — "7" would match no option and leave the select blank.
    assert.deepEqual(hourAndMinute('2025-06-15T07:05', '09'), {
        hour: '07',
        minute: '05',
    });
    assert.deepEqual(hourAndMinute('2025-06-15T14:30', '09'), {
        hour: '14',
        minute: '30',
    });
    assert.deepEqual(hourAndMinute('2025-06-15T00:00', '09'), {
        hour: '00',
        minute: '00',
    });
});

test('a value with no time falls back to the picker default', () => {
    // A start defaults to 09:00 and a due to 18:00 — midnight would make a
    // deadline expire the moment its own day began.
    assert.deepEqual(hourAndMinute('2025-06-15', '09'), {
        hour: '09',
        minute: '00',
    });
    assert.deepEqual(hourAndMinute('', '18'), { hour: '18', minute: '00' });
    assert.deepEqual(hourAndMinute(null, '18'), { hour: '18', minute: '00' });
});

test('a split hour and minute recombine into the stored value', () => {
    const parts = hourAndMinute('2025-06-15T07:05', '09');
    assert.equal(
        combineDateAndTime('2025-06-15', `${parts.hour}:${parts.minute}`),
        '2025-06-15T07:05',
    );
});

test('a typed hour is normalised, not guessed at', () => {
    // The box takes typed text, so "7" has to mean 07 — but text that is not a
    // real value must be rejected rather than clamped to something plausible.
    assert.equal(normalizeTimePart('7', 23), '07');
    assert.equal(normalizeTimePart('07', 23), '07');
    assert.equal(normalizeTimePart('23', 23), '23');
    assert.equal(normalizeTimePart('59', 59), '59');
    assert.equal(normalizeTimePart('0', 59), '00');

    assert.equal(normalizeTimePart('24', 23), null);
    assert.equal(normalizeTimePart('75', 59), null);
    assert.equal(normalizeTimePart('', 23), null);
    assert.equal(normalizeTimePart('abc', 23), null);
});

test('stray characters around a typed hour are ignored', () => {
    assert.equal(normalizeTimePart('7 a', 23), '07');
    assert.equal(normalizeTimePart(' 14 ', 23), '14');
});

test("today's date part is the local day, not the UTC one", () => {
    // A UTC-based reading (toISOString) would report tomorrow for anyone west
    // of Greenwich in the evening, which would put a chosen time on the wrong
    // day for exactly the users most likely to notice.
    assert.equal(todayDatePart(new Date(2025, 5, 15, 23, 30)), '2025-06-15');
    assert.equal(todayDatePart(new Date(2025, 5, 15, 0, 5)), '2025-06-15');
    assert.equal(todayDatePart(new Date(2025, 0, 1, 12, 0)), '2025-01-01');
});

test('a time chosen with no date reads as today at that time', () => {
    // This is the pair the dialog commits when someone types into an hour box
    // before touching a date: the box is never disabled, so the day has to come
    // from somewhere.
    const chosen = combineDateAndTime(
        todayDatePart(new Date(2025, 5, 15, 14, 30)),
        '14:30',
    );
    assert.equal(chosen, '2025-06-15T14:30');
});

test('a typed date is understood however it is written', () => {
    // The same day, written the three ways people actually write it.
    for (const raw of ['2025-06-15', '2025/6/15', '20250615', '2025.6.15', ' 2025-06-15 ']) {
        assert.equal(normalizeDateInput(raw), '2025-06-15', raw);
    }
    assert.equal(normalizeDateInput('2025-6-5'), '2025-06-05');
});

test('a typed date that is not a real day is rejected, not rolled over', () => {
    // Rolling 31 April into 1 May would silently store a day nobody chose.
    assert.equal(normalizeDateInput('2025-04-31'), null);
    assert.equal(normalizeDateInput('2025-13-01'), null);
    assert.equal(normalizeDateInput('2025-00-10'), null);
    assert.equal(normalizeDateInput('2025-06-00'), null);
    assert.equal(normalizeDateInput('2025-02-30'), null);
});

test('the date boxes only take a year-first date', () => {
    // Guessing between dd/mm and mm/dd is how dates get silently swapped.
    assert.equal(normalizeDateInput('15/06/2025'), null);
    assert.equal(normalizeDateInput('25-6-15'), null);
});

test('a half-typed date is not a date yet', () => {
    assert.equal(normalizeDateInput('2025-06'), null);
    assert.equal(normalizeDateInput('2025-06-'), null);
    assert.equal(normalizeDateInput(''), null);
    assert.equal(normalizeDateInput('tomorrow'), null);
});

test('leap days are accepted only in a leap year', () => {
    assert.equal(normalizeDateInput('2024-02-29'), '2024-02-29');
    assert.equal(normalizeDateInput('2025-02-29'), null);
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInMonth(2025, 2), 28);
    assert.equal(daysInMonth(2025, 4), 30);
    assert.equal(daysInMonth(2025, 12), 31);
});

test('a month grid is six weeks of seven days, Monday first', () => {
    // June 2025 starts on a Sunday, so the first week is all May but one day.
    const weeks = monthGrid(2025, 5);

    assert.equal(weeks.length, 6);
    for (const week of weeks) assert.equal(week.length, 7);
    assert.equal(weeks[0][0].key, '2025-05-26');
    assert.equal(weeks[0][6].key, '2025-06-01');
    assert.equal(weeks[0][6].inMonth, true);
    assert.equal(weeks[0][0].inMonth, false);
});

test('a month grid covers every day of the month exactly once', () => {
    for (const [year, month] of [[2025, 5], [2025, 1], [2024, 1], [2025, 11]]) {
        const keys = monthGrid(year, month)
            .flat()
            .filter((cell) => cell.inMonth)
            .map((cell) => cell.key);

        assert.equal(keys.length, daysInMonth(year, month + 1));

        const unique = new Set(keys);
        assert.equal(unique.size, keys.length);
        assert.ok(keys.includes(dateKeyOf(new Date(year, month, 1))));
    }
});

test('date keys are local days, not UTC ones', () => {
    assert.equal(dateKeyOf(new Date(2025, 5, 15, 23, 59)), '2025-06-15');
    assert.equal(dateKeyOf(new Date(2025, 5, 15, 0, 0)), '2025-06-15');
});

test('an absolute pair is stored to the minute', () => {
    assert.equal(combineDateAndTime('2025-06-15', '14:30'), '2025-06-15T14:30');
    // A date without a time is still a valid, comparable value.
    assert.equal(combineDateAndTime('2025-06-15', ''), '2025-06-15T00:00');
    assert.equal(combineDateAndTime('', '14:30'), '');
});

/**
 * Regression pin for the picker bug.
 *
 * The absolute controls are written by a `$effect` that adopts the stored
 * values. When that effect also *read* those controls, it re-ran the moment the
 * user touched a date picker and immediately wrote the old value back — so the
 * chosen date was gone before `change` could commit it, and picking a date
 * looked like it did nothing. An effect that writes state without reading it
 * cannot do that.
 */
test('the absolute-control sync effect never reads the controls it writes', () => {
    const source = readFileSync(
        join(srcDir, 'lib/components/app/common/schedule-field.svelte'),
        'utf8',
    );
    const block = effectBlockContaining(source, 'startDate =');

    assert.ok(block, 'could not find the sync effect in schedule-field.svelte');

    for (const control of [
        'startDate',
        'startHour',
        'startMinute',
        'dueDate',
        'dueHour',
        'dueMinute',
    ]) {
        // A read is the name *not* followed by `=` (and not `==`/`===`).
        const read = new RegExp(`(^|[^\\w.$])${control}\\b(?!\\s*=(?!=))`);
        assert.ok(
            !read.test(block),
            `${control} is read inside the effect that writes it`,
        );
    }
});
