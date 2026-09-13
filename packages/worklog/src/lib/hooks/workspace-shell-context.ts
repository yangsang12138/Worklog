import { createContext } from "svelte";

import type { getBoards } from "$lib/hooks/boards.svelte";
import type { getWorkspace } from "$lib/hooks/workspace.svelte";
import type { useTicketTypes } from "$lib/hooks/ticket-types.svelte";
import type { useTicketPriorities } from "$lib/hooks/ticket-priorities.svelte";
import type { useTags } from "$lib/hooks/tags.svelte";

export type WorkspaceApi = ReturnType<typeof getWorkspace>;
export type BoardsApi = ReturnType<typeof getBoards>;
export type TicketTypesApi = ReturnType<typeof useTicketTypes>;
export type TicketPrioritiesApi = ReturnType<typeof useTicketPriorities>;
export type TagsApi = ReturnType<typeof useTags>;

export interface WorkspaceShellContext {
    workspace: WorkspaceApi;
    boardsApi: BoardsApi;
    ticketTypesApi: TicketTypesApi;
    ticketPrioritiesApi: TicketPrioritiesApi;
    tagsApi: TagsApi;
}

export const [getWorkspaceShellContext, setWorkspaceShellContext] =
    createContext<WorkspaceShellContext>();
