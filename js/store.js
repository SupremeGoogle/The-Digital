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

// Примеры имеют постоянные ID: повторное добавление не дублирует задачи.
// Даты считаются по местному календарю, без сдвига дня при переводе в UTC.
export function addDemoTasks() {
  const ids = new Set(tasks.map((task) => task.id));
  const titles = new Set(tasks.map((task) => task.text.trim().toLocaleLowerCase('ru')));
  const added = demo().filter((task) => !ids.has(task.id) && !titles.has(task.text.trim().toLocaleLowerCase('ru')));
  if (!added.length) return 0;
  tasks.push(...added);
  emit({ type: 'add', ids: added.map((task) => task.id) });
  return added.length;
}

// Насыщенный, явно демонстрационный набор для самого первого открытия.
// Существующий localStorage и задачи пользователя не заменяются.
export function demo() {
  const now = Date.now();
  const day = 864e5;
  const localDay = (offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const iso = (offset) => {
    const date = localDay(offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const completed = (daysAgo, hour = 11) => {
    if (daysAgo === 0) return now - Math.min(2 * 36e5, (now - localDay(0).getTime()) / 2);
    const date = localDay(-daysAgo);
    date.setHours(hour, 15, 0, 0);
    return date.getTime();
  };
  const sub = (text, done = false) => ({ text, done });
  return [
    { text: 'Подготовить презентацию проекта', tag: 'work', priority: 'high', status: 'todo', due: iso(1),
      notes: 'Собрать короткую историю: задача, решение, результат. Оставить пять минут на вопросы.',
      subtasks: [sub('Собрать ключевые тезисы', true), sub('Оформить шесть слайдов'), sub('Проверить ссылки')] },
    { text: 'Обновить портфолио', tag: 'work', priority: 'med', status: 'todo', due: iso(3),
      notes: 'Добавить новый кейс и несколько экранов. Выделить свою роль и полученный результат.' },
    { text: 'Прочитать главу про замыкания', tag: 'study', priority: 'med', status: 'todo', due: iso(2),
      subtasks: [sub('Прочитать объяснение'), sub('Разобрать три примера'), sub('Записать выводы')] },
    { text: 'Запланировать тренировку', tag: 'home', priority: 'low', status: 'todo', due: iso(1),
      notes: 'Выбрать удобное время и добавить напоминание в календарь.' },
    { text: 'Разобрать входящие письма', tag: 'urgent', priority: 'high', status: 'todo', due: iso(-1),
      notes: 'Пример просроченной задачи: проверить важные письма и перенести оставшиеся на подходящую дату.' },
    { text: 'Составить список покупок', tag: 'home', priority: 'low', status: 'todo', due: iso(2),
      subtasks: [sub('Проверить запасы', true), sub('Составить меню'), sub('Записать продукты')] },
    { text: 'Проверить мобильную версию', tag: 'work', priority: 'high', status: 'doing', due: iso(0),
      notes: 'Проверить формы, переносы текста и управление задачами на узком экране.',
      subtasks: [sub('Проверить экран 390 px', true), sub('Проверить экран 768 px'), sub('Пройти сценарий добавления')] },
    { text: 'Отправить тестовое задание', tag: 'urgent', priority: 'high', status: 'doing', due: iso(0),
      notes: 'Подготовить ссылку на репозиторий, рабочий сайт и короткое описание использованных AI-инструментов.',
      subtasks: [sub('Проверить репозиторий', true), sub('Проверить сайт', true), sub('Написать сопроводительный текст')] },
    { text: 'Изучить анимации интерфейса', tag: 'study', priority: 'med', status: 'doing', due: iso(3),
      notes: 'Разобрать переходы состояний и поддержку reduced motion.',
      subtasks: [sub('Посмотреть примеры', true), sub('Сделать небольшой прототип')] },
    { text: 'Спланировать выходные', tag: 'home', priority: 'low', status: 'doing', due: iso(5),
      notes: 'Оставить время на прогулку, отдых и одно небольшое личное дело.' },
    { text: 'Собрать референсы интерфейса', tag: 'work', priority: 'med', status: 'done', doneAt: completed(0),
      subtasks: [sub('Выбрать три направления', true), sub('Собрать палитру', true)] },
    { text: 'Настроить сохранение задач', tag: 'work', priority: 'high', status: 'done', doneAt: completed(0),
      notes: 'Проверить восстановление списка после перезагрузки страницы.' },
    { text: 'Составить план на неделю', tag: 'home', priority: 'med', status: 'done', doneAt: completed(1),
      notes: 'Выбрать три главных результата и распределить небольшие дела.' },
    { text: 'Повторить методы массивов', tag: 'study', priority: 'med', status: 'done', doneAt: completed(2),
      subtasks: [sub('Повторить map и filter', true), sub('Решить задачу с reduce', true)] },
    { text: 'Подготовить README проекта', tag: 'work', priority: 'med', status: 'done', doneAt: completed(3),
      notes: 'Добавить запуск, основные возможности и использованные инструменты.' },
    { text: 'Проверить важные ссылки', tag: 'urgent', priority: 'high', status: 'done', doneAt: completed(4),
      notes: 'Убедиться, что сайт и репозиторий открываются без авторизации.' },
    { text: 'Навести порядок в заметках', tag: 'home', priority: 'low', status: 'done', doneAt: completed(5),
      notes: 'Сохранить полезные идеи и убрать устаревшие черновики.' },
    { text: 'Пройти урок по доступности', tag: 'study', priority: 'med', status: 'done', doneAt: completed(6),
      subtasks: [sub('Проверить контраст', true), sub('Пройти интерфейс клавиатурой', true)] },
  ].map((task, index) => {
    const id = `digitaltodo-demo-v1-${String(index + 1).padStart(2, '0')}`;
    return normalize({
      ...task,
      id,
      notes: `Пример задачи для знакомства с Digital To-Do. ${task.notes || 'Можно изменить, перенести или удалить этот пример.'}`,
      subtasks: (task.subtasks || []).map((item, subIndex) => ({ ...item, id: `${id}-sub-${subIndex + 1}` })),
      createdAt: now - (index + 9) * day,
    });
  });
}
