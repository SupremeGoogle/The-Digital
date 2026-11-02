import * as store from './store.js';
import { parseQuick, dueInfo } from './parse.js';
import { initBoard, renderBoard } from './board.js';
import { initDrawer, open as openDrawer, close as closeDrawer } from './drawer.js';
import { initDashboard, renderDashboard } from './dashboard.js';
import { initIntro } from './intro.js';
import { initAssistant } from './assistant.js';
import { initTaskEffects } from './task-effects.js';
import { initCalendar } from './calendar.js';
import { initReminders } from './reminders.js';

const introReady = initIntro();

const $ = (s) => document.querySelector(s);
const THEME_KEY = 'taskflow.sky.theme';
const filters = { query: '', tag: 'all' };
let scene = null;
let sceneLoading = false;
const compactScreen = matchMedia('(max-width: 700px)');
let undo = null;

// Однократное наполнение новой витрины. Существующие задачи не заменяются.
try {
  if (!localStorage.getItem('digitaltodo.examples.v1')) {
    store.addDemoTasks();
    localStorage.setItem('digitaltodo.examples.v1', '1');
  }
} catch { /* Недоступное хранилище не мешает работе. */ }

const calendar = initCalendar({
  onOpen: openDrawer,
  onAddDate(iso) {
    $('#dueInput').value = iso;
    $('.composer-advanced').open = true;
    $('#composer').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    $('#taskInput').focus({ preventScroll: true });
    announce(`Новая задача на ${new Date(iso + 'T12:00:00').toLocaleDateString('ru')}`);
  },
});

// ---------- отрисовка ----------

function render(change) {
  renderBoard({ ...filters, animate: change?.type === 'move' || change?.type === 'update' });
  renderDashboard();
  if (!change) calendar.render(filters);
}

store.subscribe(render);

// ---------- удаление с отменой ----------

function deleteTasks(ids, label) {
  const removed = store.remove(ids);
  if (!removed.length) return;
  clearTimeout(undo?.timer);
  undo = { removed, timer: setTimeout(hideToast, 6000) };
  $('#toastText').textContent = label || 'Задача удалена';
  const toast = $('#toast');
  toast.hidden = false;
  toast.style.animation = 'none';
  void toast.offsetWidth;
  toast.style.animation = '';
}

function restore() {
  if (!undo) return;
  store.restore(undo.removed);
  hideToast();
}

function hideToast() {
  clearTimeout(undo?.timer);
  undo = null;
  $('#toast').hidden = true;
}

$('#toastUndo').addEventListener('click', restore);

function announce(text) {
  const a = $('#announcer');
  a.textContent = '';
  setTimeout(() => (a.textContent = text), 30);
}

// ---------- ввод ----------

const form = $('#composer');
const input = $('#taskInput');
const preview = $('#parsePreview');

input.addEventListener('input', () => {
  const p = parseQuick(input.value);
  const chips = [];
  if (p.tag) chips.push(`<span class="chip tag-${p.tag}">${store.TAGS[p.tag]}</span>`);
  if (p.priority) chips.push(`<span class="pchip"><i class="flag p-${p.priority}"></i>${store.PRIORITIES[p.priority]}</span>`);
  if (p.due) chips.push(`<span class="due" data-state="${dueInfo(p.due).state}">${dueInfo(p.due).label}</span>`);
  preview.innerHTML = chips.length ? `<span class="pv-label">Распознано:</span>${chips.join('')}` : '';
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const p = parseQuick(input.value);
  if (!p.text) {
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
    input.focus();
    return;
  }
  const task = store.add({
    text: p.text,
    tag: p.tag || form.querySelector('input[name="tag"]:checked').value,
    priority: p.priority || form.querySelector('input[name="prio"]:checked').value,
    due: p.due || $('#dueInput').value || null,
    status: 'todo',
  });
  input.value = '';
  $('#dueInput').value = '';
  preview.innerHTML = '';
  announce(`Добавлено: ${task.text}`);
  // Если фильтр прячет новую задачу — сбрасываем его
  if ((filters.tag !== 'all' && filters.tag !== task.tag) || filters.query) {
    setTag('all');
    $('#search').value = filters.query = '';
    render();
  }
});

// ---------- фильтры ----------

function setTag(tag) {
  filters.tag = tag;
  document.querySelectorAll('#tagFilter .pill').forEach((p) => {
    const on = p.dataset.tag === tag;
    p.classList.toggle('is-active', on);
    p.setAttribute('aria-pressed', on);
  });
}

$('#tagFilter').addEventListener('click', (e) => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  setTag(pill.dataset.tag);
  renderBoard(filters);
  calendar.render(filters);
});

$('#search').addEventListener('input', (e) => {
  filters.query = e.target.value;
  renderBoard(filters);
  calendar.render(filters);
});

function setLayout(layout) {
  if (!['board', 'list', 'calendar'].includes(layout)) layout = 'board';
  $('#board').classList.toggle('is-list', layout === 'list');
  $('#board').hidden = layout === 'calendar';
  calendar.render(filters);
  calendar.setVisible(layout === 'calendar');
  $('.work-area .hint').hidden = layout === 'calendar';
  document.querySelectorAll('[data-layout]').forEach((button) => {
    const active = button.dataset.layout === layout;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
document.querySelectorAll('[data-layout]').forEach((button) => button.addEventListener('click', () => {
  setLayout(button.dataset.layout);
  try { localStorage.setItem('digitaltodo.layout', button.dataset.layout); } catch {}
}));
try { setLayout(localStorage.getItem('digitaltodo.layout') || 'board'); } catch {}

// ---------- тема ----------

$('#themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]').content = next === 'light' ? '#eaf4ff' : '#182940';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
});

// ---------- горячие клавиши ----------

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#search').focus();
    $('#search').select();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undo && !typing) {
    e.preventDefault();
    restore();
  } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === 'т' || e.key === '/')) {
    e.preventDefault();
    input.focus();
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (e.key === 'Escape' && e.target.id === 'search') {
    e.target.value = filters.query = '';
    renderBoard(filters);
    calendar.render(filters);
  }
});

// ---------- 3D-сцена ----------

const sceneEl = $('#scene');
const expandScene = $('#expandScene');
function setSceneExpanded(expanded) {
  sceneEl.classList.toggle('is-expanded', expanded);
  document.body.classList.toggle('scene-expanded', expanded);
  expandScene.setAttribute('aria-expanded', expanded);
  expandScene.setAttribute('aria-label', expanded ? 'Свернуть 3D-обзор' : 'Развернуть 3D-обзор');
  if (expanded) {
    sceneEl.setAttribute('aria-modal', 'true');
    sceneEl.setAttribute('role', 'dialog');
    sceneEl.setAttribute('aria-label', '3D-обзор задач');
  } else {
    sceneEl.removeAttribute('aria-modal');
    sceneEl.removeAttribute('role');
    sceneEl.removeAttribute('aria-label');
  }
  document.querySelectorAll('.topbar, .work-area, .work-aside > :not(.scene), .footer, #digitalPal').forEach((el) => { el.inert = expanded; });
  expandScene.focus({ preventScroll: true });
}
expandScene.addEventListener('click', () => setSceneExpanded(!sceneEl.classList.contains('is-expanded')));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sceneEl.classList.contains('is-expanded')) setSceneExpanded(false);
  if (e.key === 'Tab' && sceneEl.classList.contains('is-expanded')) {
    const buttons = [...sceneEl.querySelectorAll('button:not([disabled])')];
    const first = buttons[0], last = buttons.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

async function loadScene() {
  if (scene || sceneLoading || compactScreen.matches) return;
  sceneLoading = true;
  try {
    await introReady;
    await document.fonts.ready;
    const { createScene } = await import('./scene3d.js');
    scene = createScene(sceneEl, { onOpen: openDrawer });
    sceneEl.classList.add('is-ready');
  } catch (err) {
    console.warn('3D не загрузился:', err);
    sceneEl.querySelector('.scene-fallback').hidden = false;
    sceneEl.classList.add('is-failed');
  } finally {
    sceneLoading = false;
  }
}
compactScreen.addEventListener('change', () => {
  if (compactScreen.matches && sceneEl.classList.contains('is-expanded')) setSceneExpanded(false);
  if (!compactScreen.matches) loadScene();
});

// ---------- запуск ----------

$('#today').textContent = new Date().toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });

initBoard({
  onOpen: openDrawer,
  onDelete: (id) => deleteTasks([id]),
  onHover: (id) => scene?.highlight(id),
  onCancel: () => renderBoard(filters),
  announce,
});
initDrawer({ onDelete: (id) => deleteTasks([id]) });
initDashboard({ onOpen: openDrawer });
render();
initAssistant();
initTaskEffects();
initReminders();
loadScene();

// Относительные сроки («сегодня», «завтра») пересчитываем раз в минуту
setInterval(() => render(), 60_000);

export { closeDrawer };
