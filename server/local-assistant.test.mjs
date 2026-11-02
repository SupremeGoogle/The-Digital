import test from 'node:test';
import assert from 'node:assert/strict';

// Browser-only APIs are not used by the pure analytical helpers.
globalThis.matchMedia = () => ({ matches: false });
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: () => '[]' };
const { localAnswer, taskContext, reactionForChange } = await import('../js/assistant.js');

function task(text, status, priority = 'med', due = null) {
  return { text, status, priority, due, tag: 'work', notes: 'private detail', subtasks: [] };
}

test('local answers use the latest totals and exclude notes from remote context', () => {
  const tasks = [task('Написать письмо', 'todo'), task('Проверить сайт', 'doing'), task('Собрать макет', 'done')];
  assert.match(localAnswer('Сколько задач осталось?', tasks), /Осталось 2 задачи: 1 в работе и 1 запланировано/);
  tasks[0].status = 'done';
  assert.match(localAnswer('Сколько я выполнил?', tasks), /Выполнено: 2 \(67%\)/);
  assert.equal(JSON.stringify(taskContext(tasks)).includes('private detail'), false);
});

test('overdue tasks rank before a future high-priority task and guide stays useful', () => {
  const tasks = [task('Будущая задача', 'todo', 'high', '2099-12-01'), task('Просроченная задача', 'todo', 'low', '2000-01-01')];
  assert.match(localAnswer('Какие задачи важнее?', tasks), /начать с «Просроченная задача»/);
  assert.match(localAnswer('Какие сроки?', tasks), /Просрочено: 1/);
  assert.match(localAnswer('Как пользоваться сайтом?', tasks), /Ctrl\+K/);
  assert.match(localAnswer('Расскажи про космос', tasks), /Свободный диалог появится после подключения AI/);
  assert.match(localAnswer('Диди', tasks), /Привет! Я Диди/);
});

test('today completions use doneAt and tomorrow agenda excludes other dates', () => {
  const now = new Date();
  const iso = offset => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const tasks = [
    { ...task('Готово сегодня', 'done'), doneAt: now.getTime() },
    { ...task('Готово вчера', 'done'), doneAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).getTime() },
    task('Дело на сегодня', 'todo', 'med', iso(0)),
    task('Дело на завтра', 'todo', 'high', iso(1)),
    task('Дальнее дело', 'todo', 'high', iso(3)),
  ];
  assert.match(localAnswer('Сколько я выполнил сегодня?', tasks), /Сегодня выполнено 1 задача/);
  assert.equal(taskContext(tasks).stats.doneToday, 1);
  const tomorrow = localAnswer('Что на завтра?', tasks);
  assert.match(tomorrow, /Дело на завтра — Завтра/);
  assert.equal(tomorrow.includes('Дело на сегодня'), false);
  assert.equal(tomorrow.includes('Дальнее дело'), false);
  const today = localAnswer('Что на сегодня?', tasks);
  assert.match(today, /Дело на сегодня — Сегодня/);
  assert.equal(today.includes('Дело на завтра'), false);
});

test('proactive reactions follow actual actions without inventing task changes', () => {
  const tasks = [{ ...task('Задача', 'done'), id: 'one' }];
  assert.match(reactionForChange({ type: 'move', from: 'doing', to: 'done', ids: ['one'] }, new Map(), tasks).text, /Всё готово/);
  assert.equal(reactionForChange({ type: 'reset', ids: [] }, new Map(), tasks), null);
  assert.match(reactionForChange({ type: 'add', ids: ['one'] }, new Map(), tasks).text, /Записал/);
  const current = [{ ...task('Задача', 'todo', 'high'), id: 'one' }];
  const prior = new Map([['one', { priority: 'low', due: null }]]);
  assert.equal(reactionForChange({ type: 'update', from: 'todo', to: 'todo', ids: ['one'] }, prior, current).then, 'attentive');
  assert.equal(current[0].status, 'todo');
});
