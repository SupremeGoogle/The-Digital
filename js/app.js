import * as store from './store.js';
import { parseQuick, dueInfo } from './parse.js';
import { initBoard, renderBoard } from './board.js';
import { initDrawer, open as openDrawer, close as closeDrawer } from './drawer.js';
import { initDashboard, renderDashboard, plural } from './dashboard.js';

const $ = (s) => document.querySelector(s);
const THEME_KEY = 'taskflow.theme';
const filters = { query: '', tag: 'all' };
let scene = null;
let undo = null;

// ---------- отрисовка ----------

function render(change) {
  renderBoard({ ...filters, animate: change?.type === 'move' || change?.type === 'update' });
  renderDashboard();
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
});

$('#search').addEventListener('input', (e) => {
  filters.query = e.target.value;
  renderBoard(filters);
});

$('#clearDone').addEventListener('click', () => {
  const ids = store.byStatus('done').map((t) => t.id);
  if (ids.length) deleteTasks(ids, `Удалено ${ids.length} ${plural(ids.length, 'готовая задача', 'готовые задачи', 'готовых задач')}`);
});

// ---------- тема ----------

$('#themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]').content = next === 'light' ? '#f4f4f8' : '#05050a';
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
  }
});

// ---------- 3D-сцена ----------

const sceneEl = $('#scene');

document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    scene?.setView(b.dataset.view);
    document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('is-active', x === b));
  }),
);
$('#rotateBtn').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', on);
  scene?.setAutoRotate(on);
});
$('#replayBtn').addEventListener('click', () => scene?.replay());

async function loadScene() {
  try {
    await document.fonts.ready;
    const { createScene } = await import('./scene3d.js');
    scene = createScene(sceneEl, { onOpen: openDrawer });
    sceneEl.classList.add('is-ready');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) $('#rotateBtn').setAttribute('aria-pressed', 'false');
  } catch (err) {
    console.warn('3D не загрузился:', err);
    sceneEl.querySelector('.scene-fallback').hidden = false;
    sceneEl.classList.add('is-failed');
  }
}

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
loadScene();

// Относительные сроки («сегодня», «завтра») пересчитываем раз в минуту
setInterval(() => render(), 60_000);

export { closeDrawer };
