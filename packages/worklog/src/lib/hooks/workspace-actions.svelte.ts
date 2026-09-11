import { goto } from '$app/navigation';
import { getWorkspace } from '$lib/hooks/workspace.svelte';
import { getUndoRedo } from '$lib/hooks/undo-redo.svelte';
import { notifications } from '$lib/hooks/notifications.svelte';
import * as m from '$lib/paraglide/messages.js';

const LAST_BOARD_ID_KEY = 'worklog:last_board_id';

/**
 * Workspace-level actions shared by the workspace switcher, the settings page
 * and the command palette.
 *
 * Switching workspaces replaces the database behind every view, so it is not
 * only a navigation step: undo/redo history belongs to the previous database
 * and must be dropped, and the previously opened board id must not leak.
 */
export function useWorkspaceActions() {
    const workspace = getWorkspace();
    const undoRedo = getUndoRedo();

    /** Drop per-workspace state and land on the freshly opened workspace. */
    async function enterWorkspace() {
        undoRedo.clear();

        try {
            window.localStorage.removeItem(LAST_BOARD_ID_KEY);
        } catch {
            // Storage may be unavailable; nothing to clean up in that case.
        }

        await goto('/workspace');

        notifications.add({
            kind: 'success',
            title: m.workspace_switched(),
            subtitle: m.workspace_switched_msg({
                name: workspace.meta?.name ?? m.settings_default_workspace(),
            }),
            timeout: 3000,
        });
    }

    function notifyFailure() {
        notifications.add({
            kind: 'error',
            title: m.workspace_switch_failed(),
            subtitle: workspace.error ?? m.workspace_folder_not_accessible(),
            timeout: 6000,
        });
    }

    /** Pick a folder through the OS dialog and switch to it. */
    async function switchWorkspace(): Promise<boolean> {
        const previousPath = workspace.path;
        const opened = await workspace.pick();
        if (!opened) {
            // A `null` result with an error set means opening failed; without an
            // error the user simply cancelled the dialog.
            if (workspace.error) notifyFailure();
            return false;
        }

        // Re-selecting the folder that is already open is a no-op, not a switch.
        if (opened === previousPath) return true;

        await enterWorkspace();
        return true;
    }

    /** Switch to a known folder path (e.g. a recent workspace). */
    async function openWorkspaceAt(path: string): Promise<boolean> {
        if (path === workspace.path) return false;

        const opened = await workspace.openPath(path);
        if (!opened) {
            notifyFailure();
            return false;
        }

        await enterWorkspace();
        return true;
    }

    /** Close the current workspace and return to the workspace selector. */
    async function closeWorkspace(): Promise<void> {
        undoRedo.clear();
        try {
            await workspace.close();
        } catch (error) {
            notifications.add({ kind: 'error', title: m.workspace_switch_failed(), subtitle: String(error) });
            return;
        }
        await goto('/');

        notifications.add({
            kind: 'info',
            title: m.workspace_closed(),
            timeout: 2500,
        });
    }

    return { switchWorkspace, openWorkspaceAt, closeWorkspace };
}
