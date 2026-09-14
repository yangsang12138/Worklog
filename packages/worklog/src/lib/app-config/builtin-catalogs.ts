import { DEFAULT_TAG_NAMES, DEFAULT_TICKET_TYPES, defaultPriorities } from '$lib/db/catalogs';
import * as m from '$lib/paraglide/messages.js';
import {
    BUILTIN_CATALOG_SET_ID,
    normalizeCatalogSet,
    type CatalogSet,
} from './catalogs';

/**
 * The product's built-in todo-attribute configuration, assembled from the very
 * definitions a new workspace is seeded with.
 *
 * Composed rather than stored: the built-in is a *view* of the app's own
 * defaults, so it cannot drift from them, it follows the UI language (priority
 * names come from messages), and there is no file to edit or delete. Copying it
 * yields an ordinary configuration that the user owns.
 *
 * Tag ids are derived from the tag name because the workspace seeds tags with
 * random UUIDs; tags are matched by name everywhere, so a stable derived id is
 * enough and keeps repeated reads from churning.
 */
export function builtinCatalogSet(): CatalogSet {
    return normalizeCatalogSet({
        id: BUILTIN_CATALOG_SET_ID,
        // Named from messages, never stored: the label follows the UI language.
        name: m.settings_catalog_builtin(),
        description: '',
        types: DEFAULT_TICKET_TYPES.map((type) => ({
            id: type.id,
            name: type.name,
            color: type.color,
            icon: type.icon,
            is_default: type.is_default === 1,
        })),
        priorities: defaultPriorities().map((priority) => ({
            id: priority.id,
            name: priority.name,
            color: priority.color,
            rank: priority.rank,
            is_default: priority.is_default === 1,
        })),
        tags: DEFAULT_TAG_NAMES.map((name) => ({
            id: `TG-BUILTIN-${name.toUpperCase()}9`,
            name,
            color: 'cool-gray',
        })),
    });
}
