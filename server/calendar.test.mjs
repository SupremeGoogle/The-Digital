import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: () => '[]', setItem() {} };
const { calendarCells } = await import('../js/calendar.js');

test('calendar uses Monday first and the actual November 2026 weekday positions', () => {
  const cells = calendarCells(2026, 10);
  assert.equal(cells.length, 42);
  assert.equal(cells[0].date.getDay(), 1);
  assert.equal(cells.findIndex(cell => cell.iso === '2026-11-01'), 6);
  assert.equal(cells.findIndex(cell => cell.iso === '2026-11-02'), 7);
});
test('calendar retains 42 unique local dates through leap years and year rollover', () => {
  for (const [year, month, count] of [[2028, 1, 29], [2026, 11, 31], [2027, 0, 31]]) {
    const cells = calendarCells(year, month);
    assert.equal(new Set(cells.map(cell => cell.iso)).size, 42);
    assert.equal(cells.filter(cell => cell.inMonth).length, count);
  }
});
