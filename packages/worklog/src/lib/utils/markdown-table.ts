/**
 * The table grid behind the "insert table" dialog.
 *
 * Kept as pure data + pure functions so the resize rules can be tested
 * directly: the dialog resizes on every keystroke, and the interesting
 * behaviours (a count that passes through a smaller number, rows parked beyond
 * the visible window, a pasted block that outgrows the grid) are exactly the
 * ones a UI cannot demonstrate cheaply.
 *
 * Shapes:
 *
 *   columns / rows   the *visible* window — what the dialog draws and what the
 *                    generated Markdown contains
 *   header / body    the *storage* behind that window, never narrower than the
 *                    window, and never truncated by it
 *
 * Separating the two is what makes shrinking non-destructive: typing "12" into
 * the column field fires on "1" first, and a destructive resize would throw
 * away every cell past the first on the way to the number the user meant.
 */

export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 50;
export const DEFAULT_TABLE_COLUMNS = 3;
export const DEFAULT_TABLE_ROWS = 3;

export type TableAlign = "default" | "left" | "center" | "right";

export interface TableGrid {
    /** Visible column count — a window over `header` and every body row. */
    columns: number;
    /** Visible row count — a window over `body`. */
    rows: number;
    header: string[];
    body: string[][];
}

function blankRow(columns: number): string[] {
    return Array.from({ length: columns }, () => "");
}

function clamp(value: number, max: number): number {
    const next = Math.floor(Number(value));
    if (!Number.isFinite(next)) return 1;
    return Math.max(1, Math.min(max, next));
}

/** Pad a row out to `columns`; never truncate what is already in it. */
function ensureWidth(row: string[], columns: number): string[] {
    if (row.length >= columns) return row;
    return [...row, ...blankRow(columns - row.length)];
}

function fitRow(row: string[], columns: number): string[] {
    return Array.from({ length: columns }, (_, i) => row[i] ?? "");
}

/** How wide the storage has to be to hold everything it already holds. */
function storageWidth(grid: TableGrid): number {
    let width = Math.max(grid.columns, grid.header.length);
    for (const row of grid.body) {
        if (row.length > width) width = row.length;
    }
    return width;
}

export function createTableGrid(
    columns: number = DEFAULT_TABLE_COLUMNS,
    rows: number = DEFAULT_TABLE_ROWS,
): TableGrid {
    const width = clamp(columns, MAX_TABLE_COLUMNS);
    const height = clamp(rows, MAX_TABLE_ROWS);
    return {
        columns: width,
        rows: height,
        header: blankRow(width),
        body: Array.from({ length: height }, () => blankRow(width)),
    };
}

/** Resize the visible columns, growing the storage and keeping its contents. */
export function setTableColumns(grid: TableGrid, value: number): TableGrid {
    const columns = clamp(value, MAX_TABLE_COLUMNS);
    return {
        ...grid,
        columns,
        header: ensureWidth(grid.header, columns),
        body: grid.body.map((row) => ensureWidth(row, columns)),
    };
}

/** Resize the visible rows, growing the storage and keeping its contents. */
export function setTableRows(grid: TableGrid, value: number): TableGrid {
    const rows = clamp(value, MAX_TABLE_ROWS);
    const width = storageWidth(grid);
    const total = Math.max(rows, grid.body.length);

    return {
        ...grid,
        rows,
        body: Array.from({ length: total }, (_, i) =>
            grid.body[i] ? ensureWidth(grid.body[i], width) : blankRow(width),
        ),
    };
}

export function setTableHeaderCell(
    grid: TableGrid,
    column: number,
    value: string,
): TableGrid {
    const width = storageWidth(grid);
    const header = ensureWidth(grid.header, width).map((cell, c) =>
        c === column ? value : cell,
    );
    return { ...grid, header };
}

export function setTableCell(
    grid: TableGrid,
    row: number,
    column: number,
    value: string,
): TableGrid {
    const width = storageWidth(grid);
    const body = grid.body.map((cells, r) => {
        if (r !== row) return cells;
        return ensureWidth(cells, width).map((cell, c) =>
            c === column ? value : cell,
        );
    });
    return { ...grid, body };
}

/**
 * Add a row directly below the last visible one.
 *
 * Inserting at the window edge rather than at the end of the storage keeps the
 * new row where the user is looking, even when an earlier shrink parked rows
 * beyond the visible count.
 */
export function addTableRow(grid: TableGrid): TableGrid {
    const body = [...grid.body];
    body.splice(grid.rows, 0, blankRow(storageWidth(grid)));
    return {
        ...grid,
        body,
        rows: Math.min(MAX_TABLE_ROWS, grid.rows + 1),
    };
}

/** Remove the row at a *visible* index. The last remaining row is kept. */
export function removeTableRow(grid: TableGrid, index: number): TableGrid {
    if (grid.rows <= 1) return grid;

    const body = grid.body.filter((_, r) => r !== index);
    return {
        ...grid,
        body,
        rows: Math.min(grid.rows - 1, Math.max(1, body.length)),
    };
}

/**
 * Remove the column at a *visible* index. The last remaining column is kept.
 *
 * The column leaves the storage too — unlike a shrink, which only hides cells,
 * this is the user saying they do not want that column — so adding a column
 * back later yields a blank one rather than resurrecting the old data.
 */
export function removeTableColumn(grid: TableGrid, index: number): TableGrid {
    if (grid.columns <= 1 || index < 0 || index >= grid.columns) return grid;

    const drop = (row: string[]) => row.filter((_, c) => c !== index);

    return {
        ...grid,
        columns: grid.columns - 1,
        header: drop(grid.header),
        body: grid.body.map(drop),
    };
}

/**
 * Write a pasted block into the grid, anchored at one cell.
 *
 * The grid grows to fit the block first, so every target cell exists by the
 * time values are written; anything past the hard limits stays hidden rather
 * than being dropped from the storage.
 */
export function pasteTableBlock(
    grid: TableGrid,
    block: string[][],
    rowIndex: number,
    column: number,
): TableGrid {
    if (block.length === 0) return grid;

    const blockColumns = Math.max(...block.map((line) => line.length));
    let next = setTableColumns(
        grid,
        Math.max(grid.columns, column + blockColumns),
    );
    next = setTableRows(next, Math.max(next.rows, rowIndex + block.length));

    const body = next.body.map((row) => [...row]);
    block.forEach((cells, r) => {
        cells.forEach((value, c) => {
            const target = body[rowIndex + r];
            const targetColumn = column + c;
            if (target && targetColumn < target.length) {
                target[targetColumn] = value.trim();
            }
        });
    });

    return { ...next, body };
}

/** The header cells the dialog draws. */
export function visibleHeaderCells(grid: TableGrid): string[] {
    return fitRow(grid.header, grid.columns);
}

/** The body rows the dialog draws, each trimmed to the visible columns. */
export function visibleBodyRows(grid: TableGrid): string[][] {
    return Array.from({ length: grid.rows }, (_, r) =>
        fitRow(grid.body[r] ?? [], grid.columns),
    );
}

/** Escape the one character that would split a table cell in two. */
function escapeCell(value: string): string {
    const text = value.trim().replace(/\|/g, "\\|").replace(/\n/g, " ");
    // A truly empty cell collapses in some renderers; a bare space keeps the
    // row's column count intact.
    return text || " ";
}

/**
 * Render the visible grid as a Markdown table.
 *
 * Only the window is written out: a stored cell beyond the visible counts is
 * data the user chose to hide, not data they asked to insert.
 *
 * Markdown has no headerless table — the first row is always the header — so
 * with the header switched off the first data row takes that slot.
 */
export function buildMarkdownTable(
    grid: TableGrid,
    align: TableAlign = "default",
    includeHeader: boolean = true,
): string {
    const separator =
        align === "left"
            ? ":---"
            : align === "center"
              ? ":---:"
              : align === "right"
                ? "---:"
                : "---";

    const divider = `| ${Array.from(
        { length: grid.columns },
        () => separator,
    ).join(" | ")} |`;

    const rowText = (cells: string[]) =>
        fitRow(cells, grid.columns).map(escapeCell).join(" | ");

    // A Markdown table row is delimited by pipes at both ends, so the cell
    // text is wrapped here rather than by the callers.
    const lines = [
        ...(includeHeader ? [rowText(grid.header)] : []),
        ...visibleBodyRows(grid).map(rowText),
    ].map((line) => `| ${line} |`);

    const first = lines[0] ?? `| ${rowText([])} |`;
    return [first, divider, ...lines.slice(1)].join("\n");
}
