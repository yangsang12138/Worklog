/**
 * Todo attribute **configurations** and their instances.
 *
 * Three levels, mirroring the Git library:
 *
 *   1. **Configurations (app level)** — a named library. A "configuration" is one
 *      set of rules: which types exist, which priority levels, which tags. A team
 *      keeps several (a product vocabulary, a support vocabulary).
 *   2. **Instance (workspace level)** — a workspace *references* one
 *      configuration and materialises it into its own rows
 *      (`ticket_types` / `ticket_priorities` / `tags`). Those rows are what the
 *      board reads when you create a ticket, and what a ticket's ids resolve
 *      against.
 *   3. **Divergence** — the instance is editable in place (adding a tag while
 *      filing a ticket must not require a detour through settings), so the
 *      instance drifts from its configuration. `diffCatalogSet` reports how, and
 *      the workspace can then push its instance *up* to overwrite the
 *      configuration body.
 *
 * Why an instance exists at all rather than a live reference: a ticket stores its
 * type, priority and tags **by id**. A definition that lived only in the app
 * config would dangle for every teammate and in every export, since neither
 * carries the app config.
 *
 * No runtime imports, so this is unit-testable with plain Node.
 */

export interface TodoTypeRule {
    id: string;
    name: string;
    /** Colour key: a Carbon tag colour for types. */
    color: string;
    /** Optional icon name; null keeps the built-in look. */
    icon: string | null;
    /** The type new tickets start with. At most one rule may be the default. */
    is_default: boolean;
}

export interface TodoPriorityRule {
    id: string;
    name: string;
    /** Hex colour. */
    color: string;
    /** Ordering weight — lower sorts first (highest priority first). */
    rank: number;
    /** The level a new ticket starts at. At most one rule may be the default. */
    is_default: boolean;
}

export interface TodoTagRule {
    id: string;
    name: string;
    /** Colour key: a Carbon tag colour for tags. */
    color: string;
}

/** One named set of rules — a "configuration" in the app-level library. */
export interface CatalogSet {
    id: string;
    name: string;
    description: string;
    types: TodoTypeRule[];
    priorities: TodoPriorityRule[];
    tags: TodoTagRule[];
}

/** Colour keys offered for types and tags (Carbon tag colours). */
export const TAG_COLOR_KEYS = [
    'teal',
    'blue',
    'magenta',
    'purple',
    'cyan',
    'green',
    'red',
    'warm-gray',
    'cool-gray',
] as const;

/** Colours offered for priority levels. */
export const PRIORITY_COLOR_KEYS = [
    '#da1e28',
    '#ff832b',
    '#f1c21b',
    '#005d5d',
    '#0f62fe',
    '#198038',
    '#8a3ffc',
    '#525252',
] as const;

export const DEFAULT_TYPE_COLOR = 'blue';
export const DEFAULT_TAG_COLOR = 'cool-gray';
export const DEFAULT_PRIORITY_COLOR = '#0f62fe';

/** Name given to the configuration adopted from the pre-library shape. */
export const LEGACY_CATALOG_NAME = 'Default';

/**
 * The product's built-in configuration.
 *
 * It is **virtual**: never written to the app config, never editable, never
 * deletable. Two reasons, both about honesty:
 *
 *   - "reset to the product default" has to keep meaning something, which is
 *     impossible if the default can be edited into something else;
 *   - its content is *derived* from the app's own seed definitions, so it stays
 *     in step with them — and its names can follow the UI language instead of
 *     being frozen into a file at first run.
 *
 * Copying it produces an ordinary configuration: the copy is somebody's, and
 * carries none of this status.
 */
export const BUILTIN_CATALOG_SET_ID = 'CAT-BUILTIN';

export function isBuiltinCatalogSet(id: string | null | undefined): boolean {
    return id === BUILTIN_CATALOG_SET_ID;
}

/** Rank step between generated priority levels. */
const RANK_STEP = 10;

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function newId(prefix: string): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 6; i += 1) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `${prefix}-${suffix}`;
}

export function newCatalogSetId(): string {
    return newId('CAT');
}

export function newTypeRuleId(): string {
    return newId('TY');
}

export function newPriorityRuleId(): string {
    return newId('PR');
}

export function newTagRuleId(): string {
    return newId('TG');
}

export function emptyCatalogSet(patch: Partial<CatalogSet> = {}): CatalogSet {
    return {
        id: str(patch.id).trim() || newCatalogSetId(),
        name: str(patch.name).trim(),
        description: str(patch.description).trim(),
        types: [],
        priorities: [],
        tags: [],
    };
}

export function newTypeRule(): TodoTypeRule {
    return {
        id: newTypeRuleId(),
        name: '',
        color: DEFAULT_TYPE_COLOR,
        icon: null,
        is_default: false,
    };
}

export function newTagRule(): TodoTagRule {
    return { id: newTagRuleId(), name: '', color: DEFAULT_TAG_COLOR };
}

/** Rank a new priority level should take: after every existing one. */
export function nextPriorityRank(set: Pick<CatalogSet, 'priorities'>): number {
    return (set.priorities.length + 1) * RANK_STEP;
}

/** A blank priority rule, appended at the end of the order. */
export function newPriorityRule(
    set: Pick<CatalogSet, 'priorities'>,
): TodoPriorityRule {
    return {
        id: newPriorityRuleId(),
        name: '',
        color: DEFAULT_PRIORITY_COLOR,
        rank: nextPriorityRank(set),
        // A first level has to be the default or a new ticket has nothing to
        // start at; a later one must not steal it.
        is_default: set.priorities.length === 0,
    };
}

function normalizeName(value: unknown): string {
    return str(value).trim();
}

/**
 * Coerce the rule lists of one set.
 *
 * A rule with no name is dropped: it would render as a blank row in every
 * workspace that applies it. Duplicate ids are replaced for the same reason ids
 * exist at all — a ticket has to resolve to exactly one definition.
 */
function normalizeRules(source: {
    types?: unknown;
    priorities?: unknown;
    tags?: unknown;
}): Pick<CatalogSet, 'types' | 'priorities' | 'tags'> {
    const types: TodoTypeRule[] = [];
    const seenTypeIds = new Set<string>();
    for (const entry of Array.isArray(source.types) ? source.types : []) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Partial<TodoTypeRule>;
        const name = normalizeName(record.name);
        if (!name) continue;

        let id = str(record.id).trim() || newTypeRuleId();
        while (seenTypeIds.has(id)) id = newTypeRuleId();
        seenTypeIds.add(id);

        types.push({
            id,
            name,
            color: str(record.color).trim() || DEFAULT_TYPE_COLOR,
            icon: str(record.icon).trim() || null,
            is_default: record.is_default === true,
        });
    }
    ensureSingleDefault(types);

    const priorities: TodoPriorityRule[] = [];
    const seenPriorityIds = new Set<string>();
    for (const entry of Array.isArray(source.priorities) ? source.priorities : []) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Partial<TodoPriorityRule>;
        const name = normalizeName(record.name);
        if (!name) continue;

        let id = str(record.id).trim() || newPriorityRuleId();
        while (seenPriorityIds.has(id)) id = newPriorityRuleId();
        seenPriorityIds.add(id);

        const rank = Number(record.rank);
        priorities.push({
            id,
            name,
            color: str(record.color).trim() || DEFAULT_PRIORITY_COLOR,
            rank: Number.isFinite(rank) ? rank : (priorities.length + 1) * RANK_STEP,
            is_default: record.is_default === true,
        });
    }
    priorities.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    // A stable, gap-free order, so the same configuration applies in the same
    // order on every machine.
    priorities.forEach((rule, index) => {
        rule.rank = (index + 1) * RANK_STEP;
    });
    ensureSingleDefault(priorities);

    const tags: TodoTagRule[] = [];
    const seenTagIds = new Set<string>();
    const seenTagNames = new Set<string>();
    for (const entry of Array.isArray(source.tags) ? source.tags : []) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Partial<TodoTagRule>;
        const name = normalizeName(record.name);
        // Tag *names* are what the board matches on, so duplicates collide.
        if (!name || seenTagNames.has(name)) continue;
        seenTagNames.add(name);

        let id = str(record.id).trim() || newTagRuleId();
        while (seenTagIds.has(id)) id = newTagRuleId();
        seenTagIds.add(id);

        tags.push({ id, name, color: str(record.color).trim() || DEFAULT_TAG_COLOR });
    }

    return { types, priorities, tags };
}

/**
 * Keep at most one default, and prefer the first flagged entry.
 *
 * Two defaults make "the default" depend on row order, which is exactly what a
 * configuration is supposed to remove.
 */
function ensureSingleDefault<T extends { is_default: boolean }>(entries: T[]): void {
    let found = false;
    for (const entry of entries) {
        if (!entry.is_default) continue;
        if (found) entry.is_default = false;
        else found = true;
    }
}

export function normalizeCatalogSet(raw: unknown): CatalogSet {
    const source = (raw ?? {}) as Partial<CatalogSet>;
    const set = emptyCatalogSet(source);
    const rules = normalizeRules(source as Record<string, unknown>);
    set.types = rules.types;
    set.priorities = rules.priorities;
    set.tags = rules.tags;
    return set;
}

/**
 * Read the library out of whatever the config file holds.
 *
 * Accepts three generations: this one (`{ sets: [...] }`), the single unnamed set
 * shipped immediately before it (`{ types, priorities, tags }`), and a bare array
 * of sets. A configuration with no name is dropped, like a rule with no name —
 * it would be unlabelled in every picker.
 */
export function normalizeCatalogSets(raw: unknown): CatalogSet[] {
    const source = (raw ?? {}) as { sets?: unknown };

    const rawSets: unknown[] = Array.isArray(source.sets)
        ? source.sets
        : Array.isArray(raw)
          ? raw
          : typeof raw === 'object' && raw !== null &&
              ('types' in raw || 'priorities' in raw || 'tags' in raw)
            ? [{ ...(raw as Record<string, unknown>), name: LEGACY_CATALOG_NAME }]
            : [];

    const seen = new Set<string>();
    const sets: CatalogSet[] = [];

    for (const entry of rawSets) {
        if (!entry || typeof entry !== 'object') continue;
        const set = normalizeCatalogSet(entry);
        if (!set.name) continue;
        if (seen.has(set.id)) set.id = newCatalogSetId();
        seen.add(set.id);
        sets.push(set);
    }

    return sets;
}

export function findCatalogSet(
    sets: CatalogSet[],
    id: string | null | undefined,
): CatalogSet | null {
    if (!id) return null;
    return sets.find((set) => set.id === id) ?? null;
}

/** A copy of a configuration: same rules, new identity. */
export function duplicateCatalogSet(set: CatalogSet): CatalogSet {
    return normalizeCatalogSet({
        ...set,
        id: newCatalogSetId(),
        types: set.types.map((rule) => ({ ...rule, id: newTypeRuleId() })),
        priorities: set.priorities.map((rule) => ({
            ...rule,
            id: newPriorityRuleId(),
        })),
        tags: set.tags.map((rule) => ({ ...rule, id: newTagRuleId() })),
    });
}

export function catalogSetCounts(set: Pick<CatalogSet, 'types' | 'priorities' | 'tags'>): {
    types: number;
    priorities: number;
    tags: number;
} {
    return {
        types: set.types.length,
        priorities: set.priorities.length,
        tags: set.tags.length,
    };
}

export function isCatalogSetEmpty(
    set: Pick<CatalogSet, 'types' | 'priorities' | 'tags'>,
): boolean {
    const counts = catalogSetCounts(set);
    return counts.types === 0 && counts.priorities === 0 && counts.tags === 0;
}

// ── Divergence between a configuration and its instance ───────────────────

/** How one kind of rule differs between the body and the instance. */
export interface CatalogDiff {
    /** In the configuration, absent from the instance. */
    missing: string[];
    /** Only in the instance — added locally, e.g. while filing a ticket. */
    local: string[];
    /** Present on both sides with different fields or order. */
    changed: string[];
}

export interface CatalogSetDiff {
    types: CatalogDiff;
    priorities: CatalogDiff;
    tags: CatalogDiff;
    /** True when nothing differs at all. */
    identical: boolean;
    /** Total number of differences, for a badge. */
    total: number;
}

function emptyDiff(): CatalogDiff {
    return { missing: [], local: [], changed: [] };
}

function label(value: { name: string }, id: string): string {
    return value.name || id;
}

/**
 * Compare a configuration body against a workspace's instance.
 *
 * Priority *order* is part of the comparison: the same levels in a different
 * order is a real difference — the board would show them in the wrong sequence.
 */
export function diffCatalogSet(body: CatalogSet, instance: CatalogSet): CatalogSetDiff {
    const types = diffKind(body.types, instance.types, (a, b) => sameRule(a, b));
    const priorities = diffKind(
        body.priorities,
        instance.priorities,
        (a, b) => sameRule(a, b) && a.rank === b.rank,
    );
    // Tags are diffed by *name*: the workspace seeds them with random ids, and
    // the rest of the app (the board's catalog manager, "apply") matches them by
    // name too. Diffing them by id would report every tag as both missing and
    // local on a perfectly ordinary workspace.
    const tags = diffByName(body.tags, instance.tags);

    const total =
        types.missing.length + types.local.length + types.changed.length +
        priorities.missing.length + priorities.local.length + priorities.changed.length +
        tags.missing.length + tags.local.length + tags.changed.length;

    return { types, priorities, tags, identical: total === 0, total };
}

function sameRule(
    a: { name: string; color: string; icon?: string | null; is_default?: boolean },
    b: { name: string; color: string; icon?: string | null; is_default?: boolean },
): boolean {
    return (
        a.name === b.name &&
        a.color === b.color &&
        (a.icon ?? null) === (b.icon ?? null) &&
        Boolean(a.is_default) === Boolean(b.is_default)
    );
}

function diffKind<T extends { id: string; name: string }>(
    bodyEntries: T[],
    instanceEntries: T[],
    unchanged: (a: T, b: T) => boolean,
): CatalogDiff {
    const diff = emptyDiff();
    const instanceById = new Map(instanceEntries.map((entry) => [entry.id, entry]));
    const bodyIds = new Set(bodyEntries.map((entry) => entry.id));

    for (const entry of bodyEntries) {
        const counterpart = instanceById.get(entry.id);
        if (!counterpart) {
            // Absent locally, so the configuration's name is the only one there is.
            diff.missing.push(label(entry, entry.id));
        } else if (!unchanged(entry, counterpart)) {
            // Named after the instance on purpose: this is the row the user sees
            // in their board, and the list is there to say "these differ".
            diff.changed.push(label(counterpart, counterpart.id));
        }
    }

    for (const entry of instanceEntries) {
        if (!bodyIds.has(entry.id)) diff.local.push(label(entry, entry.id));
    }

    return diff;
}

/**
 * Compare two name-keyed lists (tags).
 *
 * A rename therefore reads as one local addition plus one local removal, which
 * is the truth: nothing links the two rows except the name.
 */
function diffByName(bodyEntries: TodoTagRule[], instanceEntries: TodoTagRule[]): CatalogDiff {
    const diff = emptyDiff();
    const bodyByName = new Map(bodyEntries.map((entry) => [entry.name, entry]));
    const instanceByName = new Map(instanceEntries.map((entry) => [entry.name, entry]));

    for (const entry of bodyEntries) {
        const counterpart = instanceByName.get(entry.name);
        if (!counterpart) diff.missing.push(entry.name);
        else if (counterpart.color !== entry.color) diff.changed.push(entry.name);
    }

    for (const entry of instanceEntries) {
        if (!bodyByName.has(entry.name)) diff.local.push(entry.name);
    }

    return diff;
}

/** Whether a diff has anything to report for one kind. */
export function diffIsEmpty(diff: CatalogDiff): boolean {
    return (
        diff.missing.length === 0 &&
        diff.local.length === 0 &&
        diff.changed.length === 0
    );
}

/**
 * A diff that separates "only here" rows into the removable ones and the ones a
 * replace would keep because tickets point at them.
 */
export interface CatalogSetDiffAnnotated extends CatalogSetDiff {
    /** Local rows a replace would keep, per kind. */
    retained: { types: string[]; priorities: string[]; tags: string[] };
}

/** Catalog rows that a workspace's tickets point at, and that a replace kept. */
export interface RetainedCatalogRows {
    /** Type ids. */
    types: Set<string>;
    /** Priority ids. */
    priorities: Set<string>;
    /** Tag names — `labels` stores names, not ids. */
    tags: Set<string>;
}

export function emptyRetainedRows(): RetainedCatalogRows {
    return { types: new Set(), priorities: new Set(), tags: new Set() };
}

/**
 * Stop reporting deliberately-retained rows as differences.
 *
 * A replace keeps a row the configuration does not have when a ticket points at
 * it. That row is *not* drift: it is a documented exception, and listing it under
 * "only here" made an applied configuration look like it had not been applied.
 * It is reported separately instead.
 */
export function annotateRetainedLocal(
    diff: CatalogSetDiff,
    instance: CatalogSet,
    retained: RetainedCatalogRows,
): CatalogSetDiffAnnotated {
    const splitNames = (
        names: string[],
        entries: { id: string; name: string }[],
        ids: Set<string>,
    ): { removable: string[]; kept: string[] } => {
        const removable: string[] = [];
        const kept: string[] = [];
        for (const name of names) {
            const entry = entries.find((candidate) => candidate.name === name);
            if (entry && ids.has(entry.id)) kept.push(name);
            else removable.push(name);
        }
        return { removable, kept };
    };

    const types = splitNames(diff.types.local, instance.types, retained.types);
    const priorities = splitNames(
        diff.priorities.local,
        instance.priorities,
        retained.priorities,
    );
    const tags = {
        removable: diff.tags.local.filter((name) => !retained.tags.has(name)),
        kept: diff.tags.local.filter((name) => retained.tags.has(name)),
    };

    // A kept row is still a difference: the instance has something the
    // configuration does not. Saying "identical" because the difference happens
    // to be protected is how "N differences" turned into "matches", which is
    // simply untrue.
    const total =
        diff.types.missing.length + types.removable.length + types.kept.length +
        diff.types.changed.length +
        diff.priorities.missing.length + priorities.removable.length +
        priorities.kept.length + diff.priorities.changed.length +
        diff.tags.missing.length + tags.removable.length + tags.kept.length +
        diff.tags.changed.length;

    return {
        types: { ...diff.types, local: types.removable },
        priorities: { ...diff.priorities, local: priorities.removable },
        tags: { ...diff.tags, local: tags.removable },
        retained: {
            types: types.kept,
            priorities: priorities.kept,
            tags: tags.kept,
        },
        total,
        identical: total === 0,
    };
}

/** How many rows are being kept because tickets point at them. *//** How many rows are being kept because tickets point at them. */
export function retainedCount(retained: RetainedCatalogRows): number {
    return retained.types.size + retained.priorities.size + retained.tags.size;
}
