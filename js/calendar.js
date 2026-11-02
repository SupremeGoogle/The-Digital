import * as store from './store.js';

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const agendaFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

const isoDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return isoDate(date) === value ? date : null;
}

// Local noon avoids UTC date shifts and DST gaps. Monday is always the first cell.
export function calendarCells(year, month) {
  const first = new Date(year, month, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), 1 - offset + index, 12);
    return { date, iso: isoDate(date), day: date.getDate(), inMonth: date.getMonth() === first.getMonth() };
  });
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(className, text, label) {
  const node = make('button', className, text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}
function plural(n) {
  return n % 10 === 1 && n % 100 !== 11 ? 'задача' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'задачи' : 'задач';
}

export function initCalendar({ onOpen, onAddDate } = {}) {
  const host = document.getElementById('calendar');
  if (!host) return { render() {}, setVisible() {}, destroy() {} };
  if (host.calendarController) return host.calendarController;

  let view = new Date();
  view = new Date(view.getFullYear(), view.getMonth(), 1, 12);
  let selected = isoDate(new Date());
  let filters = { query: '', tag: 'all' };
  const header = make('div', 'cal-header');
  const heading = make('div', 'cal-heading');
  const title = make('h2', 'cal-month');
  const summary = make('p', 'cal-summary');
  title.id = 'calendarMonth';
  heading.append(title, summary);
  const controls = make('div', 'cal-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Выбор месяца');
  const previous = button('cal-nav', '', 'Предыдущий месяц');
  previous.dataset.calendarNav = '-1';
  previous.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>';
  const todayButton = button('cal-today', 'Сегодня');
  todayButton.dataset.calendarToday = '';
  const next = button('cal-nav', '', 'Следующий месяц');
  next.dataset.calendarNav = '1';
  next.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>';
  controls.append(previous, todayButton, next);
  header.append(heading, controls);
  const week = make('div', 'cal-weekdays');
  week.setAttribute('aria-hidden', 'true');
  weekdays.forEach(day => week.appendChild(make('span', '', day)));
  const grid = make('div', 'cal-grid');
  grid.setAttribute('aria-labelledby', 'calendarMonth');
  const agenda = make('div', 'cal-agenda');
  const agendaHead = make('div', 'cal-agenda-head');
  const agendaTitle = make('h3', 'cal-agenda-title');
  agendaTitle.id = 'calendarDay';
  const add = button('cal-add-selected', '+ Добавить задачу');
  add.dataset.calendarAddSelected = '';
  agendaHead.append(agendaTitle, add);
  const agendaList = make('ul', 'cal-agenda-list');
  agendaList.setAttribute('aria-labelledby', 'calendarDay');
  const footnote = make('p', 'cal-footnote');
  agenda.append(agendaHead, agendaList);
  host.append(header, week, grid, agenda, footnote);

  function filteredTasks() {
    const query = String(filters.query || '').trim().toLowerCase();
    return store.all().filter(task =>
      (filters.tag === 'all' || task.tag === filters.tag) &&
      (!query || task.text.toLowerCase().includes(query) || task.notes.toLowerCase().includes(query) || task.subtasks.some(sub => sub.text.toLowerCase().includes(query)))
    );
  }

  function render(nextFilters) {
    if (nextFilters) filters = { ...filters, ...nextFilters };
    const focusedDate = host.contains(document.activeElement) ? document.activeElement.dataset.calendarDate : null;
    const today = isoDate(new Date());
    const tasks = filteredTasks();
    const byDate = new Map();
    let undated = 0;
    tasks.forEach(task => {
      if (!parseDate(task.due)) { undated++; return; }
      if (!byDate.has(task.due)) byDate.set(task.due, []);
      byDate.get(task.due).push(task);
    });
    byDate.forEach(list => list.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || ({ high: 0, med: 1, low: 2 }[a.priority] - { high: 0, med: 1, low: 2 }[b.priority])));
    const prefix = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, '0')}`;
    const monthlyCount = tasks.filter(task => parseDate(task.due) && task.due.startsWith(prefix)).length;
    title.textContent = monthFormat.format(view).replace(/\s*г\.$/, '');
    summary.textContent = `${monthlyCount} ${plural(monthlyCount)} со сроком в этом месяце`;
    const fragment = document.createDocumentFragment();
    calendarCells(view.getFullYear(), view.getMonth()).forEach(cell => {
      const list = byDate.get(cell.iso) || [];
      const day = make('div', 'cal-day');
      day.dataset.day = cell.iso;
      day.classList.toggle('cal-outside', !cell.inMonth);
      day.classList.toggle('cal-is-today', cell.iso === today);
      day.classList.toggle('cal-selected', cell.iso === selected);
      day.classList.toggle('cal-weekend', cell.date.getDay() === 0 || cell.date.getDay() === 6);
      const dayHead = make('div', 'cal-day-head');
      const dateButton = button('cal-date', cell.day, `${dayFormat.format(cell.date)}. ${list.length} ${plural(list.length)}. Показать задачи`);
      dateButton.dataset.calendarDate = cell.iso;
      dateButton.setAttribute('aria-pressed', String(cell.iso === selected));
      if (cell.iso === today) dateButton.setAttribute('aria-current', 'date');
      const dayAdd = button('cal-day-add', '+', `Добавить задачу: ${dayFormat.format(cell.date)}`);
      dayAdd.dataset.calendarAdd = cell.iso;
      dayHead.append(dateButton, dayAdd);
      const chips = make('div', 'cal-day-tasks');
      list.slice(0, 2).forEach(task => {
        const chip = button(`cal-task cal-tag-${task.tag}${task.status === 'done' ? ' cal-task-done' : ''}`, '', `${task.text}. ${store.STATUS_LABELS[task.status]}. ${store.TAGS[task.tag]}`);
        chip.dataset.calendarTask = task.id;
        const icon = make('span', 'cal-task-dot', task.status === 'done' ? '✓' : '');
        icon.setAttribute('aria-hidden', 'true');
        chip.append(icon, make('span', 'cal-task-title', task.text));
        chips.appendChild(chip);
      });
      if (list.length > 2) {
        const more = button('cal-more', `+ ещё ${list.length - 2}`, `Показать все задачи: ${dayFormat.format(cell.date)}`);
        more.dataset.calendarDate = cell.iso;
        chips.appendChild(more);
      }
      const dots = make('div', 'cal-mobile-dots');
      dots.setAttribute('aria-hidden', 'true');
      list.slice(0, 3).forEach(task => dots.appendChild(make('i', `cal-tag-${task.tag}${task.status === 'done' ? ' cal-dot-done' : ''}`)));
      if (list.length > 3) dots.appendChild(make('span', '', '+'));
      day.append(dayHead, chips, dots);
      fragment.appendChild(day);
    });
    grid.replaceChildren(fragment);
    agendaTitle.textContent = agendaFormat.format(parseDate(selected));
    add.setAttribute('aria-label', `Добавить задачу: ${dayFormat.format(parseDate(selected))}`);
    const selectedTasks = byDate.get(selected) || [];
    const agendaFragment = document.createDocumentFragment();
    if (!selectedTasks.length) {
      const empty = make('li', 'cal-empty');
      empty.append(make('span', 'cal-empty-title', 'На этот день пока нет задач'), make('span', '', 'Выберите дату и добавьте первое дело.'));
      agendaFragment.appendChild(empty);
    }
    selectedTasks.forEach(task => {
      const row = make('li', `cal-agenda-item cal-tag-${task.tag}${task.status === 'done' ? ' cal-task-done' : ''}`);
      const open = button('cal-agenda-task', '', `Открыть задачу: ${task.text}`);
      open.dataset.calendarTask = task.id;
      const icon = make('span', `cal-agenda-status cal-status-${task.status}`, task.status === 'done' ? '✓' : task.status === 'doing' ? '◐' : '○');
      icon.setAttribute('aria-hidden', 'true');
      const info = make('span', 'cal-agenda-info');
      info.append(make('span', 'cal-agenda-task-name', task.text), make('span', 'cal-agenda-meta', `${store.STATUS_LABELS[task.status]} · ${store.TAGS[task.tag]}${task.priority === 'high' ? ' · Высокий приоритет' : ''}`));
      open.append(icon, info);
      row.appendChild(open);
      agendaFragment.appendChild(row);
    });
    agendaList.replaceChildren(agendaFragment);
    footnote.textContent = undated ? `${undated} ${plural(undated)} без даты — назначьте срок в карточке, чтобы увидеть их в календаре.` : 'Нажмите на дату, чтобы увидеть задачи. Кнопка «+» добавит задачу на выбранный день.';
    if (focusedDate) [...grid.querySelectorAll('.cal-date')].find(node => node.dataset.calendarDate === focusedDate)?.focus({ preventScroll: true });
  }

  function selectDate(iso) {
    const date = parseDate(iso);
    if (!date) return;
    selected = iso;
    view = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    render();
  }
  const click = event => {
    const task = event.target.closest('[data-calendar-task]');
    if (task) return onOpen?.(task.dataset.calendarTask);
    const addDay = event.target.closest('[data-calendar-add]');
    if (addDay) { const iso = addDay.dataset.calendarAdd; selectDate(iso); return onAddDate?.(iso); }
    if (event.target.closest('[data-calendar-add-selected]')) return onAddDate?.(selected);
    const day = event.target.closest('[data-calendar-date]');
    if (day) return selectDate(day.dataset.calendarDate);
    if (event.target.closest('[data-calendar-today]')) return selectDate(isoDate(new Date()));
    const nav = event.target.closest('[data-calendar-nav]');
    if (nav) {
      const nextMonth = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.calendarNav), 1, 12);
      const last = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0, 12).getDate();
      selectDate(isoDate(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(parseDate(selected).getDate(), last), 12)));
    }
  };
  host.addEventListener('click', click);
  const unsubscribe = store.subscribe(() => render());
  const controller = {
    render,
    setVisible(visible) { host.hidden = !visible; if (visible) render(); },
    destroy() { unsubscribe(); host.removeEventListener('click', click); host.replaceChildren(); delete host.calendarController; },
  };
  host.calendarController = controller;
  render();
  return controller;
}
