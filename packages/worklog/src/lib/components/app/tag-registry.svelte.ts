import type { TagRecord } from "$lib/db/repositories/tag.repo";

/**
 * Workspace-wide tag resolution.
 *
 * A ticket's labels are plain strings, and a label may exist on a ticket
 * without ever having been added to the catalog (synced from another
 * workspace, imported, or typed before the catalog existed). The catalog is
 * therefore a lookup for name and colour only — never a filter — so that a
 * tag is always shown even when it is not registered.
 *
 * Module-level `$state` keeps this reactive across components. Only one
 * workspace is active at a time, so a single registry is intentional.
 */

let _tags = $state<TagRecord[]>([]);

/** Publish the active workspace's tag catalog. */
export function setWorkspaceTags(tags: TagRecord[]) {
    _tags = tags;
}

/** Catalog tag names, in display order. */
export function workspaceTagNames(): string[] {
    return _tags.map((tag) => tag.name);
}

/** The catalog entry for a tag name, or undefined for an unregistered tag. */
export function findTag(name: string): TagRecord | undefined {
    const needle = name.trim().toLowerCase();
    return _tags.find((tag) => tag.name.toLowerCase() === needle);
}

/**
 * The colour registered for a tag, or null for the neutral default.
 *
 * `cool-gray` is the catalog's way of saying "no colour chosen", so it reads
 * back as null and lets each view keep its own neutral styling.
 */
export function tagColorHex(name: string): string | null {
    const color = findTag(name)?.color;
    if (!color || color === "cool-gray") return null;
    return color;
}

/** CSS background for a filled tag chip, or null to keep the default styling. */
export function tagColorStyle(name: string): string | null {
    const color = tagColorHex(name);
    return color ? `background-color: ${color}; color: #ffffff;` : null;
}
