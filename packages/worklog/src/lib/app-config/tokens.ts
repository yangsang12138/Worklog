/**
 * The access token that is **part of** a Git configuration: its value and its
 * expiry date.
 *
 * A token is not a standalone resource. A Git host issues it against one
 * account, with its own permissions and its own lifetime, and the thing it
 * authenticates is one connection. Keeping it inside the configuration is also
 * what makes a configuration *self-contained* — which is what lets one be
 * copied, exported and imported as a single unit without dragging a reference
 * to something else along with it.
 *
 * Note there is deliberately no "currently active" concept anywhere here: usage
 * is not a property of a credential, it is a property of the thing that uses it.
 *
 * This module has **no runtime imports** so it can be unit-tested with plain
 * Node, the same way `db/columns-config.ts` is.
 */

/** How close to its expiry date a token counts as "expiring soon". */
export const EXPIRING_SOON_DAYS = 30;

export type TokenStatus = 'valid' | 'expiring' | 'expired' | 'no-expiry';

/**
 * Name given to the configuration adopted from a pre-library workspace, whose
 * credential arrived without any name of its own.
 */
export const LEGACY_CONFIG_NAME = 'GitHub';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date the UI can compare, or null when nothing usable was recorded. */
export function normalizeIsoDate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!ISO_DATE.test(trimmed)) return null;
    // Reject impossible calendar dates (2026-02-31), which a date input cannot
    // produce but a hand-edited or imported file can.
    const parsed = Date.parse(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString().slice(0, 10) === trimmed
        ? trimmed
        : null;
}

/** Whole days from `from` to `to`; null when either date is unusable. */
function daysBetween(from: string, to: string): number | null {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return Math.round((end - start) / 86_400_000);
}

/**
 * How a token's expiry date looks from `today` (both `YYYY-MM-DD`).
 *
 * The app never blocks a sync on this date — only the Git host knows whether a
 * credential still works — but showing it turns a mystery 403 into an obvious
 * "this token expired last week".
 */
export function tokenStatus(
    expiresAt: string | null | undefined,
    today: string,
): TokenStatus {
    const date = normalizeIsoDate(expiresAt);
    if (!date) return 'no-expiry';

    const remaining = daysBetween(today, date);
    if (remaining === null) return 'no-expiry';
    if (remaining < 0) return 'expired';
    if (remaining <= EXPIRING_SOON_DAYS) return 'expiring';
    return 'valid';
}

/** Today as `YYYY-MM-DD` in local time, the format the UI stores. */
export function todayIso(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}
