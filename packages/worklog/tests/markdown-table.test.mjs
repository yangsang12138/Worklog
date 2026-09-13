/**
 * Tests for the "insert table" grid.
 *
 * The dialog resizes on every keystroke, so the grid separates the *visible*
 * window (columns/rows) from the *storage* behind it (header/body). These tests
 * pin the two things that separation exists for:
 *
 *   1. Changing the row or column count actually changes what is drawn —
 *      the resize is not silently undone (it was, when the dialog's reset
 *      effect depended on the counts it also wrote).
 *   2. A count that passes through a smaller number on the way to the intended
 *      one does not throw away typed cells, and neither does shrinking on
 *      purpose.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAX_TABLE_COLUMNS,
    MAX_TABLE_ROWS,
    addTableRow,
    buildMarkdownTable,
    createTableGrid,
    pasteTableBlock,
    removeTableColumn,
    removeTableRow,
    setTableCell,
    setTableColumns,
    setTableHeaderCell,
    setTableRows,
    visibleBodyRows,
    visibleHeaderCells,
} from '../src/lib/utils/markdown-table.ts';

/** A 3x3 grid with the header and first two body rows filled in. */
function filledGrid() {
    let grid = createTableGrid();
    grid = setTableHeaderCell(grid, 0, '名称');
    grid = setTableHeaderCell(grid, 1, '状态');
    grid = setTableHeaderCell(grid, 2, '备注');
    grid = setTableCell(grid, 0, 0, '登录');
    grid = setTableCell(grid, 0, 1, '完成');
    grid = setTableCell(grid, 1, 0, '注册');
    grid = setTableCell(grid, 1, 1, '进行中');
    return grid;
}

test('a new grid starts at the default size, all cells present', () => {
    const grid = createTableGrid();

    assert.equal(grid.columns, 3);
    assert.equal(grid.rows, 3);
    assert.equal(visibleHeaderCells(grid).length, 3);
    assert.equal(visibleBodyRows(grid).length, 3);
    assert.deepEqual(grid.body[0], ['', '', '']);
});

test('increasing the column count adds editable cells', () => {
    let grid = setTableColumns(createTableGrid(), 5);

    assert.equal(grid.columns, 5);
    assert.equal(visibleHeaderCells(grid).length, 5);
    assert.deepEqual(visibleBodyRows(grid)[0], ['', '', '', '', '']);

    // The added cell is an ordinary cell, not a placeholder.
    grid = setTableCell(grid, 0, 4, '第五列');
    assert.equal(visibleBodyRows(grid)[0][4], '第五列');
});

test('decreasing the column count removes cells from view', () => {
    let grid = setTableColumns(filledGrid(), 2);

    assert.equal(grid.columns, 2);
    assert.deepEqual(visibleHeaderCells(grid), ['名称', '状态']);
    assert.deepEqual(visibleBodyRows(grid)[0], ['登录', '完成']);
});

test('a count that passes through a smaller value keeps every cell', () => {
    // Typing "12" into the column field fires on "1" first; the intermediate
    // value must not be destructive.
    let grid = filledGrid();
    grid = setTableColumns(grid, 1);
    grid = setTableColumns(grid, 12);

    assert.equal(grid.columns, 12);
    assert.deepEqual(visibleHeaderCells(grid).slice(0, 3), [
        '名称',
        '状态',
        '备注',
    ]);
    assert.deepEqual(visibleBodyRows(grid)[0].slice(0, 2), ['登录', '完成']);
});

test('a count that passes through a smaller value keeps every row', () => {
    let grid = filledGrid();
    grid = setTableRows(grid, 1);
    grid = setTableRows(grid, 6);

    assert.equal(grid.rows, 6);
    const rows = visibleBodyRows(grid);
    assert.equal(rows.length, 6);
    assert.deepEqual(rows[0].slice(0, 2), ['登录', '完成']);
    assert.deepEqual(rows[1].slice(0, 2), ['注册', '进行中']);
});

test('shrinking keeps the hidden cells for when the grid grows back', () => {
    let grid = setTableColumns(filledGrid(), 1);
    assert.deepEqual(visibleHeaderCells(grid), ['名称']);

    grid = setTableColumns(grid, 3);
    assert.deepEqual(visibleHeaderCells(grid), ['名称', '状态', '备注']);
    assert.deepEqual(visibleBodyRows(grid)[0].slice(0, 2), ['登录', '完成']);
});

test('the row count is clamped to the supported range', () => {
    assert.equal(setTableRows(createTableGrid(), 0).rows, 1);
    assert.equal(setTableRows(createTableGrid(), -5).rows, 1);
    assert.equal(setTableRows(createTableGrid(), 9999).rows, MAX_TABLE_ROWS);
    assert.equal(setTableColumns(createTableGrid(), 0).columns, 1);
    assert.equal(
        setTableColumns(createTableGrid(), 9999).columns,
        MAX_TABLE_COLUMNS,
    );
});

test('adding a row appends below the visible rows', () => {
    let grid = addTableRow(filledGrid());

    assert.equal(grid.rows, 4);
    assert.deepEqual(visibleBodyRows(grid)[3], ['', '', '']);
    // Existing rows keep their content.
    assert.equal(visibleBodyRows(grid)[0][0], '登录');
});

test('adding a row lands at the window edge, not past hidden rows', () => {
    // Shrink to one visible row (two rows are hidden), then add one.
    let grid = setTableRows(filledGrid(), 1);
    grid = addTableRow(grid);
    grid = setTableCell(grid, 1, 0, '新行');

    const rows = visibleBodyRows(grid);
    assert.equal(rows.length, 2);
    assert.equal(rows[0][0], '登录');
    assert.equal(rows[1][0], '新行');
});

test('removing a row keeps the rest in order and never empties the grid', () => {
    let grid = setTableRows(filledGrid(), 3);
    grid = setTableCell(grid, 2, 0, '第三行');

    grid = removeTableRow(grid, 0);
    assert.equal(grid.rows, 2);
    assert.equal(visibleBodyRows(grid)[0][0], '注册');
    assert.equal(visibleBodyRows(grid)[1][0], '第三行');

    // The last remaining row stays: an empty grid has nowhere to type.
    grid = removeTableRow(grid, 0);
    grid = removeTableRow(grid, 0);
    assert.equal(grid.rows, 1);
    assert.equal(grid.body.length >= 1, true);
});

test('generated Markdown contains exactly the visible grid', () => {
    const markdown = buildMarkdownTable(filledGrid(), 'default', true);

    assert.equal(
        markdown,
        [
            '| 名称 | 状态 | 备注 |',
            '| --- | --- | --- |',
            '| 登录 | 完成 |   |',
            '| 注册 | 进行中 |   |',
            '|   |   |   |',
        ].join('\n'),
    );
});

test('generated Markdown ignores hidden rows and columns', () => {
    let grid = filledGrid();
    grid = setTableColumns(grid, 2);
    grid = setTableRows(grid, 1);

    const lines = buildMarkdownTable(grid, 'default', true).split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0], '| 名称 | 状态 |');
    assert.equal(lines[2], '| 登录 | 完成 |');
});

test('cells containing a pipe or a line break are escaped', () => {
    let grid = setTableColumns(createTableGrid(), 2);
    grid = setTableCell(grid, 0, 0, 'a|b');
    grid = setTableCell(grid, 0, 1, 'line\nbreak');

    const row = buildMarkdownTable(grid, 'default', true).split('\n')[2];
    assert.equal(row, '| a\\|b | line break |');
});

test('alignment lands on the divider row', () => {
    const alignments = {
        default: '| --- | --- | --- |',
        left: '| :--- | :--- | :--- |',
        center: '| :---: | :---: | :---: |',
        right: '| ---: | ---: | ---: |',
    };

    for (const [align, divider] of Object.entries(alignments)) {
        const lines = buildMarkdownTable(
            createTableGrid(),
            align,
            true,
        ).split('\n');
        assert.equal(lines[1], divider, `alignment ${align}`);
    }
});

test('without a header the first data row fills the header slot', () => {
    let grid = createTableGrid();
    grid = setTableCell(grid, 0, 0, '甲');

    const lines = buildMarkdownTable(grid, 'default', false).split('\n');
    // Markdown has no headerless table, so the first row is the header.
    assert.equal(lines[0], '| 甲 |   |   |');
    assert.equal(lines[1], '| --- | --- | --- |');
    // Three data rows in, three rows out — the divider is the only extra line.
    assert.equal(lines.length, 4);
    assert.equal(lines[2], '|   |   |   |');
});

test('a pasted block fills cells and grows the grid to fit', () => {
    const block = [
        ['甲', '乙'],
        ['丙', '丁'],
    ];
    const grid = pasteTableBlock(createTableGrid(3, 3), block, 1, 1);

    const rows = visibleBodyRows(grid);
    assert.equal(rows[1][1], '甲');
    assert.equal(rows[1][2], '乙');
    assert.equal(rows[2][1], '丙');
    assert.equal(rows[2][2], '丁');
    // Untouched cells stay untouched.
    assert.equal(rows[0][0], '');
});

test('a pasted block past the edge grows the rows and columns', () => {
    const block = [
        ['a', 'b', 'c', 'd'],
        ['e', 'f', 'g', 'h'],
        ['i', 'j', 'k', 'l'],
    ];
    const grid = pasteTableBlock(createTableGrid(2, 2), block, 0, 0);

    assert.equal(grid.columns, 4);
    assert.equal(grid.rows, 3);
    assert.deepEqual(visibleBodyRows(grid)[2], ['i', 'j', 'k', 'l']);
});

test('a pasted block larger than the limits is clamped to them', () => {
    const wide = [Array.from({ length: MAX_TABLE_COLUMNS + 5 }, (_, i) => `c${i}`)];
    const grid = pasteTableBlock(createTableGrid(), wide, 0, 0);

    assert.equal(grid.columns, MAX_TABLE_COLUMNS);
    assert.equal(grid.body[0].length, MAX_TABLE_COLUMNS);
    // Everything inside the cap landed, and the cap is what was drawn.
    assert.equal(grid.body[0][MAX_TABLE_COLUMNS - 1], `c${MAX_TABLE_COLUMNS - 1}`);
});

test('a pasted block taller than the limits is clamped to them', () => {
    const tall = Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, i) => [`r${i}`]);
    const grid = pasteTableBlock(createTableGrid(), tall, 0, 0);

    assert.equal(grid.rows, MAX_TABLE_ROWS);
    assert.equal(visibleBodyRows(grid)[MAX_TABLE_ROWS - 1][0], `r${MAX_TABLE_ROWS - 1}`);
});

test('removing a column drops it and keeps the rest in order', () => {
    let grid = removeTableColumn(filledGrid(), 1);

    assert.equal(grid.columns, 2);
    assert.deepEqual(visibleHeaderCells(grid), ['名称', '备注']);
    // Both body rows lost the same column, not just the header.
    assert.deepEqual(visibleBodyRows(grid)[0].slice(0, 2), ['登录', '']);
    assert.deepEqual(visibleBodyRows(grid)[1].slice(0, 2), ['注册', '']);
});

test('removing the first column shifts everything left', () => {
    let grid = removeTableColumn(filledGrid(), 0);

    assert.deepEqual(visibleHeaderCells(grid), ['状态', '备注']);
    assert.deepEqual(visibleBodyRows(grid)[0].slice(0, 2), ['完成', '']);
});

test('a removed column does not come back when one is added', () => {
    let grid = setTableColumns(filledGrid(), 3);
    grid = removeTableColumn(grid, 2);
    grid = setTableColumns(grid, 3);

    // Removing is a decision, not a hide: the refilled column is blank.
    assert.deepEqual(visibleHeaderCells(grid), ['名称', '状态', '']);
});

test('the last remaining column cannot be removed', () => {
    let grid = setTableColumns(createTableGrid(), 1);
    grid = setTableHeaderCell(grid, 0, '唯一');

    grid = removeTableColumn(grid, 0);
    assert.equal(grid.columns, 1);
    assert.deepEqual(visibleHeaderCells(grid), ['唯一']);

    // Out-of-range indexes are ignored rather than corrupting the grid.
    assert.equal(removeTableColumn(grid, 5), grid);
});

test('removing a column keeps rows at the visible width', () => {
    let grid = setTableColumns(createTableGrid(), 4);
    grid = setTableRows(grid, 2);
    grid = removeTableColumn(grid, 2);

    assert.equal(grid.columns, 3);
    assert.equal(visibleBodyRows(grid).length, 2);
    for (const row of visibleBodyRows(grid)) {
        assert.equal(row.length, 3);
    }
    assert.equal(visibleHeaderCells(grid).length, 3);
});

test('generated Markdown drops the removed column', () => {
    const lines = buildMarkdownTable(
        removeTableColumn(filledGrid(), 1),
        'default',
        true,
    ).split('\n');

    assert.equal(lines[0], '| 名称 | 备注 |');
    assert.equal(lines[1], '| --- | --- |');
    assert.equal(lines[2], '| 登录 |   |');
});

test('an empty paste leaves the grid alone', () => {
    const grid = createTableGrid();
    assert.equal(pasteTableBlock(grid, [], 0, 0), grid);
});
