// Дашборд: прогресс, KPI, активность за неделю, метки, ближайшие сроки, 3D-наклон карточек.

import * as store from './store.js';
import { dueInfo } from './parse.js';

const $ = (s) => document.querySelector(s);
const TAG_COLOR_VARS = { work: 'var(--cyan)', home: 'var(--violet)', study: 'var(--orange)', urgent: 'var(--pink)' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initDashboard({ onOpen }) {
  initTilt();
  $('#deadlines').addEventListener('click', (e) => {
    const li = e.target.closest('[data-id]');
    if (li) onOpen(li.dataset.id);
  });
}

export function renderDashboard() {
  const tasks = store.all();
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const doing = tasks.filter((t) => t.status === 'doing').length;
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const doneToday = tasks.filter((t) => t.status === 'done' && t.doneAt >= startOfDay).length;
  const overdue = tasks.filter((t) => t.status !== 'done' && dueInfo(t.due)?.state === 'overdue').length;

  // Прогресс
  const pct = total ? Math.round((done / total) * 100) : 0;
  countTo($('#progressPct'), pct);
  $('#progressBar').style.width = pct + '%';
  $('#progressNote').textContent = `${done} из ${total}`;
  $('#progressSub').textContent =
    total === 0 ? 'Добавьте первую задачу' : pct === 100 ? 'Всё сделано. Отличная работа!' : `Осталось ${total - done} ${plural(total - done, 'задача', 'задачи', 'задач')}`;

  // KPI
  countTo(document.querySelector('[data-kpi="all"]'), total);
  countTo(document.querySelector('[data-kpi="doing"]'), doing);
  countTo(document.querySelector('[data-kpi="today"]'), doneToday);
  countTo(document.querySelector('[data-kpi="overdue"]'), overdue);
  document.querySelector('.kpi.tone-pink').classList.toggle('alert', overdue > 0);

  renderBars(tasks);
  renderDonut(tasks);
  renderDeadlines(tasks);
}

// ---------- активность за 7 дней ----------
function renderBars(tasks) {
  const days = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const start = new Date(base);
    start.setDate(base.getDate() - i);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const count = tasks.filter((t) => t.doneAt && t.doneAt >= start && t.doneAt < end).length;
    days.push({ start, count, today: i === 0 });
  }
  const max = Math.max(3, ...days.map((d) => d.count));
  const sum = days.reduce((a, d) => a + d.count, 0);
  $('#weekTotal').textContent = `${sum} ${plural(sum, 'задача', 'задачи', 'задач')} закрыто`;

  const wrap = $('#bars');
  if (wrap.children.length !== 7) {
    wrap.innerHTML = '';
    days.forEach(() => {
      const col = document.createElement('div');
      col.className = 'bar-col';
      col.innerHTML = '<span class="bar-val"></span><div class="bar-track"><span class="bar-fill"></span></div><span class="bar-day"></span>';
      wrap.appendChild(col);
    });
  }
  days.forEach((d, i) => {
    const col = wrap.children[i];
    col.classList.toggle('is-today', d.today);
    col.querySelector('.bar-val').textContent = d.count || '';
    col.querySelector('.bar-fill').style.height = `${(d.count / max) * 100}%`;
    col.querySelector('.bar-day').textContent = d.today ? 'сег' : d.start.toLocaleDateString('ru', { weekday: 'short' });
    col.title = `${d.start.toLocaleDateString('ru', { day: 'numeric', month: 'long' })}: ${d.count}`;
  });
}

// ---------- кольцевая диаграмма по меткам ----------
function renderDonut(tasks) {
  const active = tasks.filter((t) => t.status !== 'done');
  const counts = Object.keys(store.TAGS).map((tag) => ({ tag, n: active.filter((t) => t.tag === tag).length }));
  const total = active.length;
  $('#donutTotal').textContent = total;

  const svg = $('#donut');
  const r = 46;
  const C = 2 * Math.PI * r;
  const gap = total > 1 ? 3 : 0;
  let offset = 0;
  svg.innerHTML = `<circle cx="60" cy="60" r="${r}" class="donut-track"/>`;
  counts.forEach(({ tag, n }) => {
    if (!n) return;
    const len = (n / total) * C;
    const seg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    seg.setAttribute('cx', 60);
    seg.setAttribute('cy', 60);
    seg.setAttribute('r', r);
    seg.setAttribute('class', 'donut-seg');
    seg.style.stroke = TAG_COLOR_VARS[tag];
    seg.style.strokeDasharray = `${Math.max(len - gap, 0.1)} ${C}`;
    seg.style.strokeDashoffset = -offset;
    svg.appendChild(seg);
    offset += len;
  });

  $('#legend').innerHTML = counts
    .map(({ tag, n }) => `<li><i class="dot tag-${tag}"></i>${store.TAGS[tag]}<b>${n}</b></li>`)
    .join('');
}

// ---------- ближайшие сроки ----------
function renderDeadlines(tasks) {
  const list = tasks
    .filter((t) => t.due && t.status !== 'done')
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 4);
  const ul = $('#deadlines');
  ul.textContent = '';
  if (!list.length) {
    ul.innerHTML = '<li class="dl-empty">Сроков нет. Добавьте дату к задаче</li>';
    return;
  }
  list.forEach((t) => {
    const info = dueInfo(t.due);
    const li = document.createElement('li');
    li.dataset.id = t.id;
    li.tabIndex = 0;
    li.className = 'dl-item';
    li.innerHTML = '<i class="dot"></i><span class="dl-text"></span><span class="due"></span>';
    li.querySelector('.dot').classList.add('tag-' + t.tag);
    li.querySelector('.dl-text').textContent = t.text;
    const due = li.querySelector('.due');
    due.textContent = info.label;
    due.dataset.state = info.state;
    li.addEventListener('keydown', (e) => e.key === 'Enter' && li.click());
    ul.appendChild(li);
  });
}

// ---------- счётчики ----------
function countTo(el, value) {
  if (!el) return;
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = value;
  if (from === value || reduceMotion) {
    el.textContent = value;
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const k = Math.min((now - start) / 600, 1);
    el.textContent = Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

// ---------- 3D-наклон карточек с бликом ----------
function initTilt() {
  if (reduceMotion || matchMedia('(hover: none)').matches) return;
  document.querySelectorAll('.tilt').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--rx', `${(0.5 - y) * 10}deg`);
      el.style.setProperty('--ry', `${(x - 0.5) * 12}deg`);
      el.style.setProperty('--gx', `${x * 100}%`);
      el.style.setProperty('--gy', `${y * 100}%`);
      el.classList.add('is-tilting');
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.classList.remove('is-tilting');
    });
  });
}

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
