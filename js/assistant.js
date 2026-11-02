import * as store from './store.js';
import { dueInfo } from './parse.js';
import { readAssistantResponse } from './assistant-stream.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const GUIDE = `Я Диди — помощник Digital To-Do. Помогу разобраться с задачами.\n\n• Добавьте задачу в поле «Что сделаем дальше?». Можно написать «Сдать отчёт #работа ! завтра»: метка, приоритет и срок определятся автоматически.\n• Переносите карточки между колонками или выберите статус в карточке задачи.\n• В «Запланировано» нажмите стрелку «Взять в работу»: задача перейдёт в колонку «В работе». Галочка в «В работе» завершает задачу. Нажатие на карточку открывает детали, подзадачи и заметки.\n• Удаление можно отменить через уведомление или Ctrl+Z.\n• Поиск — Ctrl+K. Новая задача — N.\n• В виде «Календарь» нажмите плюс у даты, чтобы создать задачу с нужным сроком.\n• Напоминания: «Telegram-напоминания», затем перейдите в личный чат, нажмите Start и отправьте /todo. После подключения выберите задачи и время.\n\nСпросите: «Сколько осталось?», «Что важнее?» или «Что просрочено?».`;

function plural(n, one, few, many) {
  return n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
}

export function taskContext(tasks = store.all()) {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const nextDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  const done = tasks.filter(t => t.status === 'done');
  const active = tasks.filter(t => t.status !== 'done');
  return {
    today: date,
    stats: {
      total: tasks.length, done: done.length, remaining: active.length,
      doneToday: done.filter(t => t.doneAt >= dayStart && t.doneAt < nextDay).length,
      doing: active.filter(t => t.status === 'doing').length,
      planned: active.filter(t => t.status === 'todo').length,
      overdue: active.filter(t => t.due && t.due < date).length,
      progress: tasks.length ? Math.round(done.length / tasks.length * 100) : 0,
    },
    // Notes and links are deliberately excluded from the model context.
    tasks: tasks.slice(0, 100).map(t => ({
      title: t.text, status: t.status, priority: t.priority, tag: t.tag, due: t.due,
      subtasks: { total: t.subtasks.length, done: t.subtasks.filter(s => s.done).length },
    })),
  };
}

export function localAnswer(question, tasks = store.all()) {
  const q = question.toLowerCase().replace(/ё/g, 'е');
  const context = taskContext(tasks);
  const { stats, today } = context;
  const active = tasks.filter(t => t.status !== 'done');
  const lines = list => list.slice(0, 5).map((t, i) => `${i + 1}. ${t.text}${t.due ? ` — ${dueInfo(t.due)?.label || t.due}` : ''}${t.priority === 'high' ? ' · высокий приоритет' : ''}`).join('\n');
  if (/гайд|пользовать|помощ|инструкц|календар|телеграм|telegram|напомин|как .*добав|как .*удал|как .*перен|как .*работ/.test(q)) return GUIDE;
  if (/сегодня/.test(q) && /сдела|выполн|закры|готов/.test(q)) {
    const dayStart = new Date(today + 'T00:00:00').getTime();
    const next = new Date(today + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    const completed = tasks.filter(t => t.status === 'done' && t.doneAt >= dayStart && t.doneAt < next.getTime());
    return completed.length ? `Сегодня выполнено ${completed.length} ${plural(completed.length, 'задача', 'задачи', 'задач')}.\n\n${lines(completed)}\n\nВсего выполнено: ${stats.done} из ${stats.total}.` : 'Сегодня завершённых задач пока нет. Выберите одно небольшое дело и отметьте его после выполнения.';
  }
  if (/срок|просроч|дедлайн|сегодня|завтра/.test(q)) {
    const overdue = active.filter(t => t.due && t.due < today).sort((a, b) => a.due.localeCompare(b.due));
    const upcoming = active.filter(t => t.due && t.due >= today).sort((a, b) => a.due.localeCompare(b.due));
    if (/сегодня|завтра/.test(q)) {
      const offset = /послезавтра/.test(q) ? 2 : /завтра/.test(q) ? 1 : 0;
      const selectedDate = new Date(today + 'T12:00:00');
      selectedDate.setDate(selectedDate.getDate() + offset);
      const iso = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
      const selected = active.filter(t => t.due === iso);
      const dayLabel = offset === 2 ? 'послезавтра' : offset ? 'завтра' : 'сегодня';
      return (selected.length ? `На ${dayLabel}: ${selected.length} ${plural(selected.length, 'задача', 'задачи', 'задач')}.\n\n${lines(selected)}` : `На ${dayLabel} нет активных задач со сроком.`) + (!offset && overdue.length ? `\n\nЕщё ${overdue.length} ${plural(overdue.length, 'задача просрочена', 'задачи просрочены', 'задач просрочено')} — можно пересмотреть их сроки.` : '');
    }
    if (/просроч/.test(q)) return overdue.length ? `Просрочено: ${overdue.length}.\n\n${lines(overdue)}` : 'Просроченных задач нет.';
    const sections = [];
    if (overdue.length) sections.push(`Просрочено: ${overdue.length}. Сначала проверьте эти задачи:\n${lines(overdue)}`);
    if (upcoming.length) sections.push(`Ближайшие сроки:\n${lines(upcoming)}`);
    return sections.join('\n\n') || 'У активных задач пока нет сроков. Откройте карточку и укажите дату — я помогу следить за ближайшими делами.';
  }
  if (/важн|приоритет|начать|перв|рекомен|дальше|план|фокус/.test(q)) {
    const ranks = { high: 0, med: 1, low: 2 };
    const scored = [...active].sort((a, b) => {
      const urgent = t => t.due && t.due < today ? 0 : t.due === today ? 1 : 2;
      return urgent(a) - urgent(b) || ranks[a.priority] - ranks[b.priority] || (a.due || '9999').localeCompare(b.due || '9999');
    });
    if (!scored.length) return 'Все задачи выполнены. Можно отдохнуть или записать следующее дело.';
    return `Предлагаю начать с «${scored[0].text}». Я учитываю просрочки, сегодняшний срок и приоритет.\n\n${lines(scored)}\n\nВозьмите одно дело за раз — так проще сохранить фокус.`;
  }
  if (/сдела|выполн|прогресс|остал|сколько|статист|итог|обзор|работе/.test(q)) {
    if (!stats.total) return 'Список пока пуст. Добавьте первую задачу — и я покажу прогресс. Можно также загрузить демо-данные для знакомства с сайтом.';
    return `Всего: ${stats.total}. Выполнено: ${stats.done} (${stats.progress}%).\n\nОсталось ${stats.remaining} ${plural(stats.remaining, 'задача', 'задачи', 'задач')}: ${stats.doing} в работе и ${stats.planned} запланировано.${stats.overdue ? `\nТребуют внимания: ${stats.overdue} ${plural(stats.overdue, 'просроченная задача', 'просроченные задачи', 'просроченных задач')}.` : '\nПросроченных задач нет.'}\n\n${stats.progress === 100 ? 'Всё готово. Отличная работа!' : 'Спросите «Что важнее?», и я предложу следующее дело.'}`;
  }
  const matches = active.filter(t => q.split(/\s+/).some(w => w.length > 3 && t.text.toLowerCase().includes(w)));
  if (matches.length) return `Нашёл в ваших задачах:\n${lines(matches)}\n\nОткройте карточку, чтобы посмотреть детали.`;
  if (/привет|здравств|кто ты|^диди[!?.\s]*$/.test(q)) return `Привет! Я Диди. Помогаю разобраться с задачами и освоить Digital To-Do. Сейчас у вас ${stats.remaining} ${plural(stats.remaining, 'активная задача', 'активные задачи', 'активных задач')}.\n\nМогу показать прогресс, важные дела, сроки или объяснить, как пользоваться сайтом.`;
  return 'Я помогаю разбираться с задачами: считаю прогресс, нахожу важные дела и сроки, помогаю освоить сайт. Свободный диалог появится после подключения AI.\n\nПопробуйте «Сколько осталось?», «Что важнее?» или «Как пользоваться?».';
}

function endpointFromPage() {
  let value = document.querySelector('meta[name="assistant-endpoint"]')?.content.trim();
  // Local dev: talk to `npm start` in server/ when no public endpoint is set.
  if (!value && ['localhost', '127.0.0.1'].includes(location.hostname)) value = 'http://127.0.0.1:8787/api/assistant';
  if (!value) return null;
  try {
    const url = new URL(value, location.href);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return url.href;
  } catch { return null; }
}

// Deterministic observations: never send background activity to the model.
export function reactionForChange(change, previous, tasks) {
  const done = tasks.filter(t => t.status === 'done').length;
  const left = tasks.length - done;
  if ((change.type === 'move' || change.type === 'update') && change.to === 'done' && change.from !== 'done') {
    return { state: 'happy', text: done === tasks.length && tasks.length ? `Всё готово! ${done} ${plural(done, 'задача выполнена', 'задачи выполнены', 'задач выполнено')}. Отличная работа!` : `Ещё одно дело готово. Уже ${done} из ${tasks.length}!` };
  }
  if (change.type === 'add') return { state: 'wave', text: change.ids?.length === 1 ? 'Записал. Начнём с одного шага?' : 'Список пополнился. Помогу выбрать главное.' };
  if (change.type === 'remove') return { state: 'attentive', text: `Список обновлён. Осталось ${left} ${plural(left, 'дело', 'дела', 'дел')}.` };
  if (change.type === 'update') {
    const edited = tasks.find(t => change.ids?.includes(t.id));
    const before = edited && previous.get(edited.id);
    if (before && (before.priority !== edited.priority || before.due !== edited.due)) return { state: 'thinking', then: 'attentive', text: 'Учёл новый приоритет и сроки. Держим важное в фокусе.' };
  }
  if (change.type === 'move' && change.to === 'doing' && change.from !== 'doing') return { state: 'attentive', text: 'Взяли в работу. Одно дело за раз — хороший ритм.' };
  return null;
}

const robot = `<svg class="pal-robot" viewBox="0 0 100 112" aria-hidden="true">
  <defs>
    <linearGradient id="pal-shell" x2=".8" y2="1"><stop stop-color="#d4ecff"/><stop offset=".45" stop-color="#88bdf8"/><stop offset="1" stop-color="#4e8be1"/></linearGradient>
    <linearGradient id="pal-belly" x2=".7" y2="1"><stop stop-color="#f7fbff"/><stop offset="1" stop-color="#c5defb"/></linearGradient>
    <linearGradient id="pal-face" x2=".5" y2="1"><stop stop-color="#254c81"/><stop offset="1" stop-color="#142d52"/></linearGradient>
  </defs>
  <ellipse class="pal-shadow" cx="50" cy="104" rx="28" ry="5" fill="#466b9d" opacity=".18"/>
  <g class="pal-character">
    <g class="pal-antenna"><path d="M50 16V9" stroke="#659be2" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="7" r="5" fill="#f6ce68"/></g>
    <g class="pal-arm pal-arm-left"><rect x="7" y="59" width="14" height="28" rx="7" fill="url(#pal-shell)"/></g>
    <g class="pal-arm pal-arm-right"><rect x="79" y="59" width="14" height="28" rx="7" fill="url(#pal-shell)"/></g>
    <rect class="pal-foot pal-foot-left" x="26" y="91" width="19" height="12" rx="6" fill="#548cda"/>
    <rect class="pal-foot pal-foot-right" x="55" y="91" width="19" height="12" rx="6" fill="#548cda"/>
    <rect x="22" y="61" width="56" height="36" rx="18" fill="url(#pal-shell)" stroke="#e5f3ff" stroke-width="1.5"/>
    <rect x="32" y="67" width="36" height="24" rx="11" fill="url(#pal-belly)"/>
    <path d="m43 79 5 5 10-11" fill="none" stroke="#4f93d9" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="pal-head"><rect x="13" y="16" width="74" height="53" rx="22" fill="url(#pal-shell)" stroke="#e5f3ff" stroke-width="1.5"/>
    <rect x="23" y="27" width="54" height="29" rx="13" fill="url(#pal-face)"/>
    <g class="pal-eyes"><rect x="35" y="35" width="7" height="11" rx="3.5" fill="#d0f2ff"/><rect x="58" y="35" width="7" height="11" rx="3.5" fill="#d0f2ff"/></g>
    <path class="pal-smile" d="M46 48q4 3 8 0" fill="none" stroke="#a9e3ff" stroke-width="2" stroke-linecap="round"/>
    <circle cx="20" cy="45" r="3" fill="#accfff"/><circle cx="80" cy="45" r="3" fill="#accfff"/>
    <path d="M30 23q12-6 26-3" fill="none" stroke="#f1faff" stroke-width="3" stroke-linecap="round" opacity=".7"/></g>
  </g>
</svg>`;

export function initAssistant() {
  if (document.getElementById('digitalPal')) return;
  const endpoint = endpointFromPage();
  const host = document.createElement('section');
  host.id = 'digitalPal';
  host.className = 'digital-pal';
  host.dataset.state = 'idle';
  host.setAttribute('aria-label', 'Диди — помощник по задачам');
  host.innerHTML = `<div class="pal-observation" role="status" aria-live="polite" hidden></div><button class="pal-launcher" type="button" aria-label="Открыть помощника Диди" aria-expanded="false" aria-controls="palPanel">${robot}<span class="pal-name">Диди</span></button>
    <section class="pal-panel" id="palPanel" role="dialog" aria-labelledby="palTitle" hidden>
      <header class="pal-header"><div><h2 id="palTitle">Диди <span>помощник по задачам</span></h2><p class="pal-mode"></p></div><div class="pal-header-actions"><button type="button" class="pal-close" aria-label="Закрыть помощника"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></header>
      <div class="pal-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
      <div class="pal-suggestions" aria-label="Вопросы помощнику"><button type="button" data-question="Сколько задач осталось?">Мой прогресс</button><button type="button" data-question="Какие задачи важнее?">Что важнее?</button><button type="button" data-question="Какие ближайшие сроки?">Сроки</button><button type="button" data-question="Как пользоваться сайтом?">Гид по сайту</button></div>
      <nav class="pal-guide" aria-label="Перейти к разделу сайта" hidden><button type="button" data-tour="new">Новая задача</button><button type="button" data-tour="board">Показать доску</button><button type="button" data-tour="stats">Статистика</button><button type="button" data-tour="calendar">Календарь</button></nav>
      <form class="pal-form"><label class="sr-only" for="palQuestion">Вопрос помощнику</label><input id="palQuestion" maxlength="1000" placeholder="Спросите про свои задачи…" autocomplete="off"><button type="submit" aria-label="Отправить вопрос"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-5 14-2-7-7 0zM12 12l7-7"/></svg></button></form>
      <p class="pal-privacy"></p>
    </section>`;
  document.body.append(host);
  const launcher = host.querySelector('.pal-launcher');
  const panel = host.querySelector('.pal-panel');
  const log = host.querySelector('.pal-messages');
  const input = host.querySelector('#palQuestion');
  const form = host.querySelector('.pal-form');
  const submit = form.querySelector('button');
  const mode = host.querySelector('.pal-mode');
  let pending = false;
  let open = false;
  let requestController = null;
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'pal-stop';
  stop.setAttribute('aria-label', 'Остановить ответ');
  stop.textContent = '■';
  stop.hidden = true;
  form.append(stop);
  stop.addEventListener('click', () => requestController?.abort('user'));
  let emotionTimer;
  let bubbleTimer;
  let attentiveTimer;
  let observationTimer;
  let typingUntil = 0;
  let lastBubbleAt = -Infinity;
  const observation = host.querySelector('.pal-observation');
  const history = [];
  mode.textContent = endpoint ? 'Помощник по задачам · AI подключается' : 'Помощник по задачам · на устройстве';
  host.querySelector('.pal-privacy').textContent = endpoint ? 'Для ответа AI получает вопрос и список задач. Заметки не передаются.' : 'Ответы по вашим задачам. Данные остаются в браузере.';

  function addMessage(text, who = 'assistant') {
    const item = document.createElement('div');
    item.className = `pal-message pal-message-${who}`;
    const label = document.createElement('strong');
    label.className = 'pal-message-label';
    label.textContent = who === 'user' ? 'Вы' : 'Диди';
    const body = document.createElement('p');
    body.textContent = text;
    item.append(label, body);
    log.append(item);
    // Bound the visible log as well as the remote conversation history.
    while (log.children.length > 40) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
    return body;
  }

  function emotion(state, duration = 1800) {
    clearTimeout(emotionTimer);
    clearTimeout(attentiveTimer);
    host.dataset.state = state;
    emotionTimer = setTimeout(() => { host.dataset.state = 'idle'; }, duration);
  }

  function toggle(value) {
    open = value;
    observation.hidden = true;
    panel.hidden = !open;
    host.classList.toggle('pal-open', open);
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? 'Свернуть помощника Диди' : 'Открыть помощника Диди');
    if (open) { emotion('wave'); input.focus({ preventScroll: true }); }
    else launcher.focus({ preventScroll: true });
  }
  launcher.addEventListener('click', () => toggle(!open));
  host.querySelector('.pal-close').addEventListener('click', () => toggle(false));
  host.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { e.stopPropagation(); toggle(false); } });

  async function ask(question) {
    if (pending || !question.trim()) return;
    question = question.trim().slice(0, 1000);
    host.querySelector('.pal-guide').hidden = !/гайд|пользовать|помощ|инструкц|как .*работ/i.test(question);
    addMessage(question, 'user');
    input.value = '';
    pending = true;
    clearTimeout(emotionTimer);
    clearTimeout(attentiveTimer);
    submit.hidden = true;
    stop.hidden = false;
    form.setAttribute('aria-busy', 'true');
    host.dataset.state = 'thinking';
    const body = addMessage(endpoint ? 'Диди думает' : '');
    body.classList.add('pal-loading');
    body.parentElement.setAttribute('aria-busy', 'true');
    let answer = '', paintTarget = '', painted = '', paintFrame = null, timeout;
    requestController = new AbortController();
    const controller = requestController;
    const pinned = () => log.scrollHeight - log.scrollTop - log.clientHeight < 90;
    function write(text) {
      const follow = pinned();
      body.textContent = text;
      if (follow) log.scrollTop = log.scrollHeight;
    }
    function paint() {
      paintFrame = null;
      const count = reducedMotion ? paintTarget.length : Math.max(2, Math.min(20, Math.ceil((paintTarget.length - painted.length) / 5)));
      painted = paintTarget.slice(0, painted.length + count);
      write(painted);
      if (painted.length < paintTarget.length) paintFrame = requestAnimationFrame(paint);
    }
    function receive(text) {
      answer = text;
      paintTarget = text;
      body.classList.remove('pal-loading');
      body.classList.add('pal-streaming');
      host.dataset.state = 'speaking';
      if (paintFrame === null) paintFrame = requestAnimationFrame(paint);
    }
    try {
      if (endpoint) {
        timeout = setTimeout(() => controller.abort('timeout'), 25000);
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'omit', signal: controller.signal,
          body: JSON.stringify({ stream: true, question, context: taskContext(), history: history.slice(-6) }),
        });
        const result = await readAssistantResponse(response, receive);
        answer = result.answer;
        if (result.truncated) answer += '\n\nМожно уточнить вопрос, чтобы продолжить ответ.';
        mode.textContent = 'Помощник по задачам · с AI';
      } else {
        answer = localAnswer(question);
        receive(answer);
      }
    } catch (error) {
      const partial = error.partialAnswer || answer;
      if (controller.signal.reason === 'user') {
        answer = partial ? partial + '\n\nОтвет остановлен.' : 'Ответ остановлен.';
      } else if (partial.trim()) {
        answer = partial + '\n\nСвязь прервалась. Можно повторить вопрос.';
      } else {
        answer = 'Сейчас отвечу по вашим задачам на устройстве.\n\n' + localAnswer(question);
        mode.textContent = 'Помощник по задачам · на устройстве';
      }
    } finally {
      clearTimeout(timeout);
      cancelAnimationFrame(paintFrame);
      body.classList.remove('pal-loading', 'pal-streaming');
      write(answer);
      body.parentElement.removeAttribute('aria-busy');
      history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
      if (history.length > 8) history.splice(0, history.length - 8);
      pending = false;
      requestController = null;
      submit.hidden = false;
      stop.hidden = true;
      form.removeAttribute('aria-busy');
      emotion('speaking', 1800);
    }
  }
  form.addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  host.querySelector('.pal-suggestions').addEventListener('click', e => {
    const button = e.target.closest('[data-question]');
    if (button) ask(button.dataset.question);
  });
  host.querySelector('.pal-guide').addEventListener('click', e => {
    const action = e.target.closest('[data-tour]')?.dataset.tour;
    const targets = { new: '#composer', board: '#board', stats: '.insights', calendar: '#calendar' };
    if (!targets[action]) return;
    if (action === 'board' || action === 'calendar') document.querySelector('[data-layout="' + action + '"]')?.click();
    const target = document.querySelector(targets[action]);
    if (!target) return;
    toggle(false);
    target.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'center' });
    target.classList.add('pal-tour-target');
    setTimeout(() => target.classList.remove('pal-tour-target'), 2600);
    if (action === 'new') document.getElementById('taskInput')?.focus({ preventScroll: true });
    const announcer = document.getElementById('announcer');
    if (announcer) announcer.textContent = { new: 'Поле новой задачи', board: 'Доска задач', stats: 'Статистика задач', calendar: 'Календарь задач' }[action];
  });
  addMessage('Привет! Я Диди. Помогу выбрать следующее дело, посчитать прогресс и разобраться с сайтом. С чего начнём?');
  const snapshot = () => new Map(store.all().map(t => [t.id, { priority: t.priority, due: t.due }]));
  let previous = snapshot();
  const hideObservation = () => { observation.hidden = true; clearTimeout(bubbleTimer); };
  document.addEventListener('focusin', e => { if (e.target.closest('input, textarea, [contenteditable]')) hideObservation(); });
  document.addEventListener('input', e => {
    if (!e.target.closest('input, textarea, [contenteditable]')) return;
    typingUntil = Date.now() + 1000;
    hideObservation();
  });
  new MutationObserver(() => { if (document.body.classList.contains('is-dragging')) hideObservation(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  store.subscribe(change => {
    const reaction = reactionForChange(change, previous, store.all());
    previous = snapshot();
    if (!reaction || pending) return;
    clearTimeout(attentiveTimer);
    emotion(reaction.state, reaction.then ? 2400 : 1800);
    if (reaction.then) attentiveTimer = setTimeout(() => { host.dataset.state = reaction.then; }, 850);
    clearTimeout(observationTimer);
    // Let the submit/drop interaction finish before commenting; never interrupt typing.
    observationTimer = setTimeout(() => {
      const typing = document.activeElement?.closest('input, textarea, [contenteditable]') && Date.now() < typingUntil;
      if (open || typing || document.body.classList.contains('is-dragging') || Date.now() - lastBubbleAt < 12000) return;
      lastBubbleAt = Date.now();
      observation.textContent = reaction.text;
      observation.hidden = false;
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(hideObservation, 4000);
    }, Date.now() < typingUntil ? 1300 : 350);
  });
  if (!reducedMotion && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let frame = null;
    let pointerX = 0;
    let pointerY = 0;
    document.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || document.hidden) return;
      pointerX = e.clientX; pointerY = e.clientY;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const r = launcher.getBoundingClientRect();
        const x = Math.max(-1, Math.min(1, (pointerX - r.left - r.width / 2) / 350));
        const y = Math.max(-1, Math.min(1, (pointerY - r.top - r.height / 2) / 300));
        host.style.setProperty('--pal-gaze-x', `${x * 2}px`);
        host.style.setProperty('--pal-gaze-y', `${y * 1.5}px`);
        host.style.setProperty('--pal-head-tilt', `${x * 2}deg`);
      });
    }, { passive: true });
    document.addEventListener('pointerleave', () => { host.style.setProperty('--pal-gaze-x', '0px'); host.style.setProperty('--pal-gaze-y', '0px'); host.style.setProperty('--pal-head-tilt', '0deg'); });
  }
  return { open: () => toggle(true), close: () => toggle(false), ask };
}
