// Боковая панель задачи: название, статус, метка, приоритет, срок, подзадачи, заметки.

import * as store from './store.js';

const $ = (s) => document.querySelector(s);
const drawer = $('#drawer');
const backdrop = $('#drawerBackdrop');
const title = $('#drawerTitle');
const notes = $('#drawerNotes');
const due = $('#drawerDue');
const subList = $('#subtasks');
const subInput = $('#subInput');

let currentId = null;
let lastFocus = null;
let opts = {};

export const openId = () => currentId;

export function initDrawer(options) {
  opts = options;
  $('#drawerClose').addEventListener('click', close);
  backdrop.addEventListener('click', close);

  title.addEventListener('input', () => {
    autosize(title);
    const text = title.value.replace(/\s+/g, ' ').trim();
    if (text) store.update(currentId, { text });
  });
  title.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), title.blur()));
  notes.addEventListener('input', () => store.update(currentId, { notes: notes.value }));
  due.addEventListener('change', () => store.update(currentId, { due: due.value || null }));

  $('#drawerStatus').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (b) store.move(currentId, b.dataset.status);
  });
  $('#drawerTags').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (b) store.update(currentId, { tag: b.dataset.tag });
  });
  $('#drawerPrio').addEventListener('click', (e) => {
    const b = e.target.closest('[data-prio]');
    if (b) store.update(currentId, { priority: b.dataset.prio });
  });
  $('#drawerDone').addEventListener('click', () => {
    const task = store.get(currentId);
    if (task?.status === 'todo' || task?.status === 'done') store.move(currentId, 'doing');
    else store.toggleDone(currentId);
  });
  $('#drawerDelete').addEventListener('click', () => {
    const id = currentId;
    close();
    opts.onDelete?.(id);
  });

  $('#subAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = subInput.value.trim();
    if (!text) return;
    const task = store.get(currentId);
    store.update(currentId, { subtasks: [...task.subtasks, { id: store.uid(), text, done: false }] });
    subInput.value = '';
  });
  subList.addEventListener('change', (e) => {
    const li = e.target.closest('[data-sub]');
    if (!li) return;
    const task = store.get(currentId);
    store.update(currentId, {
      subtasks: task.subtasks.map((s) => (s.id === li.dataset.sub ? { ...s, done: e.target.checked } : s)),
    });
  });
  subList.addEventListener('click', (e) => {
    const del = e.target.closest('.sub-del');
    if (!del) return;
    const id = del.closest('[data-sub]').dataset.sub;
    const task = store.get(currentId);
    store.update(currentId, { subtasks: task.subtasks.filter((s) => s.id !== id) });
  });

  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') trapFocus(e);
  });

  store.subscribe((change) => {
    if (!currentId) return;
    if (!store.get(currentId)) return close();
    if (change.ids.includes(currentId) || change.type === 'reset') sync();
  });
}

export function open(id) {
  if (!store.get(id)) return;
  lastFocus = document.activeElement;
  currentId = id;
  sync(true);
  backdrop.hidden = false;
  drawer.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    drawer.classList.add('is-open');
    backdrop.classList.add('is-open');
  });
  setTimeout(() => title.focus({ preventScroll: true }), 60);
  opts.onOpenChange?.(id);
}

export function close() {
  if (!currentId) return;
  currentId = null;
  drawer.classList.remove('is-open');
  backdrop.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  setTimeout(() => !currentId && (backdrop.hidden = true), 300);
  lastFocus?.focus?.({ preventScroll: true });
  opts.onOpenChange?.(null);
}

function sync(full = false) {
  const task = store.get(currentId);
  if (!task) return;
  // Не перебиваем то, что человек сейчас печатает
  if (full || document.activeElement !== title) {
    title.value = task.text;
    autosize(title);
  }
  if (full || document.activeElement !== notes) notes.value = task.notes;
  due.value = task.due || '';

  drawer.style.setProperty('--c', `var(--tag-${task.tag})`);
  $('#drawerCreated').textContent =
    'Создано ' + new Date(task.createdAt).toLocaleDateString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) +
    (task.doneAt ? ' · готово ' + new Date(task.doneAt).toLocaleDateString('ru', { day: 'numeric', month: 'long' }) : '');

  setActive('#drawerStatus', 'status', task.status);
  setActive('#drawerTags', 'tag', task.tag);
  setActive('#drawerPrio', 'prio', task.priority);
  $('#drawerDone').textContent = task.status === 'todo' ? 'Взять в работу' : task.status === 'done' ? 'Вернуть в работу' : 'Завершить задачу';

  const total = task.subtasks.length;
  const done = task.subtasks.filter((s) => s.done).length;
  $('#subCount').textContent = total ? `${done} из ${total}` : '';
  $('#subBar').style.width = total ? `${(done / total) * 100}%` : '0%';
  $('#subBar').parentElement.hidden = !total;

  subList.textContent = '';
  task.subtasks.forEach((s) => {
    const li = document.createElement('li');
    li.dataset.sub = s.id;
    li.className = s.done ? 'done' : '';
    li.innerHTML = `<label class="check small"><input type="checkbox"><span class="box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span></label>
      <span class="sub-text"></span>
      <button type="button" class="sub-del" aria-label="Удалить подзадачу"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
    li.querySelector('input').checked = s.done;
    li.querySelector('input').setAttribute('aria-label', s.text);
    li.querySelector('.sub-text').textContent = s.text;
    subList.appendChild(li);
  });
}

function setActive(sel, key, value) {
  document.querySelectorAll(`${sel} [data-${key}]`).forEach((b) => {
    const on = b.dataset[key] === value;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on);
  });
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function trapFocus(e) {
  const items = [...drawer.querySelectorAll('button, input, textarea, [tabindex="0"]')].filter((el) => !el.disabled && el.offsetParent);
  const first = items[0];
  const last = items.at(-1);
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
