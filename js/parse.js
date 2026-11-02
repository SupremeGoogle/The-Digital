// Умный ввод: «Купить хлеб #личное ! завтра» → текст, метка, приоритет и срок.

const TAG_WORDS = {
  work: ['работа', 'work', 'раб'],
  home: ['личное', 'дом', 'home', 'личн'],
  study: ['учёба', 'учеба', 'study', 'учеб'],
  urgent: ['срочно', 'urgent', 'срочн'],
};

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export const toISO = (d) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 6e4);
  return local.toISOString().slice(0, 10);
};

function addDays(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function parseQuick(input) {
  const result = { text: '', tag: null, priority: null, due: null };
  const words = [];

  input.trim().split(/\s+/).forEach((raw, i, arr) => {
    const w = raw.toLowerCase();

    if (w.startsWith('#') && w.length > 1) {
      const name = w.slice(1);
      const tag = Object.keys(TAG_WORDS).find((k) => TAG_WORDS[k].some((v) => name.startsWith(v)));
      if (tag) return (result.tag = tag);
    }
    if (w === '!' || w === '!!' || w === '!!!') return (result.priority = 'high');
    if (w === '~') return (result.priority = 'low');

    if (w === 'сегодня') return (result.due = addDays(0));
    if (w === 'завтра') return (result.due = addDays(1));
    if (w === 'послезавтра') return (result.due = addDays(2));

    // «через 3 дня»
    if (w === 'через' && /^\d+$/.test(arr[i + 1] || '') && /^д(ень|ня|ней)$/.test((arr[i + 2] || '').toLowerCase())) {
      result.due = addDays(Number(arr[i + 1]));
      arr[i + 1] = arr[i + 2] = '';
      return;
    }
    if (w === '') return;

    // «в пт», «пн»
    const wd = WEEKDAYS.indexOf(w.replace(/^в\s*/, ''));
    if (wd !== -1 && (words.at(-1) || '').toLowerCase() === 'в') {
      words.pop();
      const diff = (wd - new Date().getDay() + 7) % 7 || 7;
      return (result.due = addDays(diff));
    }

    // 25.12 или 25.12.2026
    const m = w.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
    if (m) {
      const now = new Date();
      let year = m[3] ? Number(m[3]) : now.getFullYear();
      const d = new Date(year, Number(m[2]) - 1, Number(m[1]), 12);
      if (!m[3] && d < now && now - d > 864e5) d.setFullYear(year + 1);
      if (!isNaN(d)) return (result.due = toISO(d));
    }

    words.push(raw);
  });

  result.text = words.join(' ').trim();
  return result;
}

export function dueInfo(due) {
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due + 'T00:00:00');
  const diff = Math.round((d - today) / 864e5);
  let label;
  if (diff === 0) label = 'Сегодня';
  else if (diff === 1) label = 'Завтра';
  else if (diff === -1) label = 'Вчера';
  else label = d.toLocaleDateString('ru', { day: 'numeric', month: 'short' }).replace('.', '');
  return { diff, label, state: diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff <= 2 ? 'soon' : 'later' };
}
