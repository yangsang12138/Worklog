import { browser } from "$app/environment";
import { setMode, resetMode, mode } from "mode-watcher";

const THEME_KEY = "worklog:app-theme";
const ACCENT_KEY = "worklog:app-accent";
const FONT_SIZE_KEY = "worklog:app-font-size";
const BOARD_HIGHLIGHT_KEY = "worklog:board-highlight";

export type ThemeMode = "system" | "light" | "dark";
export type FontSize = "small" | "default" | "large";

/**
 * How the board currently being viewed is marked in the sidebar board list.
 * `checkmark` draws a selection check on the entry, `background` fills the
 * whole entry with the accent colour instead.
 */
export type BoardHighlight = "checkmark" | "background";

let globalTheme = $state<ThemeMode>("system");
let globalAccent = $state<string>("#0f62fe"); // Default Carbon interactive-01
let globalFontSize = $state<FontSize>("default");
let globalBoardHighlight = $state<BoardHighlight>("checkmark");

const FONT_SIZE_MAP: Record<FontSize, string> = {
    small: "14px",
    default: "16px",
    large: "18px",
};

if (browser) {
    const storedTheme = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    if (storedTheme && ["system", "light", "dark"].includes(storedTheme)) {
        globalTheme = storedTheme;
    }

    const storedAccent = localStorage.getItem(ACCENT_KEY);
    if (storedAccent) {
        globalAccent = storedAccent;
    }

    const storedFontSize = localStorage.getItem(FONT_SIZE_KEY) as FontSize | null;
    if (storedFontSize && ["small", "default", "large"].includes(storedFontSize)) {
        globalFontSize = storedFontSize;
    }

    const storedBoardHighlight = localStorage.getItem(
        BOARD_HIGHLIGHT_KEY,
    ) as BoardHighlight | null;
    if (
        storedBoardHighlight &&
        ["checkmark", "background"].includes(storedBoardHighlight)
    ) {
        globalBoardHighlight = storedBoardHighlight;
    }

    $effect.root(() => {
        $effect(() => {
            // Handle Theme
            if (globalTheme === "system") {
                resetMode();
            } else {
                setMode(globalTheme);
            }
            localStorage.setItem(THEME_KEY, globalTheme);

            // Handle Accent Color
            document.documentElement.style.setProperty("--cds-interactive-01", globalAccent);
            document.documentElement.style.setProperty("--cds-link-01", globalAccent);
            document.documentElement.style.setProperty("--cds-button-primary", globalAccent);
            localStorage.setItem(ACCENT_KEY, globalAccent);

            // Handle Font Size
            document.documentElement.style.setProperty("--font-size-base", FONT_SIZE_MAP[globalFontSize]);
            localStorage.setItem(FONT_SIZE_KEY, globalFontSize);

            // Handle Board Highlight
            localStorage.setItem(BOARD_HIGHLIGHT_KEY, globalBoardHighlight);

            // Sync Carbon theme with mode-watcher
            const m = mode.current;
            if (m) {
                document.documentElement.setAttribute("theme", m === "dark" ? "g100" : "g10");
            }
        });
    });
}

export function useAppAppearance() {
    return {
        get theme() {
            return globalTheme;
        },
        set theme(value: ThemeMode) {
            globalTheme = value;
        },
        get accent() {
            return globalAccent;
        },
        set accent(value: string) {
            globalAccent = value;
        },
        get fontSize() {
            return globalFontSize;
        },
        set fontSize(value: FontSize) {
            globalFontSize = value;
        },
        get boardHighlight() {
            return globalBoardHighlight;
        },
        set boardHighlight(value: BoardHighlight) {
            globalBoardHighlight = value;
        }
    };
}
