// Builds compositions/app.html from the template and the site's captured DOM,
// and inlines the site fonts into every composition. Re-run after changing the
// template; then run measure-ui.mjs and sync-didi.mjs.
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const write = (p, s) => fs.writeFileSync(new URL(`../${p}`, import.meta.url), s);
const must = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`Anchor not found: ${a.slice(0, 60)}`);
  return s.replace(a, b);
};
const alts = (ids, values) => values.map((v, i) =>
  `<span id="${ids[i]}" class="a-alt${i ? ' a-off' : ''}">${v}</span>`).join('');

let app = read('scripts/src/app-dom.html');
app = must(app, 'src="favicon.svg"', 'src="assets/site/favicon.svg"');
app = must(app, 'placeholder="Например, подготовить презентацию #работа завтра"', 'placeholder=""');
app = must(app, '<div class="parse-preview" id="parsePreview" aria-live="polite"></div>',
  '<div class="parse-preview" id="parsePreview" aria-live="polite">' +
  '<span class="pv-label a-off" id="a-pv-label">Распознано:</span>' +
  '<span class="chip tag-work a-off" id="a-pv-tag">Работа</span>' +
  '<span class="pchip a-off" id="a-pv-prio"><i class="flag p-high"></i>Высокий</span>' +
  '<span class="due a-off" data-state="soon" id="a-pv-due">Завтра</span></div>');
app = must(app, '<span class="count" data-count="todo">6</span>', `<span class="count" data-count="todo">${alts(['a-todo-6', 'a-todo-7'], [6, 7])}</span>`);
app = must(app, '<span class="count" data-count="doing">4</span>', `<span class="count" data-count="doing">${alts(['a-doing-4', 'a-doing-5'], [4, 5])}</span>`);
app = must(app, '<span class="count" data-count="done">8</span>', `<span class="count" data-count="done">${alts(['a-done-8', 'a-done-9'], [8, 9])}</span>`);
app = must(app, '<strong data-kpi="all" data-value="18">18</strong>', `<strong data-kpi="all">${alts(['a-all-18', 'a-all-19'], [18, 19])}</strong>`);
app = must(app, '<strong data-kpi="doing" data-value="4">4</strong>', `<strong data-kpi="doing">${alts(['a-kd-4', 'a-kd-5'], [4, 5])}</strong>`);
app = must(app, '<strong data-kpi="today" data-value="2">2</strong>', `<strong data-kpi="today">${alts(['a-done-2', 'a-done-3'], [2, 3])}</strong>`);
app = must(app, '<span id="progressPct" data-value="44">44</span>', `<span id="progressPct">${alts(['a-pct-44', 'a-pct-42', 'a-pct-43', 'a-pct-44b', 'a-pct-45', 'a-pct-46', 'a-pct-47'], [44, 42, 43, 44, 45, 46, 47])}</span>`);
app = must(app, '<span class="label" id="progressNote">8 из 18</span>', `<span class="label" id="progressNote">${alts(['a-note-818', 'a-note-819', 'a-note-919'], ['8 из 18', '8 из 19', '9 из 19'])}</span>`);
app = must(app, '<p class="progress-sub" id="progressSub">Осталось 10 задач</p>', `<p class="progress-sub" id="progressSub"><span class="a-grid">${alts(['a-sub-10', 'a-sub-11', 'a-sub-10b'], ['Осталось 10 задач', 'Осталось 11 задач', 'Осталось 10 задач'])}</span></p>`);

// Toolbar from the current site: Доска/Список/Календарь and «Ещё» with Telegram.
{
  let bar = read('scripts/src/toolbar-dom.html');
  const vs = bar.match(/<div class="view-switch"[\s\S]*?<\/div>/)[0];
  const asBoard = vs.replace(' is-active', '').replace('data-layout="board" aria-pressed="false"', 'data-layout="board" aria-pressed="true"')
    .replace('class="view-button" type="button" data-layout="board"', 'class="view-button is-active" type="button" data-layout="board"');
  bar = bar.replace(vs, `<span class="a-grid"><span id="a-vs-board" class="a-alt">${asBoard}</span><span id="a-vs-cal" class="a-alt a-off">${vs}</span></span>`);
  bar = must(bar, '<details class="board-actions">', '<details class="board-actions" open>');
  bar = must(bar, 'class="board-actions-menu"', 'class="board-actions-menu a-off" id="a-menu"');
  const a = app.indexOf('<div class="toolbar">'), b = app.indexOf('<section class="board"');
  app = app.slice(0, a) + bar + app.slice(b);
  // The calendar view lies over the board and takes over when «Календарь» is clicked.
  const boardEnd = app.indexOf('</section>', app.indexOf('<section class="board"')) + '</section>'.length;
  const cal = read('scripts/src/calendar-dom.html').replace('<section id="calendar" class="calendar card"', '<section id="calendar" class="calendar card a-off"');
  app = app.slice(0, boardEnd) + cal + app.slice(boardEnd);
}
app = must(app, '<div class="scene-canvas">',
  '<div id="a-3d-box"><img src="assets/ui/world3d-poster.jpg" alt="" />' +
  '</div>' +
  '<div class="scene-canvas">');

// The new task, in each state the site would draw it.
const card = (id, { status, done = false, checked = false }) => `
  <li id="${id}" class="card-item${done ? ' done' : ''}" data-status="${status}" style="--c: var(--tag-work);">
    <span class="ci-accent" aria-hidden="true"></span>
    <div class="ci-top">
      <button class="ci-start" type="button"${status === 'todo' ? '' : ' hidden'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg></button>
      <label class="check"${status === 'todo' ? ' hidden' : ''}><input type="checkbox" tabindex="-1"${checked ? ' checked' : ''}><span class="box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg></span></label>
      <p class="ci-text">Сдать отчёт</p>
      <i class="flag p-high" aria-hidden="true"></i>
    </div>
    <div class="ci-meta">
      <span class="chip tag-work">Работа</span>
      <span class="due" data-state="soon"${done ? ' hidden' : ''}>Завтра</span>
    </div>
  </li>`;
const overlay = `<div id="a-card" data-layout-ignore>${card('a-v-todo', { status: 'todo' })}${card('a-v-doing', { status: 'doing' })}${card('a-v-checked', { status: 'doing', checked: true })}${card('a-v-done', { status: 'done', done: true, checked: true })}</div>`;
const aside = app.indexOf('<aside class="work-aside"');
const close = app.lastIndexOf('</div>', aside);
app = app.slice(0, close) + overlay + app.slice(close);

const typed = 'Сдать отчёт #работа ! завтра';
const extras = `<span id="a-ph">Например, подготовить презентацию #работа завтра</span>` +
  `<span id="a-typed">${[...typed].map((ch) => `<span class="ch a-off">${ch}</span>`).join('')}</span>`;

let pal = read('scripts/src/pal-dom.html');
pal = pal.replace(/<svg class="pal-robot"[\s\S]*?<\/svg>/, '<!--didi:a-didi-svg--><!--/didi-->');
pal = must(pal, 'Помощник по задачам · AI подключается', 'Помощник по задачам · с AI');
const answer = 'Осталось 10 задач. Начните с «Разобрать входящие письма» — срок был вчера. Потом «Проверить мобильную версию»: она на сегодня.';
const msgs = `<div class="pal-message pal-message-user a-off" id="a-msg-user"><strong class="pal-message-label">Вы</strong><p>Какие задачи важнее?</p></div>` +
  `<div class="pal-message pal-message-assistant a-off" id="a-msg-answer"><strong class="pal-message-label">Диди</strong><div class="a-stack">` +
  `<p id="a-pending">Смотрю ваши задачи…</p><p id="a-answer">${answer.split(' ').map((w) => `<span class="w a-off">${w} </span>`).join('')}</p></div></div>`;
pal = must(pal, 'С чего начнём?</p></div>', `С чего начнём?</p></div>${msgs}`);
pal = pal.replace(/ hidden=""/g, (m, i) => (pal.slice(i - 60, i).includes('pal-guide') || pal.slice(i - 60, i).includes('pal-observation') ? m : ''));

let tg = read('scripts/src/telegram-dom.html');
tg = must(tg, '<dialog class="telegram-dialog"', '<dialog id="a-tg" class="telegram-dialog"');
tg = tg.replace(/<input type="datetime-local" class="input"[^>]*value="([^"]+)"[^>]*>/g, (m, v) => {
  const [d, t] = v.split('T'); const [y, mo, da] = d.split('-');
  return `<span class="input a-dt">${da}.${mo}.${y} ${t}</span>`;
});
tg = tg.replace(/<p class="telegram-state" role="status">([^<]*)<\/p>/, (m, text) =>
  `<p class="telegram-state" role="status"><span class="a-grid"><span id="a-tg-st1" class="a-alt">${text}</span><span id="a-tg-st2" class="a-alt a-off">Сохранено напоминаний: 1. Они придут в Telegram в выбранное время.</span></span></p>`);
{
  const i = tg.indexOf('<div class="telegram-task">'), j = tg.indexOf('<div class="telegram-task">', i + 10);
  const row = tg.slice(i, j);
  const off = row.replace(' checked=""', '').replace('class="input a-dt"', 'class="input a-dt a-dis"');
  tg = tg.slice(0, i) + `<div class="a-grid a-tg-row"><div id="a-tg-rowA" class="a-alt">${off}</div><div id="a-tg-rowB" class="a-alt a-off">${row}</div></div>` + tg.slice(j);
}

let tpl = read('scripts/app.template.html');
tpl = must(tpl, '<!--FROZEN_TG-->', tg);
tpl = must(tpl, '<!--FROZEN_APP-->', app + extras);
tpl = must(tpl, '<!--FROZEN_PAL-->', pal);
write('compositions/app.html', tpl);

// Fonts: the site's Manrope and Nunito with Cyrillic, inlined where used.
const fonts = read('assets/fonts.css').replaceAll('url("fonts/', 'url("assets/fonts/');
for (const f of ['index.html', 'compositions/chaos.html', 'compositions/app.html', 'compositions/endcard.html']) {
  const s = read(f).replace(/\/\*FONTS\*\/[\s\S]*?(\/\*\/FONTS\*\/|$)/m, (m) => m);
  const out = s.replace(/\/\*FONTS\*\/(?:[\s\S]*?\/\*\/FONTS\*\/)?/, `/*FONTS*/${fonts}/*/FONTS*/`);
  write(f, out);
}
console.log('app.html built; fonts inlined.');
