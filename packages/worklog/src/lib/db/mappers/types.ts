import type { Board, Ticket, WorkspaceMeta } from '$lib/components/app/types';

// ── Export / Import Types ──────────────────────────────────────────────────

export type ExportFormat = 'json' | 'csv';
export type ExportMode = 'single-file' | 'folder';

export interface ExportOptions {
    format: ExportFormat;
    mode: ExportMode;
}

export interface ImportSource {
    type: 'single-file' | 'folder';
    format: ExportFormat;
    path: string;
}

export type ImportStrategy = 'merge' | 'replace';

// ── Snapshot Types ─────────────────────────────────────────────────────────

/**
 * A complete in-memory representation of a workspace.
 * Used as the intermediate format between DB ↔ flat files.
 *
 * Deliberately **excludes identity and credentials**. A snapshot travels with
 * the workspace (git sync, export), so anything personal must not be a part of
 * it — `app_settings` used to be serialised here, which pushed the author's
 * name into every teammate's copy on the next pull. Those values live in the
 * app config now.
 *
 * It *includes* the attribute catalogs. A ticket stores its type, priority and
 * tags by id, so a snapshot without the definitions behind those ids is not
 * portable: a teammate would see `TY-ABC123` where the author saw
 * "Payment refactor". The workspace's catalog rows are its own data (its
 * instance of an app-level configuration), which is exactly why they belong
 * here.
 */
export interface WorklogSnapshot {
    export_version: number;
    exported_at: string;
    workspace_meta: WorkspaceMeta | null;
    boards: BoardSnapshot[];
    catalogs: CatalogSnapshot;
}

/**
 * The workspace's attribute catalogs, in portable form.
 *
 * Timestamps are left out on purpose: they say nothing about a definition, and
 * leaving them in would make two exports of the same workspace differ by noise.
 */
export interface CatalogSnapshot {
    types: CatalogTypeRow[];
    priorities: CatalogPriorityRow[];
    tags: CatalogTagRow[];
}

export interface CatalogTypeRow {
    id: string;
    name: string;
    color: string;
    icon: string | null;
    is_default: boolean;
}

export interface CatalogPriorityRow {
    id: string;
    name: string;
    color: string;
    rank: number;
    is_default: boolean;
}

export interface CatalogTagRow {
    id: string;
    name: string;
    color: string;
}

export function emptyCatalogSnapshot(): CatalogSnapshot {
    return { types: [], priorities: [], tags: [] };
}

export interface BoardSnapshot {
    board: Board;
    tickets: Ticket[];
}

// ── Import Result ──────────────────────────────────────────────────────────

export interface ImportResult {
    boardsCreated: number;
    boardsUpdated: number;
    ticketsCreated: number;
    ticketsUpdated: number;
    ticketsSkipped: number;
    /** Catalog rows the import added / updated (never removed). */
    catalogRowsCreated: number;
    catalogRowsUpdated: number;
}

/** Current export format version */
/**
 * Bumped to 2 when the attribute catalogs joined the snapshot.
 *
 * A version 1 file still imports: its catalogs are simply empty, which is
 * exactly what such an export meant.
 */
export const EXPORT_VERSION = 2;
