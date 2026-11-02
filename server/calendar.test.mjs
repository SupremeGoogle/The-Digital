import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: () => '[]', setItem() {} };
const { calendarCells } = await import('../js/calendar.js');
const { calendarFile } = await import('../js/calendar-export.js');

test('calendar export preserves dates across year boundaries and escapes multiline text', () => {
  const content = calendarFile([
    { id: 'a', text: 'План, итог;\\\nBEGIN:VEVENT', due: '2026-12-31', status: 'todo' },
    { id: 'b', text: 'Готово', due: '2026-12-31', status: 'done' },
    { id: 'c', text: 'Без даты', due: '2026-02-30', status: 'todo' },
    { id: 'd', text: 'Я'.repeat(100), due: '2028-02-29', status: 'doing' },
  ], new Date('2026-11-02T12:00:00Z'));
  assert.equal(content.match(/^BEGIN:VEVENT$/gm).length, 2);
  assert.match(content, /DTEND;VALUE=DATE:20270101/);
  assert.match(content, /DTEND;VALUE=DATE:20280301/);
  assert.ok(content.includes('SUMMARY:План\\, итог\\;\\\\\\nBEGIN:VEVENT'));
  assert.ok(content.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
});

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
