// Канбан: отрисовка колонок, drag & drop мышью и пальцем, перенос с клавиатуры.

import * as store from './store.js';
import { dueInfo } from './parse.js';

const board = document.getElementById('board');
const tpl = document.getElementById('cardTpl');
const trash = document.getElementById('trash');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let opts = {};
let drag = null;
let suppressClick = false;

export function initBoard(options) {
  opts = options;
  board.addEventListener('pointerdown', onDown);
  board.addEventListener('click', onClick);
  board.addEventListener('change', onToggle);
  board.addEventListener('keydown', onKey);
  board.addEventListener('pointerover', (e) => opts.onHover?.(e.target.closest('.card-item')?.dataset.id || null));
  board.addEventListener('pointerleave', () => opts.onHover?.(null));
  // Пока тянем пальцем, страница не должна прокручиваться
  document.addEventListener('touchmove', (e) => drag?.started && e.preventDefault(), { passive: false });
}

// ---------- отрисовка ----------

export function renderBoard({ query = '', tag = 'all', animate = false } = {}) {
  const q = query.trim().toLowerCase();
  const match = (t) =>
    (tag === 'all' || t.tag === tag) &&
    (!q || t.text.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) || t.subtasks.some((s) => s.text.toLowerCase().includes(q)));

  const mutate = () => {
    // Узлы переиспользуются: перенос между колонками сохраняет элемент и его фокус
    const visibleIds = new Set(store.all().filter(match).map((t) => t.id));
    const existing = new Map();
    board.querySelectorAll('.card-item').forEach((li) => {
      if (visibleIds.has(li.dataset.id)) existing.set(li.dataset.id, li);
      else li.remove();
    });

    store.STATUSES.forEach((status) => {
      const list = board.querySelector(`.col-list[data-status="${status}"]`);
      const all = store.byStatus(status);
      const visible = all.filter(match);
      board.querySelector(`[data-count="${status}"]`).textContent =
        visible.length === all.length ? all.length : `${visible.length}/${all.length}`;

      visible.forEach((task, i) => {
        let li = existing.get(task.id);
        if (!li) {
          li = tpl.content.firstElementChild.cloneNode(true);
          li.dataset.id = task.id;
        }
        fill(li, task);
        const current = list.children[i];
        if (current !== li) list.insertBefore(li, current || null);
      });
    });
  };

  const focused = document.activeElement?.closest?.('.card-item')?.dataset.id;
  if (animate) flip(mutate);
  else mutate();
  if (focused) board.querySelector(`[data-id="${focused}"]`)?.focus({ preventScroll: true });
}

function fill(li, task) {
  li.dataset.status = task.status;
  li.style.setProperty('--c', `var(--tag-${task.tag})`);
  li.classList.toggle('done', task.status === 'done');
  li.querySelector('input[type="checkbox"]').checked = task.status === 'done';
  li.querySelector('.check').hidden = task.status === 'todo';
  const startButton = li.querySelector('.ci-start');
  startButton.hidden = task.status !== 'todo';
  startButton.setAttribute('aria-label', `Взять в работу: ${task.text}`);
  li.querySelector('.ci-text').textContent = task.text;

  const flag = li.querySelector('.flag');
  flag.className = `flag p-${task.priority}`;
  flag.title = `${store.PRIORITIES[task.priority]} приоритет`;

  const chip = li.querySelector('.chip');
  chip.className = `chip tag-${task.tag}`;
  chip.textContent = store.TAGS[task.tag];

  const due = li.querySelector('.due');
  const info = dueInfo(task.due);
  due.hidden = !info;
  if (info) {
    due.textContent = info.label;
    due.dataset.state = task.status === 'done' ? 'later' : info.state;
  }

  const subs = li.querySelector('.subs');
  const total = task.subtasks.length;
  const doneSubs = task.subtasks.filter((s) => s.done).length;
  subs.hidden = !total;
  if (total) {
    subs.querySelector('span').textContent = `${doneSubs}/${total}`;
    subs.style.setProperty('--p', `${(doneSubs / total) * 100}%`);
  }

  const parts = [task.text, store.STATUS_LABELS[task.status], `метка ${store.TAGS[task.tag]}`, `${store.PRIORITIES[task.priority]} приоритет`];
  if (info) parts.push(`срок ${info.label}`);
  if (total) parts.push(`подзадачи ${doneSubs} из ${total}`);
  li.setAttribute('aria-label', parts.join(', '));
}

// FLIP: карточки плавно переезжают на новые места
function flip(mutate) {
  if (reduceMotion) return mutate();
  const items = [...board.querySelectorAll('.card-item')];
  const before = new Map(items.map((el) => [el, el.getBoundingClientRect()]));
  mutate();
  board.querySelectorAll('.card-item').forEach((el) => {
    const a = before.get(el);
    if (!a) return;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 260,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }
  });
}

// ---------- клики ----------

function onClick(e) {
  if (suppressClick) return;
  const card = e.target.closest('.card-item');
  if (card && e.target.closest('.ci-start')) {
    store.move(card.dataset.id, 'doing');
    opts.announce?.('Задача взята в работу');
    return;
  }
  if (!card || e.target.closest('.check')) return;
  opts.onOpen?.(card.dataset.id);
}

function onToggle(e) {
  if (!e.target.matches('input[type="checkbox"]')) return;
  const card = e.target.closest('.card-item');
  store.toggleDone(card.dataset.id);
}

// ---------- клавиатура ----------

function onKey(e) {
  const card = e.target.closest('.card-item');
  if (!card || e.target !== card) return;
  const id = card.dataset.id;
  const task = store.get(id);
  if (!task) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    opts.onOpen?.(id);
  } else if (e.key === ' ') {
    e.preventDefault();
    if (task.status === 'todo') store.move(id, 'doing');
    else store.toggleDone(id);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    opts.onDelete?.(id);
  } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const i = store.STATUSES.indexOf(task.status) + (e.key === 'ArrowRight' ? 1 : -1);
    const status = store.STATUSES[i];
    if (status) {
      store.move(id, status);
      opts.announce?.(`Перенесено в «${store.STATUS_LABELS[status]}»`);
    }
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const col = store.byStatus(task.status);
    const i = col.findIndex((t) => t.id === id);
    if (e.key === 'ArrowUp' && i > 0) store.move(id, task.status, col[i - 1].id);
    if (e.key === 'ArrowDown' && i < col.length - 1) store.move(id, task.status, col[i + 2]?.id || null);
  } else if (!e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const sib = e.key === 'ArrowDown' ? card.nextElementSibling : card.previousElementSibling;
    sib?.focus();
  } else if (!e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const col = card.closest('.col');
    const next = e.key === 'ArrowRight' ? col.nextElementSibling : col.previousElementSibling;
    next?.querySelector('.card-item')?.focus();
  }
}

// ---------- drag & drop ----------

function onDown(e) {
  if (e.button !== 0 || drag) return;
  const card = e.target.closest('.card-item');
  if (!card || e.target.closest('.check, .ci-start')) return;

  drag = { card, id: card.dataset.id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', started: false };
  if (drag.touch) {
    // На телефоне drag начинается после удержания, иначе свайп — это прокрутка
    drag.timer = setTimeout(() => drag && !drag.started && begin(), 260);
    card.classList.add('is-pressing');
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

function onMove(e) {
  if (!drag) return;
  drag.x = e.clientX;
  drag.y = e.clientY;
  const dist = Math.hypot(drag.x - drag.x0, drag.y - drag.y0);
  if (!drag.started) {
    if (drag.touch && dist > 8) return cleanup();
    if (drag.touch || dist <= 6) return;
    begin();
  }
  e.preventDefault();
  position();
  retarget();
}

function begin() {
  const { card } = drag;
  card.classList.remove('is-pressing');
  const rect = card.getBoundingClientRect();
  drag.started = true;
  drag.dx = drag.x0 - rect.left;
  drag.dy = drag.y0 - rect.top;

  const ghost = card.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.removeAttribute('tabindex');
  ghost.style.width = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  document.body.appendChild(ghost);
  drag.ghost = ghost;

  card.classList.add('is-placeholder');
  document.body.classList.add('is-dragging');
  trash.classList.add('is-visible');
  navigator.vibrate?.(12);
  position();
  autoScroll();
}

function position() {
  const { ghost, x, y, dx, dy } = drag;
  const tilt = Math.max(-6, Math.min(6, (x - (drag.lastX ?? x)) * 0.6));
  drag.lastX = x;
  ghost.style.transform = `translate3d(${x - dx}px, ${y - dy}px, 0) rotate(${tilt}deg) scale(1.03)`;
}

function retarget() {
  const { card, x, y } = drag;
  const el = document.elementFromPoint(x, y);
  // Корзина «взводится» после короткого удержания, чтобы не удалить карточку случайно
  const overTrash = !!el?.closest('#trash');
  if (overTrash && !drag.trashSince) drag.trashSince = performance.now();
  if (!overTrash) drag.trashSince = 0;
  drag.overTrash = overTrash && performance.now() - drag.trashSince > 450;
  trash.classList.toggle('is-hot', overTrash);
  trash.classList.toggle('is-armed', drag.overTrash);

  board.querySelectorAll('.col').forEach((c) => c.classList.remove('is-over'));
  let col = el?.closest('.col');
  // Пустая область под короткой колонкой тоже принимает карточки.
  if (!col && !overTrash) {
    const rect = board.getBoundingClientRect();
    if (y >= rect.top && y <= rect.bottom + 28) {
      col = [...board.querySelectorAll('.col')].find((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return x >= bounds.left && x <= bounds.right;
      });
    }
  }
  if (!col || overTrash) return;
  col.classList.add('is-over');
  const list = col.querySelector('.col-list');
  const before = [...list.querySelectorAll('.card-item:not(.is-placeholder)')].find((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  if (card.parentElement !== list || card.nextElementSibling !== (before || null)) {
    flip(() => list.insertBefore(card, before || null));
  }
}

function autoScroll() {
  if (!drag?.started) return;
  const edge = 80;
  const { y } = drag;
  let v = 0;
  if (y < edge) v = -Math.ceil((edge - y) / 5);
  else if (y > innerHeight - edge) v = Math.ceil((y - (innerHeight - edge)) / 5);
  if (v) scrollBy(0, v);
  if (v || drag.trashSince) retarget();
  requestAnimationFrame(autoScroll);
}

function onUp() {
  if (!drag) return;
  if (!drag.started) return cleanup();

  const { card, id, ghost, overTrash } = drag;
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 0);

  if (overTrash) {
    navigator.vibrate?.(20);
    ghost.animate([{ opacity: 1 }, { opacity: 0, transform: ghost.style.transform + ' scale(.6)' }], { duration: 200 }).onfinish = () => ghost.remove();
    card.classList.remove('is-placeholder');
    cleanup(false);
    opts.onDelete?.(id);
    return;
  }

  // Отпустили над корзиной, не дождавшись: возвращаем карточку на место
  if (drag.trashSince) {
    ghost.remove();
    card.classList.remove('is-placeholder');
    cleanup();
    opts.onCancel?.();
    return;
  }

  const status = card.parentElement.dataset.status;
  let next = card.nextElementSibling;
  const beforeId = next?.dataset.id || null;
  const target = card.getBoundingClientRect();
  ghost.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s';
  ghost.style.transform = `translate3d(${target.left}px, ${target.top}px, 0)`;
  ghost.classList.add('landing');
  setTimeout(() => {
    ghost.remove();
    card.classList.remove('is-placeholder');
    card.classList.add('just-dropped');
    setTimeout(() => card.classList.remove('just-dropped'), 500);
  }, 220);
  cleanup(false);
  store.move(id, status, beforeId);
}

function onCancel() {
  if (drag?.started) {
    drag.ghost.remove();
    drag.card.classList.remove('is-placeholder');
    opts.onCancel?.();
  }
  cleanup();
}

function cleanup() {
  if (!drag) return;
  clearTimeout(drag.timer);
  drag.card.classList.remove('is-pressing');
  document.body.classList.remove('is-dragging');
  trash.classList.remove('is-visible', 'is-hot', 'is-armed');
  board.querySelectorAll('.col').forEach((c) => c.classList.remove('is-over'));
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  drag = null;
}
