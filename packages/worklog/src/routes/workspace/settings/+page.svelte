<script lang="ts">
    import { goto } from "$app/navigation";
    import {
        getReactiveLocale,
        setReactiveLocale,
    } from "$lib/hooks/locale.svelte";
    import * as m from "$lib/paraglide/messages.js";
    import {
        Button,
        TextArea,
        TextInput,
        RadioButtonGroup,
        RadioButton,
        ButtonSet,
        Tabs,
        Tab,
        TabContent,
        Toggle,
        Select,
        SelectItem,
        PasswordInput,
        InlineLoading,
        Tag,
        ContentSwitcher,
        Switch,
        InlineNotification,
        Modal,
        Checkbox,
    } from "carbon-components-svelte";
    import { getWorkspace } from "$lib/hooks/workspace.svelte";
    import { getDb, WorkspaceRepo, CatalogUsageRepo } from "$lib/db";
    import {
        exportDatabaseWithOptions,
        type ExportOptions,
    } from "$lib/db/export";
    import { importFromFile } from "$lib/db/mappers";
    import { notifications } from "$lib/hooks/notifications.svelte";
    import {
        checkForUpdate,
        RELEASES_URL,
        type UpdateState,
    } from "$lib/updater";
    import type { ExportFormat, ExportMode } from "$lib/db/mappers";
    import { getSyncConfig } from "$lib/sync/sync-config.svelte";
    import { getAppConfig } from "$lib/app-config/app-config.svelte";
    import {
        tokenStatus,
        todayIso,
        type TokenStatus,
    } from "$lib/app-config/tokens";
    import {
        createGitConfig,
        describeRemote,
        deserializeGitConfigs,
        duplicateGitConfig,
        gitConfigStatus,
        isSupportedRemoteUrl,
        serializeGitConfigs,
        type GitConfigEntry,
        type GitConfigStatus,
    } from "$lib/app-config/git-configs";
    import { builtinCatalogSet } from "$lib/app-config/builtin-catalogs";
    import {
        BUILTIN_CATALOG_SET_ID,
        isBuiltinCatalogSet,
        PRIORITY_COLOR_KEYS,
        TAG_COLOR_KEYS,
        catalogSetCounts,
        diffCatalogSet,
        duplicateCatalogSet,
        emptyCatalogSet,
        emptyRetainedRows,
        LEGACY_CATALOG_NAME,
        annotateRetainedLocal,
        type RetainedCatalogRows,
        newPriorityRule,
        newTagRule,
        newTypeRule,
        normalizeCatalogSet,
        type CatalogDiff,
        type CatalogSet,
        type CatalogSetDiffAnnotated,
        type CatalogSetDiff,
    } from "$lib/app-config/catalogs";
    import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
    import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
    import { SyncEngine } from "$lib/sync/sync-engine";
    import {
        requestSyncResolution,
        runSyncOperation,
        syncState,
    } from "$lib/sync/sync-scheduler.svelte";
    import type { SyncResult, SyncStatus } from "$lib/sync/types";
    import { getAppZoom } from "$lib/hooks/app-zoom.svelte";
    import { formatDateTime } from "$lib/utils/date-format";
    import {
        useAppAppearance,
        type ThemeMode,
    } from "$lib/hooks/app-appearance.svelte";
    import ZoomControls from "$lib/components/app/layout/workspace/zoom-controls.svelte";
    import {
        Settings,
        View,
        DataBase,
        Cloud,
        Code,
        Search,
        ArrowLeft,
        Renew,
        MagicWand,
        ColorPalette,
        WarningAlt,
        Launch,
        TrashCan,
        Add,
        Checkmark,
        Close,
        CheckmarkOutline,
        SquareFill,
        Moon,
        Sun,
        Screen,
        Document,
        Table,
        Folder,
        FolderOpen,
        Download,
        Upload,
        SendAlt,
        User,
        Copy,
        ArrowUp,
        ArrowDown,
    } from "carbon-icons-svelte";
    import { getWorkspaceShellContext } from "$lib/hooks/workspace-shell-context";
    import { getBoardTabs } from "$lib/hooks/board-tabs.svelte";
    import { getBoardColumns } from "$lib/hooks/board-columns.svelte";
    import type { TabType } from "$lib/components/app/types";
    import { useWorkspaceActions } from "$lib/hooks/workspace-actions.svelte";
    import { seedDatabase, seedLazyLoadingTest } from "$lib/db/seed";
    import { EventRepo, type EventRecord } from "$lib/db";
    import { Time } from "carbon-icons-svelte";
    import PushSettingsTab from "$lib/components/app/push/push-settings-tab.svelte";

    /**
     * The three configuration levels, plus the developer group that sits
     * outside them.
     *
     * The menu is grouped by **scope** rather than by feature area, because
     * scope is what answers the questions a user actually has about a setting:
     * does it follow me to another workspace (no — app), does it travel with the
     * workspace folder to my teammates (yes — workspace), or does it belong to
     * the board I am looking at (board)?
     */
    type SettingsScope = "app" | "workspace" | "board" | "developer";

    type SettingsCategory =
        | "identity"
        | "git-auth"
        | "appearance"
        | "data"
        | "data-format"
        | "todo-config"
        | "catalog-config"
        | "workspace"
        | "workspace-data"
        | "todo-config-reference"
        | "customization"
        | "sync"
        | "push"
        | "board"
        | "updates"
        | "debug"
        | "advanced";

    /** The page shown on open: the first selectable entry in the menu. */
    let activeCategory = $state<SettingsCategory>("git-auth");

    /**
     * Sub-pages, keyed by the parent menu entry.
     *
     * Held apart from `categories` so that array keeps its inferred (literal)
     * types — a `children` key on some entries but not others turns every
     * `category.children` access into a union that TypeScript rejects.
     */
    const subPages: Record<
        string,
        { id: SettingsCategory; label: () => string }[]
    > = {
        identity: [
            { id: "git-auth", label: () => m.settings_identity_git_auth() },
        ],
        // Data *management* is app-level and holds only the export format; the
        // export and import themselves are workspace-level, under Workspace data.
        data: [
            { id: "data-format", label: () => m.settings_data_format_title() },
        ],
        "todo-config": [
            { id: "catalog-config", label: () => m.settings_catalog_config() },
        ],
    };

    /** Where a parent entry leads: its first sub-page, or itself. */
    function firstPageOf(id: SettingsCategory): SettingsCategory {
        return subPages[id]?.[0]?.id ?? id;
    }

    /** A parent is highlighted while any of its sub-pages is open. */
    function isEntryActive(id: SettingsCategory): boolean {
        const children = subPages[id];
        if (children?.length) {
            return children.some((child) => child.id === activeCategory);
        }
        return activeCategory === id;
    }

    /**
     * Categories with the scope they belong to. Labels are getters so that
     * switching the UI language re-renders the menu instead of leaving the
     * labels in the language the page was opened in.
     *
     * `icon` lives on the category, not on the scope group: the group is a
     * heading, and giving both a level and every item below it an icon just
     * muddied which one was the parent.
     */
    const categories = [
        {
            id: "identity",
            get label() {
                return m.settings_identity();
            },
            icon: User,
            scope: "app",
        },
        {
            id: "appearance",
            get label() {
                return m.settings_category_appearance();
            },
            icon: View,
            scope: "app",
        },
        {
            id: "data",
            get label() {
                return m.settings_category_data();
            },
            icon: DataBase,
            scope: "app",
        },
        {
            id: "todo-config",
            get label() {
                return m.settings_todo_config();
            },
            icon: MagicWand,
            scope: "app",
        },
        {
            id: "workspace",
            get label() {
                return m.settings_category_workspace();
            },
            icon: Folder,
            scope: "workspace",
        },
        {
            id: "workspace-data",
            get label() {
                return m.settings_workspace_data_title();
            },
            icon: Document,
            scope: "workspace",
        },
        {
            id: "todo-config-reference",
            get label() {
                return m.settings_todo_reference();
            },
            icon: CheckmarkOutline,
            scope: "workspace",
        },
        {
            id: "customization",
            get label() {
                return m.settings_category_customization();
            },
            icon: MagicWand,
            scope: "workspace",
        },
        { id: "sync", get label() { return m.settings_category_sync(); }, icon: Cloud, scope: "workspace" },
        {
            id: "push",
            get label() {
                return "远程推送";
            },
            icon: SendAlt,
            scope: "workspace",
        },
        {
            id: "board",
            get label() {
                return m.settings_category_board();
            },
            icon: Table,
            scope: "board",
        },
        {
            id: "updates",
            get label() {
                return m.settings_app_updates();
            },
            icon: Renew,
            scope: "developer",
        },
        {
            id: "debug",
            get label() {
                return "Debug";
            },
            icon: Code,
            scope: "developer",
        },
        {
            id: "advanced",
            get label() {
                return m.settings_category_advanced();
            },
            icon: Settings,
            scope: "developer",
        },
    ] as const satisfies readonly {
        id: SettingsCategory;
        label: string;
        icon: unknown;
        scope: SettingsScope;
    }[];

    const scopeOrder: SettingsScope[] = [
        "app",
        "workspace",
        "board",
        "developer",
    ];

    function scopeLabel(scope: SettingsScope): string {
        if (scope === "app") return m.settings_scope_app();
        if (scope === "workspace") return m.settings_scope_workspace();
        if (scope === "board") return m.settings_scope_board();
        return m.settings_scope_developer();
    }

    function scopeDescription(scope: SettingsScope): string {
        if (scope === "app") return m.settings_scope_app_desc();
        if (scope === "workspace") return m.settings_scope_workspace_desc();
        if (scope === "board") return m.settings_scope_board_desc();
        return m.settings_scope_developer_desc();
    }

    const scopeGroups = $derived(
        scopeOrder.map((scope) => ({
            scope,
            label: scopeLabel(scope),
            description: scopeDescription(scope),
            categories: categories.filter((category) => category.scope === scope),
        })),
    );

    /**
     * The trail shown in the breadcrumb: the scope, then the menu entry, then
     * the sub-page when one is open. Resolved by walking the menu rather than
     * by looking the id up directly, because a sub-page id is not itself a
     * menu entry.
     */
    const activeNav = $derived.by(() => {
        for (const category of categories) {
            const child = subPages[category.id]?.find(
                (entry) => entry.id === activeCategory,
            );
            if (child) {
                return {
                    scope: category.scope,
                    parent: category.label,
                    label: child.label(),
                };
            }
            if (category.id === activeCategory) {
                return {
                    scope: category.scope,
                    parent: null,
                    label: category.label,
                };
            }
        }
        return { scope: "app" as SettingsScope, parent: null, label: "" };
    });
    let searchQuery = $state("");

    const workspace = getWorkspace();
    const { ticketTypesApi, ticketPrioritiesApi, tagsApi, boardsApi } =
        getWorkspaceShellContext();
    const workspaceActions = useWorkspaceActions();
    const syncConfig = getSyncConfig();
    const appZoom = getAppZoom();
    const appAppearance = useAppAppearance();
    const languageOptions = [
        { label: "English", value: "en" },
        { label: "Français", value: "fr" },
        { label: "简体中文", value: "zh-CN" },
    ] as const;

    const workspaceName = $derived(workspace.meta?.name ?? m.settings_default_workspace());
    const workspacePath = $derived(workspace.path ?? m.settings_not_available());
    const workspaceStatus = $derived(workspace.status);
    const schemaVersion = $derived(workspace.meta?.schema_version ?? m.settings_unknown());
    const workspaceStatusLabel = $derived.by(() =>
        workspaceStatus === "ready" ? m.settings_workspace_status_ready() : workspaceStatus,
    );

    let exportFormat = $state<ExportFormat>("json");
    let exportMode = $state<ExportMode>("single-file");

    /** Display names for the board's views, used by the panel-level index. */
    const TAB_LABELS: Record<TabType, () => string> = {
        kanban: () => m.board_tab_board(),
        table: () => m.board_tab_table(),
        timeline: () => m.board_tab_timeline(),
        calendar: () => m.board_tab_calendar(),
        docs: () => m.board_tab_docs(),
        push: () => m.board_tab_push(),
    };

    // ── Board (panel-level) state ─────────────────────────────────────────
    // Panel-level settings are edited inside the board itself; this page only
    // indexes them, so the three scopes are visible in one place. Both hooks
    // load from the database, and the board is whichever one is currently
    // active.
    const boardTabsApi = getBoardTabs(
        () => workspace.path,
        () => boardsApi.active?.id ?? null,
    );
    const boardColumnsApi = getBoardColumns(
        () => workspace.path,
        () => boardsApi.active?.id ?? null,
    );

    const activeBoard = $derived(boardsApi.active);

    const boardViewsLabel = $derived.by(() =>
        boardTabsApi.enabledTabs.map((tab) => TAB_LABELS[tab]?.() ?? tab).join(" · "),
    );

    const boardColumnStats = $derived.by(() => {
        const columns = boardColumnsApi.columns;
        return {
            total: columns.length,
            hidden: columns.filter((column) => column.hidden).length,
            collapsed: columns.filter((column) => column.collapsed).length,
        };
    });

    // Load the active board's panel-level config, and follow along when the
    // user switches boards.
    $effect(() => {
        if (workspace.status !== "ready" || !workspace.path) return;
        if (!boardsApi.active) return;
        void boardTabsApi.load();
        void boardColumnsApi.load();
    });

    function openActiveBoard() {
        const id = boardsApi.active?.id;
        if (id) void goto(`/workspace/${id}`);
    }

    // ── Updater State ─────────────────────────────────────────────────────
    let updateState = $state<UpdateState>({
        status: "idle",
        info: null,
        progress: { downloaded: 0, contentLength: 0, percent: 0 },
        errorMessage: null,
    });

    // ── Customization State ───────────────────────────────────────────────
    let newTypeName = $state("");
    let newTypeColor = $state("#525252");
    let editingTypeId = $state<string | null>(null);
    let editingTypeName = $state("");
    let editingTypeColor = $state("");

    async function handleAddType() {
        if (!newTypeName.trim()) return;
        await ticketTypesApi.create({
            name: newTypeName.trim(),
            color: newTypeColor,
            is_default: ticketTypesApi.types.length === 0,
        });
        newTypeName = "";
    }

    async function handleUpdateType(id: string) {
        if (!editingTypeName.trim()) return;
        await ticketTypesApi.update(id, {
            name: editingTypeName.trim(),
            color: editingTypeColor,
        });
        editingTypeId = null;
    }

    async function handleDeleteType(id: string) {
        await ticketTypesApi.remove(id);
    }

    async function handleSetDefaultType(id: string) {
        await ticketTypesApi.update(id, { is_default: true });
    }

    // ── Sync state ─────────────────────────────────────────────────────────
    // Workspace scope only: which Git configuration this workspace references,
    // which branch it syncs, and its own sync behaviour. The connection itself
    // (address, identity, token) is never stored here.
    let syncGitConfigId = $state("");
    let syncBranch = $state("main");
    let syncAutoSync = $state(false);
    let syncAutoSyncInterval = $state(15);
    let syncLoading = $state(false);
    let syncLoadingMessage = $state("");
    let gitAvailable = $state<boolean | null>(null);
    let syncBranchMismatch = $state<SyncResult | null>(null);

    // Load sync config on mount
    $effect(() => {
        if (workspace.status === "ready" && workspace.path) {
            void loadSyncConfig();
            void loadIdentity();
        }
    });

    // ── App-level resources this page edits ────────────────────────────────
    // The Git configuration library: not workspace data, stored outside the
    // workspace folder by design. A workspace only ever records *which*
    // configuration it uses, and which branch it syncs.
    //
    // NOTE: `author_name` is deliberately absent. It is not a Git concept — the
    // sync engine never reads it — so it has no business in a Git form.
    let gitConfigs = $state<GitConfigEntry[]>([]);
    /**
     * Which configuration the detail view is showing. `null` means the list.
     * `gitConfigDraft` holds a brand-new entry that does not exist in the list
     * yet, so an unfinished form never becomes a saved row.
     */
    let openGitConfigId = $state<string | null>(null);
    let gitConfigDraft = $state<GitConfigEntry | null>(null);
    let gitAuthSaving = $state(false);

    async function loadIdentity() {
        const appConfig = getAppConfig();
        await appConfig.load();
        gitConfigs = appConfig.gitConfigs.map((entry) => ({ ...entry }));
        exportFormat = appConfig.data.export_format;
        exportMode = appConfig.data.export_mode;
        catalogSets = structuredClone($state.snapshot(appConfig.catalogSets));
    }

    /**
     * Remember the export format/mode.
     *
     * They used to be component state, so the choice was lost the moment the
     * settings page was closed. They are app-level preferences — yours, on this
     * machine, and not something to write into a workspace (or sync).
     */
    async function setExportPreference(patch: {
        format?: ExportFormat;
        mode?: ExportMode;
    }) {
        if (patch.format) exportFormat = patch.format;
        if (patch.mode) exportMode = patch.mode;
        await getAppConfig().setData({
            export_format: exportFormat,
            export_mode: exportMode,
        });
    }

    // ── Todo attribute configurations (app level) ─────────────────────────
    // A library of named rule sets, mirroring the Git configuration library: a
    // list, and a detail view per entry. `catalogDraft` holds a set that does not
    // exist in the library yet, so an abandoned form never becomes a stored row.
    let catalogSets = $state<CatalogSet[]>([]);
    let openCatalogSetId = $state<string | null>(null);
    let catalogDraft = $state<CatalogSet | null>(null);
    let catalogSaving = $state(false);

    /** The built-in is a view of the app's own defaults, never a stored row. */
    const builtinSet = $derived(builtinCatalogSet());

    /**
     * What the pickers and the library list show: the pinned built-in first, then
     * the configurations the user owns. Writes only ever carry the latter.
     */
    const allCatalogSets = $derived([builtinSet, ...catalogSets]);

    const openCatalogSet = $derived(
        catalogDraft ??
            allCatalogSets.find((set) => set.id === openCatalogSetId) ??
            null,
    );

    /** The built-in cannot be edited, deleted, or written back over. */
    const openCatalogSetIsBuiltin = $derived(
        isBuiltinCatalogSet(openCatalogSet?.id),
    );
    const openCatalogCounts = $derived(
        openCatalogSet
            ? catalogSetCounts(openCatalogSet)
            : { types: 0, priorities: 0, tags: 0 },
    );

    function startNewCatalogSet() {
        catalogDraft = emptyCatalogSet({ name: "" });
        openCatalogSetId = catalogDraft.id;
    }

    function openCatalogSetDetail(id: string) {
        catalogDraft = null;
        openCatalogSetId = id;
    }

    function closeCatalogSetDetail() {
        catalogDraft = null;
        openCatalogSetId = null;
    }

    /**
     * Persist the library with one configuration replaced (or, for a draft,
     * appended). The full list is written so ids and order stay consistent in a
     * single write.
     */
    async function persistCatalogSet(next: CatalogSet): Promise<void> {
        const list = catalogDraft
            ? [...catalogSets, next]
            : catalogSets.map((entry) =>
                  entry.id === next.id ? next : entry,
              );
        await commitCatalogSets(list);
        catalogDraft = null;
        openCatalogSetId = next.id;
    }

    /**
     * Save the configuration being edited.
     *
     * A *new* configuration waits for the explicit save (it has no name yet, and
     * normalisation would drop an unnamed entry). An existing one is stored as
     * soon as a field is committed, so editing rules feels immediate.
     */
    async function commitCatalogRules(set: CatalogSet | null): Promise<void> {
        if (!set || catalogDraft) return;
        await persistCatalogSet(set);
    }

    /** Edit the open configuration in place, then store it. */
    async function mutateOpenCatalogSet(
        mutate: (draft: CatalogSet) => void,
    ): Promise<void> {
        const set = openCatalogSet;
        if (!set) return;

        catalogSaving = true;
        try {
            const draft = structuredClone($state.snapshot(set));
            mutate(draft);
            if (catalogDraft) {
                // Still a draft: keep the edit local until it is named and saved.
                catalogDraft = draft;
            } else {
                await persistCatalogSet(draft);
            }
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        } finally {
            catalogSaving = false;
        }
    }

    function addCatalogRule(kind: "types" | "priorities" | "tags") {
        return mutateOpenCatalogSet((draft) => {
            if (kind === "types") draft.types.push(newTypeRule());
            else if (kind === "priorities") {
                draft.priorities.push(newPriorityRule(draft));
            } else draft.tags.push(newTagRule());
        });
    }

    function removeCatalogRule(
        kind: "types" | "priorities" | "tags",
        id: string,
    ) {
        return mutateOpenCatalogSet((draft) => {
            // Written out per branch: indexing by a union key gives TypeScript
            // an intersection of the three array types.
            if (kind === "types") {
                draft.types = draft.types.filter((rule) => rule.id !== id);
            } else if (kind === "priorities") {
                draft.priorities = draft.priorities.filter(
                    (rule) => rule.id !== id,
                );
            } else {
                draft.tags = draft.tags.filter((rule) => rule.id !== id);
            }
        });
    }

    function setCatalogDefault(kind: "types" | "priorities", id: string) {
        return mutateOpenCatalogSet((draft) => {
            for (const rule of draft[kind]) rule.is_default = rule.id === id;
        });
    }

    function moveCatalogRule(id: string, delta: number) {
        return mutateOpenCatalogSet((draft) => {
            const index = draft.priorities.findIndex((rule) => rule.id === id);
            const target = index + delta;
            if (
                index === -1 ||
                target < 0 ||
                target >= draft.priorities.length
            ) {
                return;
            }
            const [moved] = draft.priorities.splice(index, 1);
            draft.priorities.splice(target, 0, moved);
        });
    }

    async function commitCatalogSets(next: CatalogSet[]): Promise<void> {
        await getAppConfig().setCatalogSets(next);
        catalogSets = structuredClone(
            $state.snapshot(getAppConfig().catalogSets),
        );
    }

    function catalogSetUsable(set: CatalogSet | null): boolean {
        return !!set && set.name.trim().length > 0;
    }

    async function saveCatalogSet(): Promise<void> {
        const set = openCatalogSet;
        if (!catalogSetUsable(set) || !set) return;

        catalogSaving = true;
        try {
            const next = catalogDraft
                ? [...catalogSets, set]
                : catalogSets.map((entry) => (entry.id === set.id ? set : entry));
            await commitCatalogSets(next);
            catalogDraft = null;
            openCatalogSetId = set.id;

            notifications.add({
                kind: "success",
                title: m.settings_git_auth_saved(),
                timeout: 3000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        } finally {
            catalogSaving = false;
        }
    }

    /**
     * Delete a configuration.
     *
     * A workspace still referencing it keeps its instance (its own rows) — only
     * the reference is cleared, so the board never loses the catalog it uses.
     */
    async function deleteCatalogSet(id: string): Promise<void> {
        catalogSaving = true;
        try {
            await commitCatalogSets(
                catalogSets.filter((set) => set.id !== id),
            );
            if (openCatalogSetId === id) closeCatalogSetDetail();
            if (catalogSetId === id) {
                catalogSetId = "";
                await persistCatalogReference();
            }
            notifications.add({
                kind: "success",
                title: m.settings_git_auth_saved(),
                timeout: 3000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        } finally {
            catalogSaving = false;
        }
    }

    async function duplicateCatalogSetInLibrary(id: string): Promise<void> {
        // Searched in the display list so the built-in can be copied — a copy is
        // an ordinary configuration, which is the whole point of allowing it.
        const source = allCatalogSets.find((set) => set.id === id);
        if (!source) return;

        catalogSaving = true;
        try {
            await commitCatalogSets([
                ...catalogSets,
                duplicateCatalogSet(source),
            ]);
            notifications.add({
                kind: "success",
                title: m.settings_catalog_set_duplicated(),
                timeout: 4000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        } finally {
            catalogSaving = false;
        }
    }

    // ── The workspace's reference and its instance ────────────────────────
    /**
     * The saved reference, and what the picker currently shows.
     *
     * Kept apart so "what did I just select" is distinguishable from "what this
     * workspace uses": saving a reference also applies it, and that decision
     * depends on the difference between the two.
     */
    let catalogSetId = $state("");
    let catalogSelection = $state("");
    let catalogApplying = $state(false);
    let replacePromptOpen = $state(false);
    /** Default on: replacing an instance is how local work usually gets lost. */
    let forkBeforeReplace = $state(true);

    const referencedCatalogSet = $derived(
        allCatalogSets.find((set) => set.id === catalogSetId) ?? null,
    );
    const selectedCatalogSet = $derived(
        allCatalogSets.find((set) => set.id === catalogSelection) ?? null,
    );

    /**
     * The workspace's own rows, read in the configuration's shape, so the two can
     * be compared. Priorities are re-ranked positionally: the instance's stored
     * ranks are an implementation detail, its order is what matters.
     */
    const catalogInstance = $derived.by<CatalogSet>(() => ({
        id: "instance",
        name: "",
        description: "",
        // The *active* catalog: a retired row has left the instance, which is
        // what lets "the configuration overwrote this workspace" be true while
        // the ticket that points at the retired row still resolves.
        types: ticketTypesApi.activeTypes.map((type) => ({
            id: type.id,
            name: type.name,
            color: type.color,
            icon: type.icon,
            is_default: Boolean(type.is_default),
        })),
        priorities: ticketPrioritiesApi.activePriorities.map(
            (priority, index) => ({
                id: priority.id,
                name: priority.name,
                color: priority.color,
                rank: (index + 1) * 10,
                is_default: Boolean(priority.is_default),
            }),
        ),
        tags: tagsApi.activeTags.map((tag) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color,
        })),
    }));

    /** Which rows this workspace's tickets point at (refreshed after a replace). */
    let catalogRetained = $state<RetainedCatalogRows>(emptyRetainedRows());

    async function refreshCatalogUsage(): Promise<void> {
        if (!workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            catalogRetained = await CatalogUsageRepo.collectCatalogUsage(db);
        } catch {
            // Without usage information nothing is treated as retained; the diff
            // then reports only the ordinary differences.
        }
    }

    const catalogDiff = $derived(
        referencedCatalogSet
            ? annotateRetainedLocal(
                  diffCatalogSet(referencedCatalogSet, catalogInstance),
                  catalogInstance,
                  catalogRetained,
              )
            : null,
    );

    /** How the selected configuration differs from what this workspace has now. */
    /**
     * How the selection differs, in two forms.
     *
     * `selectionDiffRaw` decides whether to warn before replacing: a row kept
     * because a ticket points at it is still a row the configuration does not
     * have, and applying would still change the workspace. The pruned version is
     * for *display* only — using it as the gate made the warning disappear in
     * exactly the case it exists for.
     */
    const selectionDiffRaw = $derived(
        selectedCatalogSet
            ? diffCatalogSet(selectedCatalogSet, catalogInstance)
            : null,
    );

    async function persistCatalogReference(): Promise<void> {
        if (!workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            await WorkspaceRepo.setCatalogSetId(db, catalogSetId);
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        }
    }

    /**
     * Save the reference **and apply it**, which is what a reference means here.
     *
     * Selecting a configuration and walking away would leave the picker claiming
     * something the workspace is not using, so the two are one action. Applying
     * replaces the instance — and when the instance has content of its own, the
     * user is first asked whether to keep it as a configuration of their own.
     */
    /**
     * Whether a configuration can be applied without leaving the workspace
     * unusable.
     *
     * A workspace with no types or no priorities is not a working state: the
     * next ticket filed would carry the hardcoded fallback ids (`feature`,
     * `p2`) that this workspace's catalogs no longer define — a dangling
     * reference created by the very action meant to define them. A brand-new
     * configuration starts empty, so this is the first thing it hits.
     */
    function catalogSetApplicable(set: CatalogSet | null): boolean {
        return (
            !!set && set.types.length > 0 && set.priorities.length > 0
        );
    }

    async function saveCatalogReference(): Promise<void> {
        if (!catalogSetApplicable(selectedCatalogSet)) {
            notifications.add({
                kind: "warning",
                title: m.settings_catalog_not_applicable(),
                subtitle: m.settings_catalog_not_applicable_desc(),
                timeout: 7000,
            });
            return;
        }

        if (catalogSelection === catalogSetId) {
            // Nothing changed; applying again is still harmless and keeps the
            // button honest about what it does.
            if (selectedCatalogSet) {
                await applyCatalogSetToWorkspace(selectedCatalogSet, true);
            }
            return;
        }

        if (!selectedCatalogSet || selectionDiffRaw?.identical) {
            catalogSetId = catalogSelection;
            await persistCatalogReference();
            if (selectedCatalogSet) {
                await applyCatalogSetToWorkspace(selectedCatalogSet, true);
            } else {
                notifications.add({
                    kind: "success",
                    title: m.settings_catalog_reference_saved(),
                    timeout: 3000,
                });
            }
            return;
        }

        // The instance has content that applying would drop: ask first.
        forkBeforeReplace = true;
        replacePromptOpen = true;
    }

    /** Continue a reference save that was interrupted by the prompt. */
    async function confirmCatalogReference(): Promise<void> {
        replacePromptOpen = false;
        const set = selectedCatalogSet;
        if (!set) return;

        if (forkBeforeReplace) {
            catalogApplying = true;
            try {
                const kept = normalizeCatalogSet({
                    name: workspace.meta?.name || LEGACY_CATALOG_NAME,
                    description: "",
                    types: catalogInstance.types,
                    priorities: catalogInstance.priorities,
                    tags: catalogInstance.tags,
                });
                await commitCatalogSets([...catalogSets, kept]);
            } catch (error) {
                notifications.add({
                    kind: "error",
                    title: m.settings_save_failed(),
                    subtitle: String(error),
                    timeout: 5000,
                });
                catalogApplying = false;
                return;
            }
            catalogApplying = false;
        }

        catalogSetId = catalogSelection;
        await persistCatalogReference();
        await applyCatalogSetToWorkspace(set, true);
    }

    /**
     * Bring this workspace's catalogs to a configuration.
     *
     * `replace` is the difference between the two buttons on this page:
     *
     *   - `false` (Apply) adds and updates, and leaves anything of the
     *     workspace's own alone — a non-destructive "top up from the rules";
     *   - `true` (Save reference) makes the instance *be* the configuration,
     *     removing the rows it does not have.
     *
     * Even then, nothing a ticket points at is removed: such a row is kept and
     * reported, because a ticket showing `TY-ABC123` is worse than a catalog with
     * one stale entry.
     */
    async function applyCatalogSetToWorkspace(
        set: CatalogSet,
        replace: boolean,
    ): Promise<void> {
        catalogApplying = true;
        let created = 0;
        let updated = 0;
        let removed = 0;
        let kept = 0;
        try {
            const usage = replace && workspace.path
                ? await (async () => {
                      const db = await getDb(workspace.path!);
                      return CatalogUsageRepo.collectCatalogUsage(db);
                  })()
                : null;

            const existingTypes = new Set(ticketTypesApi.types.map((t) => t.id));
            for (const rule of set.types) {
                const payload = {
                    id: rule.id,
                    name: rule.name,
                    color: rule.color,
                    icon: rule.icon,
                    is_default: rule.is_default,
                };
                if (existingTypes.has(rule.id)) {
                    await ticketTypesApi.update(rule.id, payload);
                    updated += 1;
                } else {
                    await ticketTypesApi.create(payload);
                    created += 1;
                }
            }

            const existingPriorities = new Set(
                ticketPrioritiesApi.priorities.map((p) => p.id),
            );
            for (const rule of set.priorities) {
                const payload = {
                    id: rule.id,
                    name: rule.name,
                    color: rule.color,
                    rank: rule.rank,
                    is_default: rule.is_default,
                };
                if (existingPriorities.has(rule.id)) {
                    await ticketPrioritiesApi.update(rule.id, payload);
                    updated += 1;
                } else {
                    await ticketPrioritiesApi.create(payload);
                    created += 1;
                }
            }

            for (const rule of set.tags) {
                const existing = tagsApi.tags.find((tag) => tag.name === rule.name);
                if (existing) {
                    await tagsApi.update(existing.id, {
                        name: rule.name,
                        color: rule.color,
                    });
                    updated += 1;
                } else {
                    await tagsApi.create({ name: rule.name, color: rule.color });
                    created += 1;
                }
            }

            if (replace && usage) {
                const configTypeIds = new Set(set.types.map((rule) => rule.id));
                for (const type of ticketTypesApi.activeTypes) {
                    if (configTypeIds.has(type.id)) continue;
                    // A row a ticket points at cannot be deleted — that ticket
                    // would fall back to showing a raw id. Retiring it is what
                    // makes the *active* catalog equal the configuration while
                    // the ticket keeps resolving.
                    await ticketTypesApi.setRetired(
                        type.id,
                        usage.types.has(type.id),
                    );
                    if (usage.types.has(type.id)) kept += 1;
                    else removed += 1;
                }

                const configPriorityIds = new Set(
                    set.priorities.map((rule) => rule.id),
                );
                for (const priority of ticketPrioritiesApi.activePriorities) {
                    if (configPriorityIds.has(priority.id)) continue;
                    await ticketPrioritiesApi.setRetired(
                        priority.id,
                        usage.priorities.has(priority.id),
                    );
                    if (usage.priorities.has(priority.id)) kept += 1;
                    else removed += 1;
                }

                const configTagNames = new Set(set.tags.map((rule) => rule.name));
                for (const tag of tagsApi.activeTags) {
                    if (configTagNames.has(tag.name)) continue;
                    await tagsApi.setRetired(tag.id, usage.tags.has(tag.name));
                    if (usage.tags.has(tag.name)) kept += 1;
                    else removed += 1;
                }
            }

            notifications.add({
                kind: "success",
                title: replace
                    ? m.settings_catalog_replaced({ created, updated, removed })
                    : m.settings_catalog_applied({ created, updated }),
                subtitle:
                    kept > 0
                        ? m.settings_catalog_kept_in_use({ count: kept })
                        : m.settings_catalog_applied_desc(),
                timeout: 6000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
            await refreshCatalogUsage();
        } finally {
            catalogApplying = false;
        }
    }

    // ── The built-in cannot be replaced, only forked ──────────────────────
    let forkPromptOpen = $state(false);

    /**
     * The up direction, for a body the user owns: this workspace's corrections
     * become the configuration, so other workspaces can pick them up.
     *
     * A built-in body cannot be overwritten — "restore the product default" has to
     * keep meaning something — so that path asks whether to fork instead.
     */
    async function overwriteCatalogSetFromWorkspace(): Promise<void> {
        const set = referencedCatalogSet;
        if (!set) return;

        if (isBuiltinCatalogSet(set.id)) {
            forkPromptOpen = true;
            return;
        }

        catalogApplying = true;
        try {
            const replacement = normalizeCatalogSet({
                id: set.id,
                name: set.name,
                description: set.description,
                types: catalogInstance.types,
                priorities: catalogInstance.priorities,
                tags: catalogInstance.tags,
            });
            await commitCatalogSets(
                catalogSets.map((entry) =>
                    entry.id === set.id ? replacement : entry,
                ),
            );
            notifications.add({
                kind: "success",
                title: m.settings_catalog_overwritten(),
                subtitle: m.settings_catalog_overwritten_desc(),
                timeout: 5000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        } finally {
            catalogApplying = false;
        }
    }

    /**
     * Turn this workspace's evolved instance into a configuration of its own, and
     * reference it.
     *
     * The other direction from applying: whatever this workspace has grown —
     * extra levels, renamed entries, its own tags — becomes the app-level body,
     * so other workspaces can adopt it. Named for the workspace by default, and
     * renameable immediately.
     */
    async function forkCatalogFromWorkspace(): Promise<void> {
        forkPromptOpen = false;
        catalogApplying = true;
        try {
            const forked = normalizeCatalogSet({
                name: workspace.meta?.name || LEGACY_CATALOG_NAME,
                description: "",
                types: catalogInstance.types,
                priorities: catalogInstance.priorities,
                tags: catalogInstance.tags,
            });
            await commitCatalogSets([...catalogSets, forked]);

            // The workspace now points at what it just created, so the drift it
            // reported is gone and the reference says where the content went.
            catalogSetId = forked.id;
            catalogSelection = forked.id;
            await persistCatalogReference();
            openCatalogSetId = forked.id;

            notifications.add({
                kind: "success",
                title: m.settings_catalog_forked(),
                subtitle: m.settings_catalog_forked_desc(),
                timeout: 6000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        } finally {
            catalogApplying = false;
        }
    }

    /** Rows that left the active catalog but that tickets still point at. */
    const retiredEntries = $derived.by(() => {
        const entries: Array<{
            key: string;
            name: string;
            kind: string;
            restore: () => void;
        }> = [];
        for (const type of ticketTypesApi.types) {
            if (!type.retired_at) continue;
            entries.push({
                key: `type:${type.id}`,
                name: type.name,
                kind: m.settings_ticket_types(),
                restore: () => void ticketTypesApi.setRetired(type.id, false),
            });
        }
        for (const priority of ticketPrioritiesApi.priorities) {
            if (!priority.retired_at) continue;
            entries.push({
                key: `priority:${priority.id}`,
                name: priority.name,
                kind: m.catalog_title_priority(),
                restore: () =>
                    void ticketPrioritiesApi.setRetired(priority.id, false),
            });
        }
        for (const tag of tagsApi.tags) {
            if (!tag.retired_at) continue;
            entries.push({
                key: `tag:${tag.id}`,
                name: tag.name,
                kind: m.catalog_title_tag(),
                restore: () => void tagsApi.setRetired(tag.id, false),
            });
        }
        return entries;
    });

    /** Which rules differ, listed so the two sides can be reconciled by hand. */
    function catalogDiffLines(
        diff: CatalogSetDiffAnnotated | null,
    ): string[] {
        if (!diff) return [];
        const lines: string[] = [];

        const parts = (
            label: string,
            entry: CatalogDiff,
            kept: string[],
        ) => {
            if (entry.missing.length > 0) {
                lines.push(`${label} · ${m.settings_catalog_diff_missing()}: ${entry.missing.join(", ")}`);
            }
            if (entry.changed.length > 0) {
                lines.push(`${label} · ${m.settings_catalog_diff_changed()}: ${entry.changed.join(", ")}`);
            }
            if (entry.local.length > 0) {
                lines.push(`${label} · ${m.settings_catalog_diff_local()}: ${entry.local.join(", ")}`);
            }
            if (kept.length > 0) {
                lines.push(
                    `${label} · ${m.settings_catalog_diff_retained()}: ${kept.join(", ")}`,
                );
            }
        };

        parts(
            m.settings_ticket_types(),
            diff.types,
            diff.retained.types,
        );
        parts(
            m.catalog_title_priority(),
            diff.priorities,
            diff.retained.priorities,
        );
        parts(m.catalog_title_tag(), diff.tags, diff.retained.tags);
        return lines;
    }

    // ── Git configuration library (list ⇄ detail) ──────────────────────────

    /** The entry the detail view is editing: an existing one, or a draft. */
    const openGitConfig = $derived(
        gitConfigDraft ??
            gitConfigs.find((entry) => entry.id === openGitConfigId) ??
            null,
    );

    function startNewGitConfig() {
        gitConfigDraft = createGitConfig({ name: "" });
        openGitConfigId = gitConfigDraft.id;
    }

    function openGitConfigDetail(id: string) {
        gitConfigDraft = null;
        openGitConfigId = id;
    }

    function closeGitConfigDetail() {
        gitConfigDraft = null;
        openGitConfigId = null;
    }

    /**
     * A configuration without a remote URL is a half-filled form: the store
     * drops those on write, so saving is held back instead of letting the entry
     * the user is editing vanish without explanation.
     */
    function gitConfigUsable(entry: GitConfigEntry | null): boolean {
        return !!entry && entry.remote_url.trim().length > 0;
    }

    function gitConfigStatusLabel(status: GitConfigStatus): string {
        if (status === "ready") return m.settings_git_config_status_ready();
        if (status === "no-remote") return m.settings_git_config_status_no_remote();
        if (status === "unsupported-remote") {
            return m.settings_git_config_status_unsupported();
        }
        return m.settings_git_config_status_no_token();
    }

    function gitConfigStatusTag(
        status: GitConfigStatus,
    ): "green" | "magenta" | "cool-gray" {
        if (status === "ready") return "green";
        if (status === "no-remote") return "cool-gray";
        return "magenta";
    }

    /** Expiry badge for the token a configuration carries. */
    function configTokenStatus(entry: GitConfigEntry) {
        return tokenStatus(entry.token_expires_at, todayIso());
    }

    function tokenStatusLabel(status: TokenStatus): string {
        if (status === "expired") return m.settings_token_status_expired();
        if (status === "expiring") return m.settings_token_status_expiring();
        if (status === "valid") return m.settings_token_status_valid();
        return m.settings_token_status_unknown();
    }

    function tokenStatusTag(status: TokenStatus): "red" | "magenta" | "green" | "cool-gray" {
        if (status === "expired") return "red";
        if (status === "expiring") return "magenta";
        if (status === "valid") return "green";
        return "cool-gray";
    }

    /** Persist the library and re-read what was actually stored. */
    async function commitGitConfigs(next: GitConfigEntry[]): Promise<void> {
        await getAppConfig().setGitConfigs(next);
        gitConfigs = getAppConfig().gitConfigs.map((entry) => ({ ...entry }));
    }

    async function saveGitConfig(): Promise<void> {
        const entry = openGitConfig;
        if (!gitConfigUsable(entry) || !entry) return;

        gitAuthSaving = true;
        try {
            // A draft joins the list only at this point, so an abandoned form
            // never becomes a stored row.
            const next = gitConfigDraft
                ? [...gitConfigs, entry]
                : gitConfigs.map((item) => (item.id === entry.id ? entry : item));

            await commitGitConfigs(next);
            gitConfigDraft = null;
            openGitConfigId = entry.id;

            notifications.add({
                kind: "success",
                title: m.settings_git_auth_saved(),
                timeout: 3000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        } finally {
            gitAuthSaving = false;
        }
    }

    /**
     * Delete a configuration — from the list or from its detail view.
     *
     * A workspace still pointing at it must read as unconfigured rather than
     * keep authenticating with a stale copy, so the in-memory reference is
     * cleared too.
     */
    async function deleteGitConfig(id: string): Promise<void> {
        gitAuthSaving = true;
        try {
            await commitGitConfigs(gitConfigs.filter((entry) => entry.id !== id));
            if (openGitConfigId === id) closeGitConfigDetail();

            if (syncConfig.config.git_config_id === id) {
                syncConfig.config = {
                    ...syncConfig.config,
                    git_config_id: "",
                    remote_url: "",
                    access_token: "",
                };
            }

            notifications.add({
                kind: "success",
                title: m.settings_git_auth_saved(),
                timeout: 3000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        } finally {
            gitAuthSaving = false;
        }
    }

    /** Copy a configuration in place, without opening it. */
    async function duplicateConfig(id: string): Promise<void> {
        const source = gitConfigs.find((entry) => entry.id === id);
        if (!source) return;

        gitAuthSaving = true;
        try {
            await commitGitConfigs([...gitConfigs, duplicateGitConfig(source)]);
            notifications.add({
                kind: "success",
                title: m.settings_git_config_duplicated(),
                subtitle: m.settings_git_config_duplicated_desc(),
                timeout: 4000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        } finally {
            gitAuthSaving = false;
        }
    }

    // ── Portability: export to / import from a file ────────────────────────

    function importFailureLabel(
        reason: "invalid-json" | "unsupported-version" | "no-configs",
    ): string {
        if (reason === "unsupported-version") {
            return m.settings_git_config_import_bad_version();
        }
        if (reason === "no-configs") {
            return m.settings_git_config_import_empty();
        }
        return m.settings_git_config_import_unreadable();
    }

    /** Slug for a file name, so a single export is recognisable on disk. */
    function fileNameFor(entries: GitConfigEntry[]): string {
        const base = "worklog-git-configs";
        if (entries.length !== 1) return base;
        const slug = entries[0].name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return slug ? `${base}-${slug}` : `${base}-single`;
    }

    /**
     * Export configurations to a file.
     *
     * Called with one entry from a configuration's detail window (single
     * export) and with the whole library from the list header (batch export).
     */
    async function exportGitConfigs(
        includeSecrets: boolean,
        entries: GitConfigEntry[] = gitConfigs,
    ): Promise<void> {
        if (entries.length === 0) return;

        try {
            const filePath = await saveFileDialog({
                title: m.settings_git_config_export_title(),
                defaultPath: `${fileNameFor(entries)}${includeSecrets ? "-with-tokens" : ""}.json`,
                filters: [{ name: "JSON", extensions: ["json"] }],
            });
            if (!filePath) return;

            await writeTextFile(
                filePath,
                serializeGitConfigs(entries, { includeSecrets }),
            );

            notifications.add({
                kind: "success",
                title: m.settings_git_config_exported(),
                subtitle: includeSecrets
                    ? m.settings_git_config_exported_secrets()
                    : undefined,
                timeout: includeSecrets ? 8000 : 3000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        }
    }

    async function importGitConfigs(): Promise<void> {
        try {
            const selected = await openFileDialog({
                multiple: false,
                filters: [{ name: "JSON", extensions: ["json"] }],
            });
            const path = Array.isArray(selected) ? selected[0] : selected;
            if (!path) return;

            const result = deserializeGitConfigs(await readTextFile(path));

            if (!result.ok) {
                notifications.add({
                    kind: "error",
                    title: m.settings_git_config_import_failed(),
                    subtitle: importFailureLabel(result.reason),
                    timeout: 6000,
                });
                return;
            }

            // Importing is additive: the parser gives every entry a fresh id, so
            // an import can never overwrite a configuration already here.
            await commitGitConfigs([...gitConfigs, ...result.configs]);

            notifications.add({
                kind: "success",
                title: m.settings_git_config_imported({
                    count: result.configs.length,
                }),
                subtitle: result.includesSecrets
                    ? m.settings_git_config_imported_secrets()
                    : m.settings_git_config_imported_no_secrets(),
                timeout: 6000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_git_config_import_failed(),
                subtitle: String(error),
                timeout: 6000,
            });
        }
    }

    async function loadSyncConfig() {
        if (!workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            await syncConfig.load(db);
            syncGitConfigId = syncConfig.config.git_config_id;
            syncBranch = syncConfig.config.branch;
            syncAutoSync = syncConfig.config.auto_sync;
            syncAutoSyncInterval = syncConfig.config.auto_sync_interval;

            // The workspace's reference to an app-level catalog configuration.
            // An unreferenced workspace uses the product's built-in
            // configuration: the reference has to point at *something*, and that
            // is what its rows were seeded from.
            catalogSetId =
                (await WorkspaceRepo.getCatalogSetId(db)) ||
                BUILTIN_CATALOG_SET_ID;
            catalogSelection = catalogSetId;
            await refreshCatalogUsage();

            // Check git availability
            const engine = new SyncEngine(workspace.path);
            gitAvailable = await engine.isGitAvailable();
        } catch (e) {
            console.error("Failed to load sync config", e);
        }
    }

    /**
     * Save the workspace's *reference* plus its own sync behaviour.
     *
     * The connection itself (URL, branch, identity, token) is not written here:
     * it belongs to the referenced Git configuration and is never copied into
     * the workspace.
     */
    async function saveSyncConfig() {
        if (!workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            syncConfig.config = {
                ...syncConfig.config,
                git_config_id: syncGitConfigId,
                branch: syncBranch || "main",
                auto_sync: syncAutoSync,
                auto_sync_interval: syncAutoSyncInterval,
            };
            await syncConfig.save(db);
            notifications.add({
                kind: "success",
                title: m.settings_sync_saved_title(),
                subtitle: m.settings_sync_saved_subtitle(),
                timeout: 3000,
            });
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.settings_save_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        }
    }

    async function handleSyncPush() {
        if (!workspace.path || syncState.isSyncing) return;
        syncLoading = true;
        syncLoadingMessage = m.settings_pushing_remote();
        syncConfig.setStatus("pushing");
        try {
            const db = await getDb(workspace.path);
            const result = await runSyncOperation(
                workspace.path,
                syncConfig.config,
                "push",
            );

            if (result.status === "success") {
                syncConfig.updateLastSynced(result.timestamp);
                await syncConfig.save(db);
                notifications.add({
                    kind: "success",
                    title: m.sync_push_success(),
                    subtitle: result.message,
                    timeout: 3000,
                });
            } else {
                if (result.status === "branch_mismatch") {
                    syncBranchMismatch = result;
                }
                if (
                    result.status === "remote_has_data" ||
                    result.status === "conflict"
                ) {
                    requestSyncResolution(result);
                }
                notifications.add({
                    kind: "error",
                    title: m.sync_push_failed(),
                    subtitle: result.message,
                    timeout: 5000,
                });
            }
            syncConfig.setStatus(
                result.status === "success" ? "idle" : "error",
            );
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.sync_push_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
            syncConfig.setStatus("error");
        } finally {
            syncLoading = false;
            syncLoadingMessage = "";
        }
    }

    async function handleSyncPull() {
        if (!workspace.path || syncState.isSyncing) return;
        syncLoading = true;
        syncLoadingMessage = m.settings_pulling_remote();
        syncConfig.setStatus("pulling");
        try {
            const db = await getDb(workspace.path);
            const result = await runSyncOperation(
                workspace.path,
                syncConfig.config,
                "pull",
            );

            if (result.status === "success") {
                syncConfig.updateLastSynced(result.timestamp);
                await syncConfig.save(db);
                notifications.add({
                    kind: "success",
                    title: m.sync_pull_success(),
                    subtitle: result.message,
                    timeout: 3000,
                });
                window.location.reload();
            } else if (result.status === "conflict") {
                requestSyncResolution(result);
                notifications.add({
                    kind: "warning",
                    title: m.settings_merge_conflict(),
                    subtitle: result.message,
                    timeout: 8000,
                });
                syncConfig.setStatus("conflict");
            } else {
                if (result.status === "branch_mismatch") {
                    syncBranchMismatch = result;
                }
                notifications.add({
                    kind: "error",
                    title: m.sync_pull_failed(),
                    subtitle: result.message,
                    timeout: 5000,
                });
                syncConfig.setStatus("error");
            }
        } catch (error) {
            notifications.add({
                kind: "error",
                title: m.sync_pull_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
            syncConfig.setStatus("error");
        } finally {
            syncLoading = false;
            syncLoadingMessage = "";
        }
    }

    /**
     * Follow the remote's default branch.
     *
     * The branch is workspace-scoped, so this is a purely local change: fixing
     * it here does not reach into the shared Git configuration, and does not
     * affect any other workspace that references the same connection.
     */
    async function useRemoteDefaultBranch() {
        const branch = syncBranchMismatch?.remoteDefaultBranch;
        if (!branch) return;

        syncBranch = branch;
        syncBranchMismatch = null;
        notifications.add({
            kind: "success",
            title: m.sync_branch_updated_title(),
            subtitle: m.sync_branch_updated_message({ branch }),
            timeout: 3000,
        });
    }

    function formatSyncTimestamp(timestamp: string): string {
        return formatDateTime(new Date(timestamp), {
            dateStyle: "medium",
            timeStyle: "short",
        });
    }

    // ── Navigation ─────────────────────────────────────────────────────────
    function goToBoards() {
        void goto("/workspace");
    }

    function refreshWorkspaceState() {
        void workspace.init();
    }

    // ── Workspace switching ────────────────────────────────────────────────
    function handleSwitchWorkspace() {
        void workspaceActions.switchWorkspace();
    }

    function handleCloseWorkspace() {
        void workspaceActions.closeWorkspace();
    }

    // ── Export / Import ────────────────────────────────────────────────────
    async function handleExport() {
        if (workspace.status !== "ready" || !workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            const options: ExportOptions = {
                format: exportFormat,
                mode: exportMode,
            };
            const success = await exportDatabaseWithOptions(db, options);
            if (success) {
                notifications.add({
                    kind: "success",
                    title: m.settings_export_successful(),
                    subtitle: m.settings_export_success_msg({ format: exportFormat.toUpperCase(), mode: exportModeLabel() }),
                    timeout: 3000,
                });
            }
        } catch (error) {
            console.error(m.settings_export_failed_log(), error);
            notifications.add({
                kind: "error",
                title: m.settings_export_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        }
    }

    async function handleImport() {
        if (workspace.status !== "ready" || !workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            const result = await importFromFile(db, "merge");
            if (result) {
                notifications.add({
                    kind: "success",
                    title: m.settings_import_successful(),
                    subtitle: m.settings_import_success_msg({ boards: result.boardsCreated, tickets: result.ticketsCreated, updated: result.ticketsUpdated }),
                    timeout: 5000,
                });
                window.location.reload();
            }
        } catch (error) {
            console.error(m.settings_import_failed_log(), error);
            notifications.add({
                kind: "error",
                title: m.settings_import_failed(),
                subtitle: String(error),
                timeout: 5000,
            });
        }
    }

    async function handleCheckForUpdates() {
        await checkForUpdate((s) => {
            updateState = s;
        });
    }

    async function openReleasesPage() {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(RELEASES_URL);
    }

    function exportModeLabel(): string {
        return exportMode === "single-file"
            ? m.settings_export_mode_single_file()
            : m.settings_export_mode_folder();
    }

    function formatBytes(bytes: number): string {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    // ── Derived ────────────────────────────────────────────────────────────
    // "Sync is configured" needs a reference that resolves *and* a credential:
    // the workspace stores only the reference, so both halves are resolved from
    // the app-level library here.
    const syncReference = $derived(
        gitConfigs.find((entry) => entry.id === syncGitConfigId) ?? null,
    );
    const syncConfigured = $derived(
        !!syncReference?.remote_url && !!syncReference?.token,
    );
    const syncStatusLabel = $derived.by(() => {
        const s = syncConfig.status;
        if (s === "not_configured") return m.settings_sync_status_not_configured();
        if (s === "idle") return m.settings_sync_status_ready();
        if (s === "pushing") return m.settings_sync_status_pushing();
        if (s === "pulling") return m.settings_sync_status_pulling();
        if (s === "conflict") return m.settings_sync_status_conflict();
        if (s === "error") return m.sync_error();
        return s;
    });
    const syncStatusColor = $derived.by(
        (): "green" | "red" | "blue" | "warm-gray" | "magenta" => {
            const s = syncConfig.status;
            if (s === "idle") return "green";
            if (s === "pushing" || s === "pulling") return "blue";
            if (s === "error") return "red";
            if (s === "conflict") return "magenta";
            return "warm-gray";
        },
    );

    async function handleSeedPerformance() {
        if (!workspace.path) return;
        try {
            const db = await getDb(workspace.path);
            notifications.add({
                kind: "info",
                title: m.settings_seeding(),
                subtitle: m.settings_seeding_subtitle(),
                timeout: 3000,
            });
            await seedLazyLoadingTest(db);
            notifications.add({
                kind: "success",
                title: m.settings_seeding_complete(),
                subtitle: m.settings_seeding_complete_subtitle(),
                timeout: 5000,
            });
            void workspace.init(); // Refresh workspace state
        } catch (e) {
            notifications.add({
                kind: "error",
                title: m.settings_seeding_failed(),
                subtitle: String(e),
                timeout: 5000,
            });
        }
    }

    // ── Events Viewer State ───────────────────────────────────────────────
    let events = $state<EventRecord[]>([]);
    let eventsLoading = $state(false);
    let eventsError = $state<string | null>(null);
    let expandedEventId = $state<string | null>(null);

    async function loadEvents() {
        if (!workspace.path) return;
        eventsLoading = true;
        eventsError = null;
        try {
            const db = await getDb(workspace.path);
            events = await EventRepo.listEvents(db, { desc: true, limit: 200 });
        } catch (e) {
            eventsError = String(e);
            events = [];
        } finally {
            eventsLoading = false;
        }
    }

    function toggleEventPayload(eventId: string) {
        expandedEventId = expandedEventId === eventId ? null : eventId;
    }

    function formatPayload(payload: Record<string, unknown>): string {
        return JSON.stringify(payload, null, 2);
    }

    function formatTimestamp(ts: string): string {
        const d = new Date(ts);
        return d.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    }

    function truncateId(id: string): string {
        return id.length > 14 ? id.slice(0, 14) + "…" : id;
    }

    // ── Filter state for events ────────────────────────────────────────────
    let eventTypeFilter = $state<string>("all");

    const filteredEvents = $derived(
        eventTypeFilter === "all"
            ? events
            : events.filter((e) => e.event_type === eventTypeFilter),
    );

    // Derive unique event types for the filter dropdown
    const availableEventTypes = $derived<string[]>([
        "all",
        ...new Set(events.map((e) => e.event_type)),
    ]);

    // @ts-ignore
    const version = __APP_VERSION__;
    function matchesSearch(text: string) {
        if (!searchQuery) return true;
        return text.toLowerCase().includes(searchQuery.toLowerCase());
    }
</script>

<div class="settings-layout">
    <!-- Sidebar -->
    <aside class="settings-sidebar">
        <header class="sidebar-header">
            <Button
                kind="ghost"
                iconDescription={m.board_back_to_workspace()}
                icon={ArrowLeft}
                onclick={goToBoards}
            />
            <span>{m.sidebar_settings()}</span>
        </header>

        <nav class="sidebar-nav">
            {#each scopeGroups as group (group.scope)}
                <div class="nav-group">
                    <!-- The scope is the parent of the items below it, so it
                         outranks them typographically instead of sitting above
                         them as small print. Its explanation is a tooltip: four
                         paragraphs of chrome in a 260px sidebar drowned the
                         menu they were meant to organise. -->
                    <div class="nav-group-header" title={group.description}>
                        {group.label}
                    </div>

                    {#each group.categories as category (category.id)}
                        {@const children = subPages[category.id] ?? []}
                        <button
                            class="nav-item"
                            class:section-active={isEntryActive(category.id)}
                            onclick={() =>
                                (activeCategory = firstPageOf(category.id))}
                        >
                            <category.icon size={20} />
                            <span>{category.label}</span>
                        </button>

                        {#if children.length > 0}
                            <div class="nav-subitems">
                                {#each children as child (child.id)}
                                    <button
                                        class="nav-item nav-item--child"
                                        class:active={activeCategory ===
                                            child.id}
                                        onclick={() =>
                                            (activeCategory = child.id)}
                                    >
                                        <span>{child.label()}</span>
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    {/each}
                </div>
            {/each}
        </nav>

        <footer class="sidebar-footer">
            <div class="app-version">
                v{version}
            </div>
            <Button
                kind="ghost"
                size="small"
                icon={Renew}
                onclick={refreshWorkspaceState}
            >
                {m.settings_refresh()}
            </Button>
        </footer>
    </aside>

    <!-- Main Content -->
    <main class="settings-content">
        <header class="content-header">
            <div class="search-container">
                <Search size={16} />
                <input
                    type="text"
                    placeholder={m.settings_search_placeholder()}
                    bind:value={searchQuery}
                />
            </div>
            <div class="breadcrumbs">
                {m.sidebar_settings()} &gt;
                <span class="crumb-scope">{scopeLabel(activeNav.scope)}</span>
                {#if activeNav.parent}
                    &gt; {activeNav.parent} &gt; {activeNav.label}
                {:else}
                    &gt; {activeNav.label}
                {/if}
            </div>
        </header>

        <div class="content-body">
            <!-- ── Workspace Category (workspace level) ────────────────── -->
            {#if activeCategory === "workspace"}
                <div class="category-view">
                    {#if matchesSearch("Workspace Information Database schema version Worklog version")}
                        <section class="settings-section">
                            <h2>{m.settings_workspace_info()}</h2>
                            <div class="settings-card">
                                <div class="settings-grid">
                                    <TextInput
                                        id="workspace-name"
                                        labelText={m.settings_workspace_name()}
                                        value={workspaceName}
                                        readonly
                                    />
                                    <TextInput
                                        id="workspace-status"
                                        labelText={m.settings_workspace_status()}
                                        value={workspaceStatusLabel}
                                        readonly
                                    />
                                    <TextInput
                                        id="workspace-schema"
                                        labelText={m.settings_database_schema_version()}
                                        value={schemaVersion}
                                        readonly
                                    />
                                    <TextArea
                                        id="workspace-path"
                                        labelText={m.settings_workspace_path()}
                                        value={workspacePath}
                                        rows={3}
                                        readonly
                                    />
                                    <TextInput
                                        id="app-version"
                                        labelText={m.settings_worklog_version()}
                                        value={version}
                                        readonly
                                    />
                                </div>

                                <!-- Workspace is switchable, not just readable -->
                                <div class="workspace-actions">
                                    <Button
                                        kind="ghost"
                                        size="small"
                                        icon={FolderOpen}
                                        onclick={handleSwitchWorkspace}
                                    >
                                        {m.workspace_switch()}
                                    </Button>
                                    <Button
                                        kind="danger-ghost"
                                        size="small"
                                        icon={Close}
                                        onclick={handleCloseWorkspace}
                                    >
                                        {m.workspace_close()}
                                    </Button>
                                    <span class="workspace-actions-hint">
                                        {m.workspace_switch_subtitle()}
                                    </span>
                                </div>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Git Authentication (app level, under Identity) ───────── -->
            <!--
                 A library of named Git connections (list), each opened in a
                 detail view. The workspace lives elsewhere and only references
                 one of these.
            -->
            {#if activeCategory === "git-auth"}
                <div class="category-view">
                    {#if matchesSearch("Git Authentication Commit Name Email Access Token Remote Branch GitHub Credentials Expiry Scope")}
                        <section class="settings-section">
                            {#if openGitConfig}
                                <!-- ── Detail: one Git configuration ─────────── -->
                                <Button
                                    kind="ghost"
                                    size="small"
                                    icon={ArrowLeft}
                                    onclick={closeGitConfigDetail}
                                >
                                    {m.settings_git_config_back()}
                                </Button>

                                <h2>
                                    {openGitConfig.name ||
                                        m.settings_git_config_untitled()}
                                </h2>
                                <p class="section-desc">
                                    {m.settings_git_config_detail_desc()}
                                </p>

                                <div class="settings-card">
                                    <div class="settings-grid">
                                        <TextInput
                                            id="git-config-name"
                                            labelText={m.settings_git_config_name()}
                                            placeholder={m.settings_git_config_name_placeholder()}
                                            bind:value={openGitConfig.name}
                                        />
                                        <TextInput
                                            id="git-config-remote"
                                            labelText={m.settings_git_config_remote()}
                                            placeholder="https://github.com/user/repo.git"
                                            bind:value={openGitConfig.remote_url}
                                        />
                                        <TextInput
                                            id="git-config-git-name"
                                            labelText={m.settings_git_name()}
                                            placeholder={m.settings_git_name_placeholder()}
                                            bind:value={openGitConfig.git_name}
                                        />
                                        <TextInput
                                            id="git-config-git-email"
                                            labelText={m.settings_git_email()}
                                            placeholder="user@example.com"
                                            bind:value={openGitConfig.git_email}
                                        />
                                    </div>

                                    <p class="help-text">
                                        {m.settings_git_auth_name_desc()}
                                    </p>

                                    <TextInput
                                        id="git-config-description"
                                        labelText={m.settings_git_config_description()}
                                        placeholder={m.settings_git_config_desc_placeholder()}
                                        bind:value={openGitConfig.description}
                                    />

                                    <div class="token-field">
                                        <PasswordInput
                                            id="git-config-token"
                                            labelText={m.settings_git_config_token()}
                                            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                                            bind:value={openGitConfig.token}
                                        />
                                        <p class="help-text">
                                            {m.settings_git_config_token_desc()}
                                        </p>
                                    </div>

                                    <div class="token-expiry">
                                        <label
                                            class="token-expiry-label"
                                            for="git-config-token-expires"
                                            >{m.settings_token_expires()}</label
                                        >
                                        <input
                                            id="git-config-token-expires"
                                            class="token-date"
                                            type="date"
                                            bind:value={openGitConfig.token_expires_at}
                                        />
                                        <Tag
                                            type={tokenStatusTag(
                                                configTokenStatus(openGitConfig),
                                            )}
                                            size="sm"
                                            >{tokenStatusLabel(
                                                configTokenStatus(openGitConfig),
                                            )}</Tag
                                        >
                                    </div>
                                    <p class="help-text">
                                        {m.settings_git_config_token_expires_desc()}
                                    </p>

                                    {#if !gitConfigUsable(openGitConfig)}
                                        <InlineNotification
                                            kind="warning"
                                            lowContrast
                                            title={m.settings_git_config_remote_required()}
                                            hideCloseButton
                                        />
                                    {:else if !isSupportedRemoteUrl(openGitConfig.remote_url)}
                                        <InlineNotification
                                            kind="warning"
                                            lowContrast
                                            title={m.settings_git_config_status_unsupported()}
                                            hideCloseButton
                                        />
                                    {/if}

                                    <div class="actions-group">
                                        <Button
                                            kind="primary"
                                            onclick={saveGitConfig}
                                            disabled={gitAuthSaving ||
                                                !gitConfigUsable(openGitConfig)}
                                        >
                                            {m.settings_save_configuration()}
                                        </Button>
                                        {#if !gitConfigDraft}
                                            <Button
                                                kind="ghost"
                                                size="small"
                                                icon={Download}
                                                onclick={() =>
                                                    exportGitConfigs(false, [
                                                        openGitConfig,
                                                    ])}
                                            >
                                                {m.settings_git_config_export()}
                                            </Button>
                                            <Button
                                                kind="ghost"
                                                size="small"
                                                icon={Download}
                                                title={m.settings_git_config_export_secrets_warning()}
                                                onclick={() =>
                                                    exportGitConfigs(true, [
                                                        openGitConfig,
                                                    ])}
                                            >
                                                {m.settings_git_config_export_secrets()}
                                            </Button>
                                            <Button
                                                kind="danger-ghost"
                                                icon={TrashCan}
                                                disabled={gitAuthSaving}
                                                onclick={() =>
                                                    deleteGitConfig(
                                                        openGitConfig.id,
                                                    )}
                                            >
                                                {m.settings_git_config_delete()}
                                            </Button>
                                        {/if}
                                    </div>
                                </div>
                            {:else}
                                <!-- ── List: the library ─────────────────────── -->
                                <h2>{m.settings_identity_git_auth()}</h2>
                                <p class="section-desc">
                                    {m.settings_git_auth_desc()}
                                </p>

                                <div class="settings-card">
                                    <!-- Batch actions sit with the heading, to
                                         the right of it: they act on the whole
                                         library, not on one entry. A single
                                         export lives inside that entry's own
                                         window. -->
                                    <div class="card-head">
                                        <div class="header-with-tag">
                                            <h3>{m.settings_git_configs_title()}</h3>
                                            <Tag type="cool-gray" size="sm"
                                                >{gitConfigs.length}</Tag
                                            >
                                        </div>
                                        <div class="card-head-actions">
                                            <Button
                                                kind="ghost"
                                                size="small"
                                                icon={Download}
                                                disabled={gitConfigs.length === 0}
                                                onclick={() =>
                                                    exportGitConfigs(false)}
                                            >
                                                {m.settings_git_config_export()}
                                            </Button>
                                            <Button
                                                kind="ghost"
                                                size="small"
                                                icon={Download}
                                                title={m.settings_git_config_export_secrets_warning()}
                                                disabled={gitConfigs.length === 0}
                                                onclick={() =>
                                                    exportGitConfigs(true)}
                                            >
                                                {m.settings_git_config_export_secrets()}
                                            </Button>
                                            <Button
                                                kind="ghost"
                                                size="small"
                                                icon={Upload}
                                                onclick={importGitConfigs}
                                            >
                                                {m.settings_git_config_import()}
                                            </Button>
                                        </div>
                                    </div>
                                    <p class="help-text">
                                        {m.settings_git_configs_desc()}
                                    </p>

                                    {#if gitConfigs.length === 0}
                                        <InlineNotification
                                            kind="info"
                                            lowContrast
                                            title={m.settings_git_config_empty()}
                                            hideCloseButton
                                        />
                                    {/if}

                                    <div class="token-list">
                                        {#each gitConfigs as entry (entry.id)}
                                            {@const status = gitConfigStatus(
                                                entry,
                                            )}
                                            <div class="config-row">
                                                <button
                                                    class="config-row-open"
                                                    onclick={() =>
                                                        openGitConfigDetail(
                                                            entry.id,
                                                        )}
                                                >
                                                    <span class="config-row-main">
                                                        <span
                                                            class="config-row-name"
                                                            >{entry.name ||
                                                                m.settings_git_config_untitled()}</span
                                                        >
                                                        <span
                                                            class="config-row-meta"
                                                            >{describeRemote(
                                                                entry.remote_url,
                                                            )}</span
                                                        >
                                                    </span>
                                                    <Tag
                                                        type={gitConfigStatusTag(
                                                            status,
                                                        )}
                                                        size="sm"
                                                        >{gitConfigStatusLabel(
                                                            status,
                                                        )}</Tag
                                                    >
                                                </button>

                                                <!-- Row actions, so a
                                                     configuration can be copied
                                                     or removed without opening
                                                     it first. -->
                                                <div class="config-row-actions">
                                                    <Button
                                                        kind="ghost"
                                                        size="small"
                                                        icon={Copy}
                                                        iconDescription={m.settings_git_config_duplicate()}
                                                        disabled={gitAuthSaving}
                                                        onclick={() =>
                                                            duplicateConfig(
                                                                entry.id,
                                                            )}
                                                    />
                                                    <Button
                                                        kind="danger-ghost"
                                                        size="small"
                                                        icon={TrashCan}
                                                        iconDescription={m.settings_git_config_delete()}
                                                        disabled={gitAuthSaving}
                                                        onclick={() =>
                                                            deleteGitConfig(
                                                                entry.id,
                                                            )}
                                                    />
                                                </div>
                                            </div>
                                        {/each}
                                    </div>

                                    <div class="actions-group">
                                        <Button
                                            kind="ghost"
                                            size="small"
                                            icon={Add}
                                            onclick={startNewGitConfig}
                                        >
                                            {m.settings_git_config_new()}
                                        </Button>
                                    </div>
                                </div>


                            {/if}
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Updates Category (developer) ─────────────────────────── -->
            {#if activeCategory === "updates"}
                <div class="category-view">
                    {#if matchesSearch("Updates Check for updates Application")}
                        <section class="settings-section">
                            <h2>{m.settings_app_updates()}</h2>
                            <p class="section-desc">
                                {m.settings_updates_desc()}
                            </p>

                            <div class="settings-card updater-card">
                                {#if updateState.status === "idle"}
                                    <!-- Idle: show check button -->
                                    <div class="updater-idle">
                                        <div class="updater-current">
                                            <span class="updater-label"
                                                >{m.settings_current_version()}</span
                                            >
                                            <span class="updater-version"
                                                >v{version}</span
                                            >
                                        </div>
                                        <Button
                                            kind="primary"
                                            icon={Renew}
                                            onclick={handleCheckForUpdates}
                                        >
                                            {m.settings_check_for_updates()}
                                        </Button>
                                    </div>
                                {:else if updateState.status === "checking"}
                                    <!-- Checking: spinner -->
                                    <div class="updater-status-row">
                                        <InlineLoading
                                            description={m.settings_checking_updates()}
                                        />
                                    </div>
                                {:else if updateState.status === "no-update"}
                                    <!-- No update: success state -->
                                    <div
                                        class="updater-status-row updater-success"
                                    >
                                        <CheckmarkOutline size={20} />
                                        <div class="updater-status-text">
                                            <strong>{m.settings_up_to_date()}</strong>
                                            <span
                                                >{m.settings_latest_version({ version })}</span
                                            >
                                        </div>
                                        <Button
                                            kind="ghost"
                                            size="small"
                                            icon={Renew}
                                            onclick={handleCheckForUpdates}
                                        >
                                            {m.settings_check_again()}
                                        </Button>
                                    </div>
                                {:else if updateState.status === "update-available"}
                                    <!-- Update available: show info + manual download button -->
                                    <div class="updater-available">
                                        <div class="updater-available-header">
                                            <div class="updater-version-badge">
                                                <Tag type="green" size="sm"
                                                    >{m.settings_new_version()}</Tag
                                                >
                                                <span
                                                    class="updater-new-version"
                                                    >v{updateState.info
                                                        ?.version}</span
                                                >
                                            </div>
                                            {#if updateState.info?.date}
                                                <span class="updater-date">
                                                    {new Date(
                                                        updateState.info.date,
                                                    ).toLocaleDateString(
                                                        undefined,
                                                        {
                                                            year: "numeric",
                                                            month: "short",
                                                            day: "numeric",
                                                        },
                                                    )}
                                                </span>
                                            {/if}
                                        </div>
                                        {#if updateState.info?.body}
                                            <div class="updater-notes">
                                                <span
                                                    class="updater-notes-label"
                                                    >{m.settings_release_notes()}</span
                                                >
                                                <p class="updater-notes-body">
                                                    {updateState.info.body}
                                                </p>
                                            </div>
                                        {/if}
                                        <div class="updater-actions">
                                            <Button
                                                kind="primary"
                                                icon={Launch}
                                                onclick={openReleasesPage}
                                            >
                                                {m.settings_go_to_download_page()}
                                            </Button>
                                            <Button
                                                kind="ghost"
                                                size="small"
                                                onclick={() => {
                                                    updateState = {
                                                        status: "idle",
                                                        info: null,
                                                        progress: {
                                                            downloaded: 0,
                                                            contentLength: 0,
                                                            percent: 0,
                                                        },
                                                        errorMessage: null,
                                                    };
                                                }}
                                            >
                                                {m.settings_dismiss()}
                                            </Button>
                                        </div>
                                    </div>
                                {:else if updateState.status === "install-failed"}
                                    <!-- Install failed: offer manual download -->
                                    <div class="updater-install-failed">
                                        <div
                                            class="updater-status-row updater-error"
                                        >
                                            <WarningAlt size={20} />
                                            <div class="updater-status-text">
                                                <strong
                                                    >{m.settings_auto_update_unavailable()}</strong
                                                >
                                                <span
                                                    >{updateState.errorMessage}</span
                                                >
                                            </div>
                                        </div>
                                        <div class="updater-actions">
                                            <Button
                                                kind="primary"
                                                icon={Launch}
                                                onclick={openReleasesPage}
                                            >
                                                {m.settings_download_manually()}
                                            </Button>
                                            <Button
                                                kind="ghost"
                                                size="small"
                                                onclick={() => {
                                                    updateState = {
                                                        status: "idle",
                                                        info: null,
                                                        progress: {
                                                            downloaded: 0,
                                                            contentLength: 0,
                                                            percent: 0,
                                                        },
                                                        errorMessage: null,
                                                    };
                                                }}
                                            >
                                                {m.settings_dismiss()}
                                            </Button>
                                        </div>
                                    </div>
                                {:else if updateState.status === "error"}
                                    <!-- Error state -->
                                    <div
                                        class="updater-status-row updater-error"
                                    >
                                        <WarningAlt size={20} />
                                        <div class="updater-status-text">
                                            <strong>{m.settings_update_failed()}</strong>
                                            <span
                                                >{updateState.errorMessage ??
                                                    m.settings_unknown_error()}</span
                                            >
                                        </div>
                                        <Button
                                            kind="ghost"
                                            size="small"
                                            icon={Renew}
                                            onclick={handleCheckForUpdates}
                                        >
                                            {m.settings_retry()}
                                        </Button>
                                    </div>
                                {/if}
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Board Category (panel level) ─────────────────────────── -->
            <!-- An index, not a second editor: panel-level settings are edited
                 where their effect is visible. -->
            {#if activeCategory === "board"}
                <div class="category-view">
                    {#if matchesSearch("Board Panel Views Columns Tabs Kanban")}
                        <section class="settings-section">
                            <div class="header-with-tag">
                                <h2>{m.settings_category_board()}</h2>
                                <Tag type="teal" size="sm"
                                    >{m.settings_scope_board()}</Tag
                                >
                            </div>
                            <p class="section-desc">
                                {m.settings_scope_board_desc()}
                            </p>

                            <div class="settings-card">
                                {#if activeBoard}
                                    <div class="settings-grid">
                                        <TextInput
                                            id="board-panel-name"
                                            labelText={m.settings_board_current()}
                                            value={activeBoard.name}
                                            readonly
                                        />
                                        <TextInput
                                            id="board-panel-views"
                                            labelText={m.settings_board_views()}
                                            value={boardViewsLabel}
                                            readonly
                                        />
                                        <TextInput
                                            id="board-panel-columns"
                                            labelText={m.settings_board_columns()}
                                            value={m.settings_board_columns_summary(
                                                boardColumnStats,
                                            )}
                                            readonly
                                        />
                                    </div>

                                    <div class="workspace-actions">
                                        <Button
                                            kind="ghost"
                                            size="small"
                                            icon={Launch}
                                            onclick={openActiveBoard}
                                        >
                                            {m.settings_board_open()}
                                        </Button>
                                    </div>
                                {:else}
                                    <InlineNotification
                                        kind="info"
                                        lowContrast
                                        title={m.settings_board_empty_title()}
                                        subtitle={m.settings_board_empty_desc()}
                                        hideCloseButton
                                    />
                                {/if}

                                <p class="help-text">
                                    {m.settings_board_edit_hint()}
                                </p>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Appearance Category ────────────────────────────────── -->
            {#if activeCategory === "appearance"}
                <div class="category-view">
                    {#if matchesSearch("Language Locale English French Chinese Simplified Chinese 中文 简体中文")}
                        <section class="settings-section">
                            <h2>{m.settings_language()}</h2>
                            <p class="section-desc">
                                {m.settings_language_desc()}
                            </p>
                            <div class="settings-card">
                                <ContentSwitcher
                                    selectedIndex={Math.max(
                                        languageOptions.findIndex(
                                            (option) =>
                                                option.value ===
                                                getReactiveLocale(),
                                        ),
                                        0,
                                    )}
                                    on:change={(e) => {
                                        const index = e.detail;
                                        const newLang =
                                            languageOptions[index]?.value ??
                                            "en";
                                        setReactiveLocale(newLang);
                                        localStorage.setItem(
                                            "app_lang",
                                            newLang,
                                        );
                                    }}
                                >
                                    {#each languageOptions as option}
                                        <Switch text={option.label} />
                                    {/each}
                                </ContentSwitcher>
                            </div>
                        </section>
                    {/if}

                    {#if matchesSearch("Theme Dark Light System Mode")}
                        <section class="settings-section">
                            <h2>{m.settings_theme()}</h2>
                            <p class="section-desc">
                                {m.settings_theme_desc()}
                            </p>
                            <div class="settings-card">
                                <div class="theme-selector">
                                    <button
                                        class="theme-card"
                                        class:selected={appAppearance.theme ===
                                            "light"}
                                        onclick={() =>
                                            (appAppearance.theme = "light")}
                                    >
                                        <Sun size={24} />
                                        <span>{m.settings_theme_light()}</span>
                                    </button>
                                    <button
                                        class="theme-card"
                                        class:selected={appAppearance.theme ===
                                            "dark"}
                                        onclick={() =>
                                            (appAppearance.theme = "dark")}
                                    >
                                        <Moon size={24} />
                                        <span>{m.settings_theme_dark()}</span>
                                    </button>
                                    <button
                                        class="theme-card"
                                        class:selected={appAppearance.theme ===
                                            "system"}
                                        onclick={() =>
                                            (appAppearance.theme = "system")}
                                    >
                                        <Screen size={24} />
                                        <span>{m.settings_theme_system()}</span>
                                    </button>
                                </div>
                            </div>
                        </section>
                    {/if}

                    {#if matchesSearch("Accent Color Customization Interactive")}
                        <section class="settings-section">
                            <h2>{m.settings_accent_color()}</h2>
                            <p class="section-desc">
                                {m.settings_accent_color_desc()}
                            </p>
                            <div class="settings-card">
                                <div class="accent-palette">
                                    {#each ["#0f62fe" /* Carbon Blue */, "#0072c3" /* Teal/Cyan */, "#198038" /* Green */, "#a56eff" /* Purple */, "#fa4d56" /* Red */, "#ff832b" /* Orange */, "#f1c21b" /* Yellow */] as color}
                                        <button
                                            class="color-swatch"
                                            class:selected={appAppearance.accent ===
                                                color}
                                            style="background-color: {color};"
                                            onclick={() =>
                                                (appAppearance.accent = color)}
                                            title={color}
                                        >
                                            {#if appAppearance.accent === color}
                                                <Checkmark
                                                    size={16}
                                                    class="color-swatch-check"
                                                />
                                            {/if}
                                        </button>
                                    {/each}
                                    <div class="color-swatch-custom">
                                        <input
                                            type="color"
                                            bind:value={appAppearance.accent}
                                            class="color-input-sm"
                                            title={m.settings_custom_color()}
                                        />
                                    </div>
                                </div>
                            </div>
                        </section>
                    {/if}

                    {#if matchesSearch("Board Highlight Emphasis Checkmark Background Sidebar 看板 凸显 高亮")}
                        <section class="settings-section">
                            <h2>{m.settings_board_highlight()}</h2>
                            <p class="section-desc">
                                {m.settings_board_highlight_desc()}
                            </p>
                            <div class="settings-card">
                                <div class="theme-selector">
                                    <button
                                        class="theme-card"
                                        class:selected={appAppearance.boardHighlight ===
                                            "checkmark"}
                                        onclick={() =>
                                            (appAppearance.boardHighlight =
                                                "checkmark")}
                                    >
                                        <CheckmarkOutline size={24} />
                                        <span
                                            >{m.settings_board_highlight_checkmark()}</span
                                        >
                                    </button>
                                    <button
                                        class="theme-card"
                                        class:selected={appAppearance.boardHighlight ===
                                            "background"}
                                        onclick={() =>
                                            (appAppearance.boardHighlight =
                                                "background")}
                                    >
                                        <SquareFill size={24} />
                                        <span
                                            >{m.settings_board_highlight_background()}</span
                                        >
                                    </button>
                                </div>
                            </div>
                        </section>
                    {/if}

                    {#if matchesSearch("Font Size Typography Scale")}
                        <section class="settings-section">
                            <h2>{m.settings_typography()}</h2>
                            <p class="section-desc">
                                {m.settings_typography_desc()}
                            </p>
                            <div class="settings-card">
                                <ContentSwitcher
                                    selectedIndex={appAppearance.fontSize ===
                                    "small"
                                        ? 0
                                        : appAppearance.fontSize === "large"
                                          ? 2
                                          : 1}
                                    on:change={(e) => {
                                        const index = e.detail;
                                        if (index === 0)
                                            appAppearance.fontSize = "small";
                                        else if (index === 2)
                                            appAppearance.fontSize = "large";
                                        else appAppearance.fontSize = "default";
                                    }}
                                >
                                    <Switch text={m.settings_font_small()} />
                                    <Switch text={m.settings_font_default()} />
                                    <Switch text={m.settings_font_large()} />
                                </ContentSwitcher>
                            </div>
                        </section>
                    {/if}

                    {#if matchesSearch("Application Zoom global scale")}
                        <section class="settings-section">
                            <div class="header-with-tag">
                                <h2>{m.settings_app_zoom()}</h2>
                                <Tag type="teal" size="sm">{m.settings_experimental()}</Tag>
                            </div>
                            <p class="section-desc">
                                {m.settings_app_zoom_desc_prefix()} <kbd>Ctrl</kbd> +
                                <kbd>+</kbd> {m.settings_app_zoom_desc_and()} <kbd>Ctrl</kbd> + <kbd>-</kbd>
                                {m.settings_app_zoom_desc_suffix()}
                            </p>
                            <div class="settings-card">
                                <div class="control-box">
                                    <ZoomControls />
                                </div>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Customization Category ──────────────────────────────── -->
            {#if activeCategory === "customization"}
                <div class="category-view">
                    {#if matchesSearch("Ticket Types Customization Colors Icons")}
                        <section class="settings-section">
                            <h2>{m.settings_ticket_types()}</h2>
                            <p class="section-desc">
                                {m.settings_ticket_types_desc()}
                            </p>
                            <div class="settings-card">
                                <div class="type-management-list">
                                    {#each ticketTypesApi.types as type}
                                        <div
                                            class="type-item"
                                            class:is-default={type.is_default}
                                        >
                                            {#if editingTypeId === type.id}
                                                <div class="type-edit-form">
                                                    <TextInput
                                                        size="sm"
                                                        bind:value={
                                                            editingTypeName
                                                        }
                                                    />
                                                    <input
                                                        type="color"
                                                        bind:value={
                                                            editingTypeColor
                                                        }
                                                        class="color-input-sm"
                                                    />
                                                    <Button
                                                        size="small"
                                                        kind="ghost"
                                                        icon={Checkmark}
                                                        iconDescription={m.modal_save_changes()}
                                                        onclick={() =>
                                                            handleUpdateType(
                                                                type.id,
                                                            )}
                                                    />
                                                    <Button
                                                        size="small"
                                                        kind="ghost"
                                                        icon={Close}
                                                        iconDescription={m.modal_cancel()}
                                                        onclick={() =>
                                                            (editingTypeId =
                                                                null)}
                                                    />
                                                </div>
                                            {:else}
                                                <div class="type-display">
                                                    <div
                                                        class="type-color-dot"
                                                        style="background-color: {type.color}"
                                                    ></div>
                                                    <span class="type-name"
                                                        >{type.name}</span
                                                    >
                                                    {#if type.is_default}
                                                        <Tag
                                                            size="sm"
                                                            type="blue"
                                                            >{m.settings_default()}</Tag
                                                        >
                                                    {/if}
                                                </div>
                                                <div class="type-actions">
                                                    {#if !type.is_default}
                                                        <Button
                                                            size="small"
                                                            kind="ghost"
                                                            onclick={() =>
                                                                handleSetDefaultType(
                                                                    type.id,
                                                                )}
                                                        >
                                                            {m.settings_set_default()}
                                                        </Button>
                                                    {/if}
                                                    <Button
                                                        size="small"
                                                        kind="ghost"
                                                        icon={Code}
                                                        iconDescription={m.ticket_ctx_edit()}
                                                        onclick={() => {
                                                            editingTypeId =
                                                                type.id;
                                                            editingTypeName =
                                                                type.name;
                                                            editingTypeColor =
                                                                type.color;
                                                        }}
                                                    />
                                                    <Button
                                                        size="small"
                                                        kind="ghost"
                                                        icon={TrashCan}
                                                        iconDescription={m.table_delete()}
                                                        onclick={() =>
                                                            handleDeleteType(
                                                                type.id,
                                                            )}
                                                    />
                                                </div>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>

                                <div class="add-type-form">
                                    <h3>{m.settings_add_new_type()}</h3>
                                    <div class="add-type-inputs">
                                        <TextInput
                                            labelText={m.modal_board_name()}
                                            placeholder={m.settings_ticket_type_name_placeholder()}
                                            bind:value={newTypeName}
                                        />
                                        <div class="color-picker-group">
                                            <label for="new-type-color"
                                                >{m.settings_color()}</label
                                            >
                                            <input
                                                id="new-type-color"
                                                type="color"
                                                bind:value={newTypeColor}
                                            />
                                        </div>
                                        <Button
                                            kind="secondary"
                                            icon={Add}
                                            onclick={handleAddType}
                                        >
                                            {m.settings_add_type()}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Todo configuration → Catalog configuration (app level) ── -->
            <!-- A library of named rule sets, like the Git configuration library:
                 a list, and a detail view for the entry being edited. -->
            {#if activeCategory === "catalog-config"}
                <div class="category-view">
                    {#if matchesSearch("Todo Catalog Type Priority Tag Configuration Rules 待办 目录 类型 优先级 标签")}
                        <section class="settings-section">
                            {#if openCatalogSet}
                                <!-- ── Detail: one configuration ───────────── -->
                                <Button
                                    kind="ghost"
                                    size="small"
                                    icon={ArrowLeft}
                                    onclick={closeCatalogSetDetail}
                                >
                                    {m.settings_git_config_back()}
                                </Button>

                                <h2>
                                    {openCatalogSet.name ||
                                        m.settings_catalog_set_untitled()}
                                </h2>
                                <p class="section-desc">
                                    {m.settings_catalog_config_desc()}
                                </p>

                                <div class="settings-card">
                                    <div class="settings-grid">
                                        <TextInput
                                            id="catalog-set-name"
                                            labelText={m.settings_catalog_set_name()}
                                            placeholder={m.settings_catalog_set_name_placeholder()}
                                            readonly={openCatalogSetIsBuiltin}
                                            bind:value={openCatalogSet.name}
                                        />
                                        <TextInput
                                            id="catalog-set-description"
                                            labelText={m.settings_catalog_set_description()}
                                            placeholder={m.settings_catalog_set_desc_placeholder()}
                                            readonly={openCatalogSetIsBuiltin}
                                            bind:value={openCatalogSet.description}
                                        />
                                    </div>

                                    {#if openCatalogSetIsBuiltin}
                                        <InlineNotification
                                            kind="info"
                                            lowContrast
                                            title={m.settings_catalog_builtin()}
                                            subtitle={m.settings_catalog_builtin_hint()}
                                            hideCloseButton
                                        />
                                    {:else if !catalogSetUsable(openCatalogSet)}
                                        <InlineNotification
                                            kind="warning"
                                            lowContrast
                                            title={m.settings_catalog_set_name_required()}
                                            hideCloseButton
                                        />
                                    {/if}

                                    <div class="actions-group">
                                        {#if openCatalogSetIsBuiltin}
                                            <!-- Editable copies are how the
                                                 built-in is customised; the
                                                 built-in itself stays put so
                                                 "the product default" keeps
                                                 meaning one thing. -->
                                            <Button
                                                kind="primary"
                                                icon={Copy}
                                                disabled={catalogSaving}
                                                onclick={() =>
                                                    duplicateCatalogSetInLibrary(
                                                        openCatalogSet.id,
                                                    )}
                                            >
                                                {m.settings_catalog_set_copy_builtin()}
                                            </Button>
                                        {:else}
                                            <Button
                                                kind="primary"
                                                onclick={saveCatalogSet}
                                                disabled={catalogSaving ||
                                                    !catalogSetUsable(
                                                        openCatalogSet,
                                                    )}
                                            >
                                                {m.settings_save_configuration()}
                                            </Button>
                                            {#if !catalogDraft}
                                                <Button
                                                    kind="danger-ghost"
                                                    icon={TrashCan}
                                                    disabled={catalogSaving}
                                                    onclick={() =>
                                                        deleteCatalogSet(
                                                            openCatalogSet.id,
                                                        )}
                                                >
                                                    {m.settings_catalog_set_delete()}
                                                </Button>
                                            {/if}
                                        {/if}
                                    </div>
                                </div>

                            <!-- Types -->
                            <div class="settings-card">
                                <div class="header-with-tag">
                                    <h3>{m.settings_ticket_types()}</h3>
                                    <Tag type="cool-gray" size="sm"
                                        >{openCatalogCounts.types}</Tag
                                    >
                                </div>
                                <div class="token-list">
                                    {#each openCatalogSet.types as rule (rule.id)}
                                        <div class="rule-row">
                                            <TextInput
                                                id="rule-type-name-{rule.id}"
                                                labelText={m.settings_catalog_name()}
                                                bind:value={rule.name}
                                                onblur={() => commitCatalogRules(openCatalogSet)}
                                            />
                                            <div class="token-expiry">
                                                <label
                                                    class="token-expiry-label"
                                                    for="rule-type-color-{rule.id}"
                                                    >{m.settings_color()}</label
                                                >
                                                <select
                                                    id="rule-type-color-{rule.id}"
                                                    class="token-date"
                                                    value={rule.color}
                                                    onchange={(event) => {
                                                        rule.color = event.currentTarget.value;
                                                        void commitCatalogRules(openCatalogSet);
                                                    }}
                                                >
                                                    {#each TAG_COLOR_KEYS as key}
                                                        <option value={key}>{key}</option>
                                                    {/each}
                                                </select>
                                                {#if rule.is_default}
                                                    <Tag type="green" size="sm"
                                                        >{m.catalog_default()}</Tag
                                                    >
                                                {:else if !openCatalogSetIsBuiltin}
                                                    <Button
                                                        kind="ghost"
                                                        size="small"
                                                        onclick={() =>
                                                            setCatalogDefault(
                                                                "types",
                                                                rule.id,
                                                            )}
                                                    >
                                                        {m.catalog_set_default()}
                                                    </Button>
                                                {/if}
                                                {#if !openCatalogSetIsBuiltin}
                                                    <Button
                                                        kind="danger-ghost"
                                                        size="small"
                                                        icon={TrashCan}
                                                        iconDescription={m.catalog_delete()}
                                                        onclick={() =>
                                                            removeCatalogRule(
                                                                "types",
                                                                rule.id,
                                                            )}
                                                    />
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                                <div class="actions-group">
                                    {#if !openCatalogSetIsBuiltin}
                                        <Button
                                            kind="ghost"
                                            size="small"
                                            icon={Add}
                                            disabled={catalogSaving}
                                            onclick={() =>
                                                addCatalogRule("types")}
                                        >
                                            {m.catalog_add_type()}
                                        </Button>
                                    {/if}
                                </div>
                            </div>

                            <!-- Priorities -->
                            <div class="settings-card">
                                <div class="header-with-tag">
                                    <h3>{m.catalog_title_priority()}</h3>
                                    <Tag type="cool-gray" size="sm"
                                        >{openCatalogCounts.priorities}</Tag
                                    >
                                </div>
                                <div class="token-list">
                                    {#each openCatalogSet.priorities as rule, index (rule.id)}
                                        <div class="rule-row">
                                            <TextInput
                                                id="rule-priority-name-{rule.id}"
                                                labelText={m.settings_catalog_name()}
                                                bind:value={rule.name}
                                                onblur={() => commitCatalogRules(openCatalogSet)}
                                            />
                                            <div class="token-expiry">
                                                <label
                                                    class="token-expiry-label"
                                                    for="rule-priority-color-{rule.id}"
                                                    >{m.settings_color()}</label
                                                >
                                                <select
                                                    id="rule-priority-color-{rule.id}"
                                                    class="token-date"
                                                    value={rule.color}
                                                    onchange={(event) => {
                                                        rule.color = event.currentTarget.value;
                                                        void commitCatalogRules(openCatalogSet);
                                                    }}
                                                >
                                                    {#each PRIORITY_COLOR_KEYS as key}
                                                        <option value={key}>{key}</option>
                                                    {/each}
                                                </select>
                                                {#if index > 0 && !openCatalogSetIsBuiltin}
                                                    <Button
                                                        kind="ghost"
                                                        size="small"
                                                        icon={ArrowUp}
                                                        iconDescription={m.catalog_move_up()}
                                                        onclick={() =>
                                                            moveCatalogRule(
                                                                rule.id,
                                                                -1,
                                                            )}
                                                    />
                                                {/if}
                                                {#if index < openCatalogSet.priorities.length - 1}
                                                    <Button
                                                        kind="ghost"
                                                        size="small"
                                                        icon={ArrowDown}
                                                        iconDescription={m.catalog_move_down()}
                                                        onclick={() =>
                                                            moveCatalogRule(
                                                                rule.id,
                                                                1,
                                                            )}
                                                    />
                                                {/if}
                                                {#if rule.is_default}
                                                    <Tag type="green" size="sm"
                                                        >{m.catalog_default()}</Tag
                                                    >
                                                {:else if !openCatalogSetIsBuiltin}
                                                    <Button
                                                        kind="ghost"
                                                        size="small"
                                                        onclick={() =>
                                                            setCatalogDefault(
                                                                "priorities",
                                                                rule.id,
                                                            )}
                                                    >
                                                        {m.catalog_set_default()}
                                                    </Button>
                                                {/if}
                                                {#if !openCatalogSetIsBuiltin}
                                                    <Button
                                                        kind="danger-ghost"
                                                        size="small"
                                                        icon={TrashCan}
                                                        iconDescription={m.catalog_delete()}
                                                        onclick={() =>
                                                            removeCatalogRule(
                                                                "priorities",
                                                                rule.id,
                                                            )}
                                                    />
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                                <div class="actions-group">
                                    <Button
                                        kind="ghost"
                                        size="small"
                                        icon={Add}
                                        disabled={catalogSaving}
                                        onclick={() =>
                                            addCatalogRule("priorities")}
                                    >
                                        {m.catalog_add_priority()}
                                    </Button>
                                </div>
                            </div>

                            <!-- Tags -->
                            <div class="settings-card">
                                <div class="header-with-tag">
                                    <h3>{m.catalog_title_tag()}</h3>
                                    <Tag type="cool-gray" size="sm"
                                        >{openCatalogCounts.tags}</Tag
                                    >
                                </div>
                                <div class="token-list">
                                    {#each openCatalogSet.tags as rule (rule.id)}
                                        <div class="rule-row">
                                            <TextInput
                                                id="rule-tag-name-{rule.id}"
                                                labelText={m.settings_catalog_name()}
                                                bind:value={rule.name}
                                                onblur={() => commitCatalogRules(openCatalogSet)}
                                            />
                                            <div class="token-expiry">
                                                <label
                                                    class="token-expiry-label"
                                                    for="rule-tag-color-{rule.id}"
                                                    >{m.settings_color()}</label
                                                >
                                                <select
                                                    id="rule-tag-color-{rule.id}"
                                                    class="token-date"
                                                    value={rule.color}
                                                    onchange={(event) => {
                                                        rule.color = event.currentTarget.value;
                                                        void commitCatalogRules(openCatalogSet);
                                                    }}
                                                >
                                                    {#each TAG_COLOR_KEYS as key}
                                                        <option value={key}>{key}</option>
                                                    {/each}
                                                </select>
                                                <Button
                                                    kind="danger-ghost"
                                                    size="small"
                                                    icon={TrashCan}
                                                    iconDescription={m.catalog_delete()}
                                                    onclick={() =>
                                                        removeCatalogRule(
                                                            "tags",
                                                            rule.id,
                                                        )}
                                                />
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                                <div class="actions-group">
                                    {#if !openCatalogSetIsBuiltin}
                                        <Button
                                            kind="ghost"
                                            size="small"
                                            icon={Add}
                                            disabled={catalogSaving}
                                            onclick={() =>
                                                addCatalogRule("tags")}
                                        >
                                            {m.catalog_add_tag()}
                                        </Button>
                                    {/if}
                                </div>
                            </div>
                            {:else}
                                <!-- ── List: the library ───────────────────── -->
                                <h2>{m.settings_catalog_config()}</h2>
                                <p class="section-desc">
                                    {m.settings_catalog_config_desc()}
                                </p>

                                <div class="settings-card">
                                    <div class="card-head">
                                        <div class="header-with-tag">
                                            <h3>{m.settings_catalog_sets_title()}</h3>
                                            <Tag type="cool-gray" size="sm"
                                                >{catalogSets.length}</Tag
                                            >
                                        </div>
                                    </div>
                                    <p class="help-text">
                                        {m.settings_catalog_sets_desc()}
                                    </p>

                                    {#if catalogSets.length === 0}
                                        <InlineNotification
                                            kind="info"
                                            lowContrast
                                            title={m.settings_catalog_sets_empty()}
                                            hideCloseButton
                                        />
                                    {/if}

                                    <div class="token-list">
                                        {#each allCatalogSets as set (set.id)}
                                            {@const counts = catalogSetCounts(set)}
                                            {@const isBuiltin = isBuiltinCatalogSet(
                                                set.id,
                                            )}
                                            <div class="config-row">
                                                <button
                                                    class="config-row-open"
                                                    onclick={() =>
                                                        openCatalogSetDetail(
                                                            set.id,
                                                        )}
                                                >
                                                    <span class="config-row-main">
                                                        <span
                                                            class="config-row-name"
                                                            >{set.name}</span
                                                        >
                                                        <span
                                                            class="config-row-meta"
                                                            >{m.settings_catalog_set_counts(
                                                                counts,
                                                            )}</span
                                                        >
                                                    </span>
                                                    {#if isBuiltin}
                                                        <Tag
                                                            type="cool-gray"
                                                            size="sm"
                                                            >{m.settings_catalog_builtin_badge()}</Tag
                                                        >
                                                    {/if}
                                                    {#if catalogSetId === set.id}
                                                        <Tag
                                                            type="green"
                                                            size="sm"
                                                            >{m.settings_catalog_set_referenced()}</Tag
                                                        >
                                                    {/if}
                                                </button>
                                                <div class="config-row-actions">
                                                    <Button
                                                        kind="ghost"
                                                        size="small"
                                                        icon={Copy}
                                                        iconDescription={m.settings_git_config_duplicate()}
                                                        disabled={catalogSaving}
                                                        onclick={() =>
                                                            duplicateCatalogSetInLibrary(
                                                                set.id,
                                                            )}
                                                    />
                                                    {#if !isBuiltin}
                                                        <Button
                                                            kind="danger-ghost"
                                                            size="small"
                                                            icon={TrashCan}
                                                            iconDescription={m.settings_catalog_set_delete()}
                                                            disabled={catalogSaving}
                                                            onclick={() =>
                                                                deleteCatalogSet(
                                                                    set.id,
                                                                )}
                                                        />
                                                    {/if}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>

                                    <div class="actions-group">
                                        <Button
                                            kind="ghost"
                                            size="small"
                                            icon={Add}
                                            onclick={startNewCatalogSet}
                                        >
                                            {m.settings_catalog_set_new()}
                                        </Button>
                                    </div>
                                </div>
                            {/if}
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Todo configuration reference (workspace level) ───────── -->
            <!-- The workspace *instance*: it references one app-level
                 configuration, materialises it into this workspace's own rows
                 (which is what the board reads when you file a ticket), and can
                 push its own corrections back up. -->
            {#if activeCategory === "todo-config-reference"}
                <div class="category-view">
                    {#if matchesSearch("Todo Reference Catalog Type Priority Tag Apply Overwrite 待办 引用 应用 覆盖")}
                        <section class="settings-section">
                            <h2>{m.settings_todo_reference()}</h2>
                            <p class="section-desc">
                                {m.settings_todo_reference_desc()}
                            </p>

                            <!-- The reference -->
                            <div class="settings-card">
                                <Select
                                    id="catalog-reference"
                                    labelText={m.settings_catalog_reference()}
                                    bind:selected={catalogSelection}
                                >
                                    <SelectItem
                                        value=""
                                        text={m.settings_sync_no_config_selected()}
                                    />
                                    {#each allCatalogSets as set (set.id)}
                                        <SelectItem
                                            value={set.id}
                                            text={set.name}
                                        />
                                    {/each}
                                </Select>
                                <p class="help-text">
                                    {m.settings_catalog_reference_hint()}
                                </p>
                                <div class="actions-group">
                                    <Button
                                        kind="primary"
                                        onclick={saveCatalogReference}
                                    >
                                        {m.settings_catalog_reference_save()}
                                    </Button>
                                </div>
                            </div>

                            {#if referencedCatalogSet}
                                <!-- Instance vs configuration -->
                                <div class="settings-card">
                                    <div class="card-head">
                                        <h3>{m.settings_catalog_instance()}</h3>
                                        {#if catalogDiff?.identical}
                                            <Tag type="green" size="sm"
                                                >{m.settings_catalog_in_sync()}</Tag
                                            >
                                        {:else}
                                            <Tag type="magenta" size="sm"
                                                >{m.settings_catalog_out_of_sync(
                                                    { count: catalogDiff?.total ?? 0 },
                                                )}</Tag
                                            >
                                        {/if}
                                    </div>
                                    <p class="help-text">
                                        {m.settings_catalog_instance_counts({
                                            types: ticketTypesApi.types.length,
                                            priorities:
                                                ticketPrioritiesApi.priorities
                                                    .length,
                                            tags: tagsApi.tags.length,
                                        })}
                                    </p>

                                    {#if catalogDiff && !catalogDiff.identical}
                                        <ul class="diff-list">
                                            {#each catalogDiffLines(catalogDiff) as line}
                                                <li>{line}</li>
                                            {/each}
                                        </ul>
                                    {:else}
                                        <p class="help-text">
                                            {m.settings_catalog_in_sync_desc()}
                                        </p>
                                    {/if}

                                    {#if retiredEntries.length > 0}
                                        <h4>{m.settings_catalog_retired_title()}</h4>
                                        <p class="help-text">
                                            {m.settings_catalog_retired_desc()}
                                        </p>
                                        <div class="token-list">
                                            {#each retiredEntries as entry (entry.key)}
                                                <div class="config-row">
                                                    <span
                                                        class="config-row-open"
                                                    >
                                                        <span
                                                            class="config-row-main"
                                                        >
                                                            <span
                                                                class="config-row-name"
                                                                >{entry.name}</span
                                                            >
                                                            <span
                                                                class="config-row-meta"
                                                                >{entry.kind}</span
                                                            >
                                                        </span>
                                                    </span>
                                                    <div
                                                        class="config-row-actions"
                                                    >
                                                        <Button
                                                            kind="ghost"
                                                            size="small"
                                                            onclick={entry.restore}
                                                        >
                                                            {m.settings_catalog_restore()}
                                                        </Button>
                                                    </div>
                                                </div>
                                            {/each}
                                        </div>
                                    {/if}

                                    <div class="actions-group">
                                        <Button
                                            kind="ghost"
                                            icon={Add}
                                            disabled={catalogApplying}
                                            onclick={forkCatalogFromWorkspace}
                                        >
                                            {m.settings_catalog_new_from_workspace()}
                                        </Button>
                                        <Button
                                            kind="ghost"
                                            icon={Upload}
                                            disabled={catalogApplying ||
                                                catalogDiff?.identical}
                                            onclick={overwriteCatalogSetFromWorkspace}
                                        >
                                            {m.settings_catalog_overwrite()}
                                        </Button>
                                    </div>
                                    <p class="help-text">
                                        {m.settings_catalog_overwrite_hint()}
                                    </p>
                                </div>
                            {:else}
                                <InlineNotification
                                    kind="info"
                                    lowContrast
                                    title={m.settings_catalog_no_reference()}
                                    subtitle={m.settings_catalog_no_reference_desc()}
                                    hideCloseButton
                                />
                            {/if}
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- Saving a reference replaces the instance, so a workspace with
                 content of its own is asked first whether to keep it. -->
            <Modal
                bind:open={replacePromptOpen}
                modalHeading={m.settings_catalog_replace_title()}
                primaryButtonText={m.settings_catalog_replace_confirm()}
                secondaryButtonText={m.settings_catalog_fork_cancel()}
                on:click:button--secondary={() => (replacePromptOpen = false)}
                on:click:button--primary={() => void confirmCatalogReference()}
                on:close={() => (replacePromptOpen = false)}
            >
                <p>{m.settings_catalog_replace_desc()}</p>
                <Checkbox
                    bind:checked={forkBeforeReplace}
                    labelText={m.settings_catalog_replace_keep()}
                />
            </Modal>

            <Modal
                bind:open={forkPromptOpen}
                modalHeading={m.settings_catalog_builtin_body_title()}
                primaryButtonText={m.settings_catalog_fork_confirm()}
                secondaryButtonText={m.settings_catalog_fork_cancel()}
                on:click:button--secondary={() => (forkPromptOpen = false)}
                on:click:button--primary={() => void forkCatalogFromWorkspace()}
                on:close={() => (forkPromptOpen = false)}
            >
                <p>{m.settings_catalog_builtin_body_desc()}</p>
            </Modal>

            <!-- ── Data Management → Data format (app level) ───────────── -->
            <!-- Only the *shape* of an export lives here. Exporting and
                 importing act on a workspace's data, so those live with the
                 workspace (Settings → Workspace data). -->
            {#if activeCategory === "data-format"}
                <div class="category-view">
                    {#if matchesSearch("Data Format Export JSON CSV Single file Folder 数据格式")}
                        <section class="settings-section">
                            <h2>{m.settings_data_format_title()}</h2>
                            <p class="section-desc">
                                {m.settings_data_format_desc()}
                            </p>

                            <div class="settings-card">
                                <h3>{m.settings_export_format()}</h3>
                                <div class="theme-selector">
                                    <button
                                        class="export-card"
                                        class:selected={exportFormat === "json"}
                                        onclick={() =>
                                            void setExportPreference({
                                                format: "json",
                                            })}
                                    >
                                        <Document size={24} />
                                        <div class="export-card-text">
                                            <span>JSON</span>
                                            <small
                                                >{m.settings_export_json_desc()}</small
                                            >
                                        </div>
                                    </button>
                                    <button
                                        class="export-card"
                                        class:selected={exportFormat === "csv"}
                                        onclick={() =>
                                            void setExportPreference({
                                                format: "csv",
                                            })}
                                    >
                                        <Table size={24} />
                                        <div class="export-card-text">
                                            <span>CSV</span>
                                            <small
                                                >{m.settings_export_csv_desc()}</small
                                            >
                                        </div>
                                    </button>
                                </div>

                                <h3>{m.settings_export_mode()}</h3>
                                <div class="theme-selector">
                                    <button
                                        class="export-card"
                                        class:selected={exportMode ===
                                            "single-file"}
                                        onclick={() =>
                                            void setExportPreference({
                                                mode: "single-file",
                                            })}
                                    >
                                        <Document size={24} />
                                        <div class="export-card-text">
                                            <span>{m.settings_export_mode_single_file()}</span>
                                            <small
                                                >{m.settings_export_single_file_desc()}</small
                                            >
                                        </div>
                                    </button>
                                    <button
                                        class="export-card"
                                        class:selected={exportMode === "folder"}
                                        onclick={() =>
                                            void setExportPreference({
                                                mode: "folder",
                                            })}
                                    >
                                        <Folder size={24} />
                                        <div class="export-card-text">
                                            <span>{m.settings_export_mode_folder()}</span>
                                            <small
                                                >{m.settings_export_folder_desc()}</small
                                            >
                                        </div>
                                    </button>
                                </div>

                                <p class="help-text">
                                    {m.settings_data_scope_hint()}
                                </p>

                                <div class="export-preview">
                                    <strong>{m.settings_export_preview_heading()}</strong>
                                    {exportFormat.toUpperCase()} &middot; {exportMode ===
                                    "single-file"
                                        ? m.settings_export_mode_single_file()
                                        : m.settings_export_mode_folder()}<br />
                                    <span class="preview-muted">
                                        {#if exportMode === "single-file"}
                                            {m.settings_export_single_file_preview({ format: exportFormat })}
                                        {:else}
                                            {m.settings_export_folder_preview({ format: exportFormat })}
                                        {/if}
                                    </span>
                                </div>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Workspace data (workspace level) ─────────────────────── -->
            <!-- The tools are the application's; what they read and write is
                 this workspace's boards and tickets. -->
            {#if activeCategory === "workspace-data"}
                <div class="category-view">
                    {#if matchesSearch("Export Import Workspace Data Backup JSON CSV 工作区数据")}
                        <section class="settings-section">
                            <h2>{m.settings_export_data()}</h2>
                            <p class="section-desc">
                                {m.settings_export_desc()}
                            </p>

                            <div class="settings-card">
                                <p class="help-text">
                                    {m.settings_workspace_data_format_hint()}
                                </p>
                                <Button
                                    kind="primary"
                                    icon={Download}
                                    onclick={handleExport}
                                >
                                    {m.settings_export_data_button()}
                                </Button>
                            </div>
                        </section>

                        <section class="settings-section">
                            <h2>{m.settings_import_data()}</h2>
                            <p class="section-desc">
                                {m.settings_import_desc()}
                            </p>
                            <div class="settings-card">
                                <InlineNotification
                                    kind="warning"
                                    title={m.settings_warning()}
                                    subtitle={m.settings_import_warning()}
                                    hideCloseButton
                                />
                                <Button
                                    kind="danger-tertiary"
                                    icon={Upload}
                                    onclick={handleImport}
                                >
                                    {m.settings_import_data_button()}
                                </Button>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Sync Category ──────────────────────────────────────── -->
            {#if activeCategory === "sync"}
                <div class="category-view">
                    {#if matchesSearch("Git Synchronization Personal Access Token GitHub Auto-sync")}
                        <section class="settings-section">
                            <div class="header-with-status">
                                <div class="header-with-tag">
                                    <h2>{m.settings_git_sync()}</h2>
                                    <Tag type="teal" size="sm">{m.settings_experimental()}</Tag
                                    >
                                </div>
                                <Tag type={syncStatusColor} size="sm"
                                    >{syncStatusLabel}</Tag
                                >
                            </div>
                            <p class="section-desc">
                                {m.settings_git_sync_desc()}
                            </p>
                            <div class="settings-card">
                                {#if gitAvailable === false}
                                    <aside class="git-warning" role="alert">
                                        <strong>{m.settings_git_not_found()}</strong>
                                        <span>
                                            {m.settings_git_not_found_desc_prefix()} <code>git</code> {m.settings_git_not_found_desc_suffix()}
                                        </span>
                                    </aside>
                                {/if}

                                <div class="sync-form">
                                    <!-- The workspace holds a *reference*, not a
                                         connection: everything about how to
                                         reach the repository is maintained once
                                         in the app-level Git library. -->
                                    <Select
                                        id="sync-git-config"
                                        labelText={m.settings_sync_uses()}
                                        bind:selected={syncGitConfigId}
                                        disabled={gitAvailable === false}
                                    >
                                        <SelectItem
                                            value=""
                                            text={m.settings_sync_no_config_selected()}
                                        />
                                        {#each gitConfigs as entry (entry.id)}
                                            <SelectItem
                                                value={entry.id}
                                                text={entry.name ||
                                                    describeRemote(
                                                        entry.remote_url,
                                                    )}
                                            />
                                        {/each}
                                    </Select>

                                    {#if syncReference}
                                        <!-- Reported, not configured: the URL and
                                             the token belong to the referenced
                                             Git configuration, and a pair of
                                             read-only boxes here made this page
                                             look like the place to set them. -->
                                        <p class="help-text">
                                            {describeRemote(
                                                syncReference.remote_url,
                                            )} ·
                                            {gitConfigStatusLabel(
                                                gitConfigStatus(syncReference),
                                            )}
                                        </p>
                                    {/if}

                                    <!-- The branch is deliberately *not*
                                         part of the referenced connection:
                                         which line of history to sync is this
                                         workspace's decision. -->
                                    <TextInput
                                        id="sync-branch"
                                        labelText={m.settings_branch()}
                                        placeholder="main"
                                        bind:value={syncBranch}
                                        disabled={gitAvailable === false}
                                    />

                                    <p class="help-text">
                                        {m.settings_sync_reference_hint()}
                                    </p>
                                </div>

                                <div class="sync-form">
                                    {#if syncBranchMismatch}
                                        <aside class="git-warning" role="alert">
                                            <strong>{m.sync_branch_mismatch_title()}</strong>
                                            <span>{syncBranchMismatch.message}</span>
                                            {#if syncBranchMismatch.remoteDefaultBranch}
                                                    <Button
                                                        kind="ghost"
                                                        size="small"
                                                        onclick={useRemoteDefaultBranch}
                                                >
                                                    {m.sync_use_remote_branch({
                                                        branch: syncBranchMismatch.remoteDefaultBranch,
                                                    })}
                                                </Button>
                                            {/if}
                                        </aside>
                                    {/if}

                                    <div class="sync-options">
                                        <Toggle
                                            id="sync-auto-sync"
                                            labelText={m.settings_auto_sync()}
                                            labelA={m.settings_off()}
                                            labelB={m.settings_on()}
                                            bind:toggled={syncAutoSync}
                                            disabled={gitAvailable === false}
                                        />

                                        {#if syncAutoSync}
                                            <Select
                                                id="sync-auto-sync-interval"
                                                labelText={m.settings_sync_interval()}
                                                bind:selected={
                                                    syncAutoSyncInterval
                                                }
                                                disabled={gitAvailable ===
                                                    false}
                                            >
                                                <SelectItem
                                                    value={1}
                                                    text={m.settings_every_1_minute()}
                                                />
                                                <SelectItem
                                                    value={5}
                                                    text={m.settings_every_5_minutes()}
                                                />
                                                <SelectItem
                                                    value={15}
                                                    text={m.settings_every_15_minutes()}
                                                />
                                                <SelectItem
                                                    value={30}
                                                    text={m.settings_every_30_minutes()}
                                                />
                                                <SelectItem
                                                    value={60}
                                                    text={m.settings_every_1_hour()}
                                                />
                                                <SelectItem
                                                    value={120}
                                                    text={m.settings_every_2_hours()}
                                                />
                                                <SelectItem
                                                    value={360}
                                                    text={m.settings_every_6_hours()}
                                                />
                                            </Select>
                                        {/if}
                                    </div>

                                    {#if syncConfig.config.last_synced_at}
                                        <TextInput
                                            id="sync-last-synced"
                                            labelText={m.settings_last_synced()}
                                            value={formatSyncTimestamp(
                                                syncConfig.config.last_synced_at,
                                            )}
                                            readonly
                                        />
                                    {/if}
                                </div>

                                <div class="actions-group">
                                    <Button
                                        kind="primary"
                                        onclick={saveSyncConfig}
                                        disabled={gitAvailable === false}
                                    >
                                        {m.settings_save_configuration()}
                                    </Button>

                                    {#if syncConfigured && gitAvailable !== false}
                                        <div class="manual-actions">
                                            <h3>{m.settings_manual_actions()}</h3>
                                            {#if syncLoading}
                                                <InlineLoading
                                                    description={syncLoadingMessage}
                                                />
                                            {:else}
                                                <ButtonSet>
                                                    <Button
                                                        kind="tertiary"
                                                        onclick={handleSyncPush}
                                                        disabled={syncState.isSyncing}
                                                    >
                                                        {m.settings_push()}
                                                    </Button>
                                                    <Button
                                                        kind="tertiary"
                                                        onclick={handleSyncPull}
                                                        disabled={syncState.isSyncing}
                                                    >
                                                        {m.settings_pull()}
                                                    </Button>
                                                </ButtonSet>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Push Category ─────────────────────────────────────── -->
            {#if activeCategory === "push"}
                <div class="category-view">
                    <PushSettingsTab />
                </div>
            {/if}

            <!-- ── Debug Category ────────────────────────────────────── -->
            {#if activeCategory === "debug"}
                <div class="category-view">
                    {#if matchesSearch("Performance Testing Seeding Lazy Loading")}
                        <section class="settings-section">
                            <div class="header-with-tag">
                                <h2>{m.settings_performance_testing()}</h2>
                                <Tag type="magenta" size="sm">{m.settings_debug_only()}</Tag>
                            </div>
                            <p class="section-desc">
                                {m.settings_performance_desc()}
                            </p>
                            <div class="settings-card">
                                <div class="debug-card">
                                    <h3>{m.settings_seed_large_board()}</h3>
                                    <p>
                                        {m.settings_seed_large_board_desc()}
                                    </p>
                                    <div class="debug-actions">
                                        <Button
                                            kind="tertiary"
                                            icon={MagicWand}
                                            onclick={handleSeedPerformance}
                                        >
                                            {m.settings_seed_200_tickets()}
                                        </Button>
                                    </div>
                                </div>

                                <div
                                    class="debug-card"
                                    style="margin-top: 1.5rem;"
                                >
                                    <h3>{m.settings_verify_lazy_loading()}</h3>
                                    <ul class="debug-guide">
                                        <li>
                                            <strong>{m.settings_infinite_scroll()}</strong> {m.settings_infinite_scroll_desc()}
                                        </li>
                                        <li>
                                            <strong>{m.settings_deferred_rendering()}</strong>
                                            {m.settings_deferred_rendering_desc()}
                                        </li>
                                        <li>
                                            <strong>{m.settings_network_db_activity()}</strong>
                                            {m.settings_network_db_activity_desc()}
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </section>
                    {/if}

                    {#if matchesSearch("Events Audit Log Viewer")}
                        <section class="settings-section">
                            <div class="header-with-tag">
                                <h2>{m.settings_events_log()}</h2>
                                <Tag type="magenta" size="sm">{m.settings_debug_only()}</Tag>
                            </div>
                            <p class="section-desc">
                                {m.settings_events_log_desc()}
                            </p>
                            <div class="settings-card">
                                <div class="debug-card">
                                    <div class="debug-actions">
                                        <Button
                                            kind="tertiary"
                                            icon={Time}
                                            onclick={loadEvents}
                                            disabled={eventsLoading}
                                        >
                                            {eventsLoading
                                                ? m.settings_loading()
                                                : m.settings_load_events()}
                                        </Button>
                                        {#if events.length > 0}
                                            <span
                                                style="margin-left: 0.75rem; font-size: 0.875rem; color: var(--cds-text-secondary); align-self: center;"
                                            >
                                                {m.settings_event_count({ count: events.length })}
                                            </span>
                                        {/if}
                                    </div>

                                    {#if eventsError}
                                        <InlineNotification
                                            kind="error"
                                            title={m.settings_failed_load_events()}
                                            subtitle={eventsError}
                                            hideCloseButton
                                        />
                                    {/if}

                                    {#if events.length > 0}
                                        <!-- Filter -->
                                        <div
                                            style="display: flex; gap: 0.5rem; align-items: center; margin-top: 1rem;"
                                        >
                                            <label
                                                for="event-type-filter"
                                                style="font-size: 0.875rem; color: var(--cds-text-secondary);"
                                            >
                                                {m.settings_filter()}
                                            </label>
                                            <select
                                                id="event-type-filter"
                                                bind:value={eventTypeFilter}
                                                style="padding: 0.25rem 0.5rem; border: 1px solid var(--cds-ui-03); border-radius: 4px; background: var(--cds-field-01); color: var(--cds-text-primary); font-size: 0.875rem;"
                                            >
                                                {#each availableEventTypes as type}
                                                    <option value={type}>
                                                        {type === "all"
                                                            ? m.settings_all_types()
                                                            : type.replace(
                                                                  "_",
                                                                  " ",
                                                              )}
                                                    </option>
                                                {/each}
                                            </select>
                                        </div>

                                        <!-- Events Table -->
                                        <div
                                            style="margin-top: 0.75rem; overflow-x: auto; border: 1px solid var(--cds-ui-03); border-radius: 4px;"
                                        >
                                            <table
                                                style="width: 100%; border-collapse: collapse; font-size: 0.8125rem;"
                                            >
                                                <thead>
                                                    <tr
                                                        style="background: var(--cds-ui-01);"
                                                    >
                                                        <th
                                                            style="padding: 0.5rem; text-align: left; color: var(--cds-text-secondary); font-weight: 600; white-space: nowrap;"
                                                        >
                                                            {m.settings_table_type()}
                                                        </th>
                                                        <th
                                                            style="padding: 0.5rem; text-align: left; color: var(--cds-text-secondary); font-weight: 600; white-space: nowrap;"
                                                        >
                                                            {m.settings_entity()}
                                                        </th>
                                                        <th
                                                            style="padding: 0.5rem; text-align: left; color: var(--cds-text-secondary); font-weight: 600; white-space: nowrap;"
                                                        >
                                                            {m.settings_actor()}
                                                        </th>
                                                        <th
                                                            style="padding: 0.5rem; text-align: left; color: var(--cds-text-secondary); font-weight: 600; white-space: nowrap;"
                                                        >
                                                            {m.table_created()}
                                                        </th>
                                                        <th
                                                            style="padding: 0.5rem; text-align: left; color: var(--cds-text-secondary); font-weight: 600; white-space: nowrap;"
                                                        >
                                                            {m.settings_payload()}
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {#each filteredEvents as event (event.id)}
                                                        <tr
                                                            style="border-top: 1px solid var(--cds-ui-03);"
                                                            class:expanded={expandedEventId ===
                                                                event.id}
                                                        >
                                                            <td
                                                                style="padding: 0.5rem; white-space: nowrap;"
                                                            >
                                                                <Tag
                                                                    type="cool-gray"
                                                                    size="sm"
                                                                >
                                                                    {event.event_type.replace(
                                                                        /_/g,
                                                                        " ",
                                                                    )}
                                                                </Tag>
                                                            </td>
                                                            <td
                                                                style="padding: 0.5rem; white-space: nowrap; color: var(--cds-text-primary); font-family: monospace; font-size: 0.75rem;"
                                                            >
                                                                {event.entity_type}/{truncateId(
                                                                    event.entity_id,
                                                                )}
                                                            </td>
                                                            <td
                                                                style="padding: 0.5rem; white-space: nowrap; color: var(--cds-text-primary);"
                                                            >
                                                                {event.actor ||
                                                                    "—"}
                                                            </td>
                                                            <td
                                                                style="padding: 0.5rem; white-space: nowrap; color: var(--cds-text-secondary); font-size: 0.75rem;"
                                                            >
                                                                {formatTimestamp(
                                                                    event.created_at,
                                                                )}
                                                            </td>
                                                            <td
                                                                style="padding: 0.5rem;"
                                                            >
                                                                <Button
                                                                    kind="ghost"
                                                                    size="small"
                                                                    onclick={() =>
                                                                        toggleEventPayload(
                                                                            event.id,
                                                                        )}
                                                                >
                                                                    {expandedEventId ===
                                                                    event.id
                                                                        ? m.settings_hide()
                                                                        : m.settings_show()}
                                                                    JSON
                                                                </Button>
                                                            </td>
                                                        </tr>
                                                        {#if expandedEventId === event.id}
                                                            <tr>
                                                                <td
                                                                    colspan="5"
                                                                    style="padding: 0 0.5rem 0.5rem 0.5rem;"
                                                                >
                                                                    <pre
                                                                        style="background: var(--cds-ui-01); border: 1px solid var(--cds-ui-03); border-radius: 4px; padding: 0.75rem; font-size: 0.75rem; line-height: 1.4; overflow-x: auto; white-space: pre-wrap; color: var(--cds-text-primary); max-height: 300px; overflow-y: auto;"><code
                                                                            >${formatPayload(
                                                                                event.payload,
                                                                            )}</code
                                                                        ></pre>
                                                                </td>
                                                            </tr>
                                                        {/if}
                                                    {/each}
                                                </tbody>
                                            </table>
                                        </div>
                                    {:else if !eventsLoading}
                                        <p
                                            style="margin-top: 1rem; font-size: 0.875rem; color: var(--cds-text-secondary);"
                                        >
                                            {m.settings_load_events_hint()}
                                        </p>
                                    {/if}
                                </div>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}

            <!-- ── Advanced Category ──────────────────────────────────── -->
            {#if activeCategory === "advanced"}
                <div class="category-view">
                    {#if matchesSearch("Developer Tools Experimental Advanced Diagnostics")}
                        <section class="settings-section">
                            <h2>{m.settings_developer_tools()}</h2>
                            <p class="section-desc">
                                {m.settings_developer_tools_desc()}
                            </p>
                            <div class="settings-card">
                                <div class="advanced-grid">
                                    <Button
                                        kind="ghost"
                                        onclick={refreshWorkspaceState}
                                    >
                                        {m.settings_force_state_reinit()}
                                    </Button>
                                    <p class="help-text">
                                        {m.settings_force_state_reinit_desc()}
                                    </p>
                                </div>
                            </div>
                        </section>
                    {/if}
                </div>
            {/if}
        </div>
    </main>
</div>

<style>
    .settings-layout {
        height: 100vh;
        display: flex;
        overflow: hidden;
        background: var(--cds-ui-01);
    }

    /* ── Sidebar ───────────────────────────────────────────────────────── */
    .settings-sidebar {
        width: 260px;
        flex-shrink: 0;
        /* background: var(--cds-ui-02); */
        border-right: 1px solid var(--cds-ui-03);
        display: flex;
        flex-direction: column;
    }

    .sidebar-header {
        height: 48px;
        display: flex;
        align-items: center;
        padding-left: 0.5rem;
        gap: 0.5rem;
        font-weight: 700;
        font-size: 1rem;
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .sidebar-nav {
        flex: 1;
        padding: 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        overflow-y: auto;
    }

    /* ── Scope group (app / workspace / board / developer) ─────────────── */
    .nav-group {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding-bottom: 0.75rem;
        margin-bottom: 0.25rem;
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .nav-group:last-child {
        border-bottom: none;
        margin-bottom: 0;
        padding-bottom: 0;
    }

    /*
     * Deliberately larger and heavier than `.nav-item`: this is the level that
     * groups the menu, so it must not read as small print above the entries it
     * owns. Colour does the ranking too — primary here, secondary on the items.
     * The sidebar title sits above this one in the scale (1rem in a 48px band),
     * so the hierarchy reads title > scope > item rather than inverting.
     */
    .nav-group-header {
        padding: 0.5rem 0.75rem 0.25rem;
        font-size: 0.9375rem;
        font-weight: 700;
        line-height: 1.2;
        color: var(--cds-text-primary);
        cursor: default;
    }

    .nav-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.625rem 0.75rem;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--cds-text-secondary);
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.1s ease;
        text-align: left;
    }

    .nav-item:hover {
        background: var(--cds-ui-03);
        color: var(--cds-text-primary);
    }

    .nav-item.active {
        background: color-mix(
            in srgb,
            var(--cds-interactive-01) 10%,
            transparent
        );
        color: var(--cds-interactive-01);
        font-weight: 600;
        border-radius: 0 4px 4px 0;
        position: relative;
    }

    .nav-item.active::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background-color: var(--cds-interactive-01);
        border-radius: 0 2px 2px 0;
    }

    /*
     * An entry that *contains* the open page — not the page itself. Marked with
     * colour and weight only: the accent bar belongs to exactly one row, so the
     * eye has one place to land instead of two competing ones.
     */
    .nav-item.section-active {
        color: var(--cds-interactive-01);
        font-weight: 600;
    }

    /*
     * Sub-pages of a menu entry. The connector line is what says "these belong
     * to the entry above" — indentation alone reads as a layout accident.
     */
    .nav-subitems {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        margin: 0 0 0.25rem 1.6rem;
        padding-left: 0.6rem;
        border-left: 1px solid var(--cds-ui-03);
    }

    .nav-item--child {
        padding: 0.4rem 0.6rem;
        font-size: 0.8125rem;
    }

    .sidebar-footer {
        padding: 1rem;
        border-top: 1px solid var(--cds-ui-03);
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .app-version {
        font-size: 0.75rem;
        color: var(--cds-text-helper);
        font-family: var(--cds-code-01-font-family);
    }

    /* ── Main Content ──────────────────────────────────────────────────── */
    .settings-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .content-header {
        padding: 1.5rem 2rem;
        background: var(--cds-ui-01);
        display: flex;
        flex-direction: column;
        gap: 1rem;
        border-bottom: 1px solid var(--cds-ui-03);
    }

    .search-container {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: var(--cds-field-01);
        border: 1px solid var(--cds-ui-03);
        padding: 0.5rem 0.75rem;
        border-radius: 4px;
        max-width: 600px;
    }

    .search-container input {
        border: none;
        background: transparent;
        color: var(--cds-text-primary);
        font-size: 0.875rem;
        flex: 1;
        outline: none;
    }

    .breadcrumbs {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        background: var(--cds-ui-02);
        padding: 0.25rem 0.75rem;
        border-radius: 1rem;
        font-size: 0.75rem;
        color: var(--cds-text-secondary);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        width: fit-content;
    }

    /* The scope is the level that decides where a setting lives, so it is the
       one part of the trail that gets the interactive colour. */
    .crumb-scope {
        color: var(--cds-interactive-01);
        font-weight: 600;
    }

    .content-body {
        flex: 1;
        overflow-y: auto;
        padding: 2rem;
    }

    .category-view {
        max-width: 800px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 3rem;
    }

    .settings-section {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .settings-section h2 {
        font-size: 1.5rem;
        font-weight: 500;
        color: var(--cds-text-primary);
        margin: 0;
    }

    .settings-section h3 {
        font-size: 0.875rem;
        font-weight: 600;
        margin: 0;
    }

    .settings-card {
        background: var(--cds-ui-01);
        border: 1px solid var(--cds-ui-03);
        border-radius: 8px;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
    }

    .section-desc {
        font-size: 0.875rem;
        color: var(--cds-text-secondary);
        margin: -0.75rem 0 0.5rem 0;
        max-width: 600px;
    }

    .settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1.5rem;
    }

    /* ── Workspace actions (switch / close) ───────────────────────────────── */
    .workspace-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
        padding-top: 1.25rem;
        border-top: 1px solid var(--cds-ui-03);
    }

    .workspace-actions-hint {
        font-size: 0.75rem;
        color: var(--cds-text-secondary);
    }

    .control-box {
        background: var(--cds-ui-02);
        padding: 1.5rem;
        border-radius: 4px;
        border: 1px solid var(--cds-ui-03);
    }

    /* ── Appearance Styles ────────────────────────────────────────────────── */
    .theme-selector {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 1rem;
    }

    .theme-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 1.5rem;
        background: var(--cds-ui-02);
        border: 2px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        color: var(--cds-text-secondary);
        transition: all 0.2s ease;
    }

    .theme-card:hover {
        background: var(--cds-ui-03);
        color: var(--cds-text-primary);
    }

    .theme-card.selected {
        border-color: var(--cds-interactive-01);
        background: color-mix(
            in srgb,
            var(--cds-interactive-01) 5%,
            var(--cds-ui-01)
        );
        color: var(--cds-interactive-01);
    }

    .theme-card span {
        font-weight: 500;
        font-size: 0.875rem;
    }

    .accent-palette {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
    }

    .color-swatch {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.1s ease;
    }

    .color-swatch:hover {
        transform: scale(1.1);
    }

    .color-swatch.selected {
        outline: 2px solid var(--cds-text-primary);
        outline-offset: 2px;
    }

    .color-swatch-custom {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 50%;
        overflow: hidden;
        border: 1px solid var(--cds-ui-04);
        margin-left: 0.5rem;
    }

    .color-swatch-custom .color-input-sm {
        width: 150%;
        height: 150%;
        margin: -25%;
        padding: 0;
        border: none;
        cursor: pointer;
    }

    .header-with-tag,
    .header-with-status {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .header-with-status {
        justify-content: space-between;
    }

    .export-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1.25rem;
        background: var(--cds-ui-02);
        border: 2px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        color: var(--cds-text-secondary);
        transition: all 0.2s ease;
        text-align: left;
    }

    .export-card:hover {
        background: var(--cds-ui-03);
        color: var(--cds-text-primary);
    }

    .export-card.selected {
        border-color: var(--cds-interactive-01);
        background: color-mix(
            in srgb,
            var(--cds-interactive-01) 5%,
            var(--cds-ui-01)
        );
        color: var(--cds-interactive-01);
    }

    .export-card-text {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .export-card-text span {
        font-weight: 600;
        font-size: 0.875rem;
        color: var(--cds-text-primary);
    }

    .export-card.selected .export-card-text span {
        color: var(--cds-interactive-01);
    }

    .export-card-text small {
        font-size: 0.75rem;
        color: var(--cds-text-secondary);
        line-height: 1.2;
    }

    .export-preview {
        background: var(--cds-ui-02);
        padding: 1rem;
        border-radius: 4px;
        font-size: 0.875rem;
        line-height: 1.5;
        border-left: 4px solid var(--cds-interactive-01);
    }

    .preview-muted {
        color: var(--cds-text-secondary);
    }

    .sync-form {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .token-field {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    /* ── Access token list (Git Authentication) ────────────────────────── */
    .token-list {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin: 1rem 0;
    }

    /*
     * A card heading with actions on the right. The actions belong to the whole
     * card, so they sit beside its title rather than floating under it.
     */
    .card-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
    }

    .card-head-actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-shrink: 0;
    }

    /* Which rules differ between the configuration and this workspace. */
    .diff-list {
        margin: 0.5rem 0 1rem;
        padding-left: 1.25rem;
        font-size: 0.8125rem;
        color: var(--cds-text-secondary);
    }

    .diff-list li {
        margin: 0.125rem 0;
    }

    /* One rule in the app-level catalogs: a name, a colour, and its actions. */
    .rule-row {
        display: flex;
        align-items: flex-end;
        gap: 1rem;
        flex-wrap: wrap;
        padding: 0.75rem 1rem;
        border: 1px solid var(--cds-ui-03);
        border-radius: 4px;
        background: var(--cds-field-01);
    }

    .rule-row > :first-child {
        flex: 1 1 14rem;
    }

    /*
     * A configuration row: one tappable area that opens the entry, plus its own
     * actions. Two sibling buttons rather than one button containing another,
     * which is invalid HTML and swallows the inner click.
     */
    .config-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding-right: 0.5rem;
        border: 1px solid var(--cds-ui-03);
        border-left: 3px solid var(--cds-ui-03);
        border-radius: 4px;
        background: var(--cds-field-01);
    }

    .config-row:hover {
        border-left-color: var(--cds-interactive-01);
    }

    .config-row-open {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex: 1;
        min-width: 0;
        text-align: left;
        padding: 0.75rem 1rem;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: inherit;
        font: inherit;
        cursor: pointer;
    }

    .config-row-open:hover {
        background: var(--cds-ui-03);
    }

    .config-row-actions {
        display: flex;
        align-items: center;
        gap: 0.125rem;
        flex-shrink: 0;
    }

    .config-row-main {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
    }

    .config-row-name {
        font-weight: 600;
    }

    .config-row-meta {
        font-size: 0.8125rem;
        color: var(--cds-text-helper);
    }
    .token-expiry {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .token-expiry-label {
        font-size: 0.75rem;
        color: var(--cds-text-secondary);
        white-space: nowrap;
    }

    /* A native date input, styled to sit next to the Carbon fields. */
    .token-date {
        font-family: inherit;
        font-size: 0.875rem;
        color: var(--cds-text-primary);
        background: var(--cds-field-01);
        border: none;
        border-bottom: 1px solid var(--cds-border-strong-01, var(--cds-ui-04));
        padding: 0.4rem 0.75rem;
    }

    .token-date:focus {
        outline: 2px solid var(--cds-focus, var(--cds-interactive-01));
        outline-offset: -2px;
    }

    .sync-options {
        display: flex;
        align-items: flex-end;
        gap: 2rem;
        padding: 1rem;
        background: var(--cds-ui-02);
        border-radius: 4px;
    }

    .actions-group {
        display: flex;
        flex-direction: column;
        gap: 2rem;
        margin-top: 1rem;
    }

    .manual-actions {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1.5rem;
        border-top: 1px solid var(--cds-ui-03);
        background: var(--cds-ui-02);
        border-radius: 0 0 4px 4px;
    }

    .git-warning {
        padding: 1rem;
        background: #fff8e1;
        border-left: 4px solid #ffc107;
        color: #856404;
        font-size: 0.875rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .advanced-grid {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding: 1.5rem;
        background: var(--cds-ui-02);
        border-radius: 4px;
    }

    .help-text {
        font-size: 0.8125rem;
        color: var(--cds-text-helper);
        margin: 0;
    }

    /* ── Customization Category ────────────────────────────────────────── */
    .type-management-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        background: var(--cds-ui-02);
        padding: 0.5rem;
        border-radius: 4px;
        border: 1px solid var(--cds-ui-03);
    }

    .type-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 1rem;
        background: var(--cds-ui-01);
        border-radius: 4px;
        border: 1px solid transparent;
        transition: all 0.1s ease;
    }

    .type-item:hover {
        border-color: var(--cds-ui-03);
    }

    .type-item.is-default {
        border-left: 4px solid var(--cds-interactive-01);
    }

    .type-display,
    .type-edit-form {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex: 1;
    }

    .type-color-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .type-name {
        font-size: 0.875rem;
        color: var(--cds-text-primary);
        font-weight: 500;
    }

    .type-actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .color-input-sm {
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        background: none;
        cursor: pointer;
    }

    .add-type-form {
        margin-top: 1rem;
        padding: 1.5rem;
        background: var(--cds-ui-02);
        border-radius: 4px;
        border: 1px solid var(--cds-ui-03);
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .add-type-inputs {
        display: flex;
        align-items: flex-end;
        gap: 1.5rem;
    }

    .color-picker-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .color-picker-group label {
        font-size: 0.75rem;
        color: var(--cds-text-secondary);
    }

    .color-picker-group input {
        width: 40px;
        height: 40px;
        padding: 0;
        border: 1px solid var(--cds-ui-03);
        background: var(--cds-ui-01);
        border-radius: 4px;
        cursor: pointer;
    }

    .updater-available {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    .updater-available-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .updater-version-badge {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .updater-new-version {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--cds-text-primary);
        font-family: var(--cds-code-01-font-family);
    }

    .updater-date {
        font-size: 0.8125rem;
        color: var(--cds-text-helper);
    }

    .updater-notes {
        background: var(--cds-ui-01);
        border: 1px solid var(--cds-ui-03);
        border-radius: 4px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .updater-notes-label {
        font-size: 0.75rem;
        color: var(--cds-text-helper);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .updater-notes-body {
        font-size: 0.875rem;
        color: var(--cds-text-secondary);
        margin: 0;
        line-height: 1.5;
        white-space: pre-wrap;
    }

    .updater-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .updater-install-failed {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }

    /* ── Debug Category ────────────────────────────────────────────────── */
    .debug-card {
        background: var(--cds-ui-02);
        border: 1px solid var(--cds-ui-03);
        border-radius: 6px;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .debug-card h3 {
        font-size: 1rem;
        font-weight: 600;
        color: var(--cds-text-primary);
        margin: 0;
    }

    .debug-card p {
        font-size: 0.875rem;
        color: var(--cds-text-secondary);
        line-height: 1.5;
        margin: 0;
    }

    .debug-actions {
        display: flex;
        justify-content: flex-start;
        padding-top: 0.5rem;
    }

    .debug-guide {
        list-style-type: disc;
        padding-left: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .debug-guide li {
        font-size: 0.875rem;
        color: var(--cds-text-secondary);
        line-height: 1.5;
    }

    .debug-guide li strong {
        color: var(--cds-text-primary);
        display: block;
        margin-bottom: 0.125rem;
    }
</style>
