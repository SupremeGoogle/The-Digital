// RFC 5545: all-day events keep the task's date in every time zone.
const text = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
function fold(line) {
  let result = '', bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
    result += char; bytes += size;
  }
  return result;
}
function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? date : null;
}
export function calendarFile(tasks, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Digital To-Do//Tasks//RU', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Digital To-Do'];
  for (const task of tasks) {
    const due = dateValue(task.due);
    if (!due || task.status === 'done') continue;
    const start = task.due.replace(/-/g, '');
    due.setUTCDate(due.getUTCDate() + 1);
    const end = due.toISOString().slice(0, 10).replace(/-/g, '');
    const uid = encodeURIComponent(String(task.id));
    lines.push('BEGIN:VEVENT', `UID:${uid}@digital-todo`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${text(task.text)}`, 'DESCRIPTION:Задача из Digital To-Do', 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  return lines.concat('END:VCALENDAR').map(fold).join('\r\n') + '\r\n';
}
export function downloadCalendar(tasks) {
  const blob = new Blob([calendarFile(tasks)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'digital-todo.ics';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
