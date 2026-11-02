// Состояние задач: хранение в localStorage, миграция со старой версии, подписка на изменения.

const KEY = 'taskflow.tasks.v2';
const OLD_KEY = 'taskflow.tasks.v1';

export const STATUSES = ['todo', 'doing', 'done'];
export const STATUS_LABELS = { todo: 'К выполнению', doing: 'В работе', done: 'Готово' };
export const TAGS = { work: 'Работа', home: 'Личное', study: 'Учёба', urgent: 'Срочно' };
export const PRIORITIES = { low: 'Низкий', med: 'Средний', high: 'Высокий' };

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

const listeners = new Set();
let tasks = load();

function normalize(t) {
  return {
    id: t.id || uid(),
    text: String(t.text || '').slice(0, 200),
    tag: TAGS[t.tag] ? t.tag : 'work',
    priority: PRIORITIES[t.priority] ? t.priority : 'med',
    status: STATUSES.includes(t.status) ? t.status : t.done ? 'done' : 'todo',
    due: typeof t.due === 'string' ? t.due : null,
    notes: typeof t.notes === 'string' ? t.notes : '',
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter((s) => s && s.text) : [],
    createdAt: t.createdAt || Date.now(),
    doneAt: t.doneAt || null,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw).filter((t) => t && t.text).map(normalize);
    const old = localStorage.getItem(OLD_KEY);
    if (old) return JSON.parse(old).filter((t) => t && t.text).map(normalize);
  } catch {
    return [];
  }
  return demo();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(tasks));
  } catch {
    // приватный режим: работаем без сохранения
  }
}

function emit(change) {
  persist();
  listeners.forEach((fn) => fn(change));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const all = () => tasks;
export const get = (id) => tasks.find((t) => t.id === id);
export const byStatus = (status) => tasks.filter((t) => t.status === status);

export function add(data) {
  const task = normalize({ ...data, id: uid(), createdAt: Date.now() });
  if (task.status === 'done') task.doneAt = Date.now();
  // новая задача встаёт первой в своей колонке
  const first = tasks.findIndex((t) => t.status === task.status);
  tasks.splice(first === -1 ? tasks.length : first, 0, task);
  emit({ type: 'add', ids: [task.id] });
  return task;
}

export function update(id, patch) {
  const task = get(id);
  if (!task) return;
  const prevStatus = task.status;
  Object.assign(task, patch);
  if (patch.status && patch.status !== prevStatus) {
    task.doneAt = patch.status === 'done' ? Date.now() : null;
  }
  emit({ type: 'update', ids: [id], from: prevStatus, to: task.status });
}

// Переносит задачу в колонку status и ставит перед beforeId (или в конец колонки)
export function move(id, status, beforeId = null) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [task] = tasks.splice(index, 1);
  const prevStatus = task.status;
  if (status !== prevStatus) {
    task.status = status;
    task.doneAt = status === 'done' ? Date.now() : null;
  }
  let at = beforeId ? tasks.findIndex((t) => t.id === beforeId) : -1;
  if (at === -1) {
    const lastInCol = tasks.map((t) => t.status).lastIndexOf(status);
    at = lastInCol === -1 ? tasks.length : lastInCol + 1;
  }
  tasks.splice(at, 0, task);
  emit({ type: 'move', ids: [id], from: prevStatus, to: status });
}

export function toggleDone(id) {
  const task = get(id);
  if (!task) return;
  move(id, task.status === 'done' ? 'todo' : 'done', firstIdOf(task.status === 'done' ? 'todo' : 'done'));
}

function firstIdOf(status) {
  return tasks.find((t) => t.status === status)?.id || null;
}

export function remove(ids) {
  const removed = [];
  tasks.forEach((task, index) => ids.includes(task.id) && removed.push({ task, index }));
  if (!removed.length) return [];
  tasks = tasks.filter((t) => !ids.includes(t.id));
  emit({ type: 'remove', ids });
  return removed;
}

export function restore(removed) {
  [...removed]
    .sort((a, b) => a.index - b.index)
    .forEach(({ task, index }) => tasks.splice(Math.min(index, tasks.length), 0, task));
  emit({ type: 'add', ids: removed.map((r) => r.task.id) });
}

export function replaceAll(list) {
  tasks = list.map(normalize);
  emit({ type: 'reset', ids: [] });
}

// Синхронизация между вкладками
window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    tasks = load();
    listeners.forEach((fn) => fn({ type: 'reset', ids: [] }));
  }
});

// Пример задач при самом первом открытии, чтобы дашборд не был пустым
export function demo() {
  const day = 864e5;
  const now = Date.now();
  const iso = (offset) => new Date(now + offset * day).toISOString().slice(0, 10);
  const sub = (text, done = false) => ({ id: uid(), text, done });
  return [
    { text: 'Отправить тестовое задание в The Digital', tag: 'urgent', priority: 'high', status: 'doing', due: iso(0),
      subtasks: [sub('Залить код на GitHub', true), sub('Включить GitHub Pages', true), sub('Написать сопроводительное')] },
    { text: 'Собрать 3D-дашборд на Three.js', tag: 'work', priority: 'high', status: 'doing', due: iso(1),
      notes: 'Этажи по статусам, задачи парят над ними, bloom-свечение.' },
    { text: 'Прочитать главу про замыкания в JavaScript', tag: 'study', priority: 'med', status: 'todo', due: iso(3) },
    { text: 'Записаться в зал на вечер', tag: 'home', priority: 'low', status: 'todo', due: null },
    { text: 'Разобрать почту и ответить клиентам', tag: 'work', priority: 'med', status: 'todo', due: iso(-1) },
    { text: 'Купить продукты на неделю', tag: 'home', priority: 'low', status: 'todo', due: iso(2) },
    { text: 'Созвон с командой', tag: 'work', priority: 'med', status: 'done', doneAt: now - 2 * 36e5 },
    { text: 'Сверстать карточки канбана', tag: 'work', priority: 'high', status: 'done', doneAt: now - 1 * day },
    { text: 'Повторить алгоритмы сортировки', tag: 'study', priority: 'med', status: 'done', doneAt: now - 2 * day },
    { text: 'Оплатить интернет', tag: 'home', priority: 'low', status: 'done', doneAt: now - 4 * day },
    { text: 'Обновить резюме', tag: 'urgent', priority: 'high', status: 'done', doneAt: now - 5 * day },
  ].map((t, i) => normalize({ ...t, id: uid(), createdAt: now - (i + 1) * 7 * 36e5 }));
}
