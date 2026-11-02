import * as store from './store.js';

const TOKEN_KEY = 'digitaltodo.telegram.session';
const SCHEDULE_KEY = 'digitaltodo.telegram.reminders';
function endpoint() {
  const explicit = document.querySelector('meta[name="telegram-endpoint"]')?.content.trim();
  let value = explicit || document.querySelector('meta[name="assistant-endpoint"]')?.content.trim();
  if (!value && ['localhost', '127.0.0.1'].includes(location.hostname)) value = 'http://127.0.0.1:8787/api/assistant';
  if (!value) return null;
  try {
    const url = new URL(value, location.href);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    url.pathname = explicit ? url.pathname.replace(/\/$/, '') : url.pathname.replace(/\/assistant\/?$/, '/telegram');
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return null; }
}
const localValue = timestamp => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const defaultTime = task => {
  const due = task.due ? new Date(task.due + 'T09:00:00').getTime() : 0;
  return due > Date.now() ? due : Date.now() + 30 * 60_000;
};

export function initReminders({ mount = document.querySelector('.toolbar-right') } = {}) {
  if (!mount || document.querySelector('.telegram-settings')) return;
  const base = endpoint();
  let token = null;
  let selected = {};
  try { token = localStorage.getItem(TOKEN_KEY); selected = JSON.parse(localStorage.getItem(SCHEDULE_KEY) || '{}'); } catch {}
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) selected = {};
  let draft = { ...selected };
  let connected = false;
  let configured = false;
  let pairing = null;
  let poll = null;
  let syncTimer = null;
  let syncQueue = Promise.resolve();
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'btn-ghost telegram-settings';
  trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 18-7-4 16-6-5-4 3 1-6 9-5-6 8"/></svg><span>Telegram-напоминания</span>';
  mount.append(trigger);
  const dialog = document.createElement('dialog');
  dialog.className = 'telegram-dialog';
  dialog.setAttribute('aria-labelledby', 'telegram-heading');
  dialog.innerHTML = '<div class="telegram-head"><div><h2 id="telegram-heading">Напоминания в Telegram</h2><p>Выберите, о чём и когда напомнить.</p></div><button type="button" class="icon-btn telegram-close" aria-label="Закрыть напоминания">×</button></div><p class="telegram-state" role="status">Проверяем подключение…</p><div class="telegram-pair"><button type="button" class="btn-primary small telegram-connect">Подключить Telegram</button><a class="telegram-link" hidden target="_blank" rel="noopener noreferrer">Открыть бота в Telegram</a><button type="button" class="btn-ghost telegram-disconnect" hidden>Отключить</button></div><p class="telegram-privacy">На сервер отправляются только названия выбранных задач и время напоминаний. Заметки остаются в браузере.</p><form class="telegram-form"><div class="telegram-tasks"></div><div class="telegram-foot"><p>Выполненные и удалённые задачи снимаются с напоминаний, пока сайт открыт.</p><button type="submit" class="btn-primary small telegram-save">Сохранить</button></div></form>';
  document.body.appendChild(dialog);
  const state = dialog.querySelector('.telegram-state');
  const connect = dialog.querySelector('.telegram-connect');
  const disconnect = dialog.querySelector('.telegram-disconnect');
  const link = dialog.querySelector('.telegram-link');
  const list = dialog.querySelector('.telegram-tasks');
  const save = dialog.querySelector('.telegram-save');
  const persist = () => { try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(selected)); } catch {} };
  async function api(path, value) {
    if (!base) throw new Error('unconfigured');
    const response = await fetch(base + path, { method: value === undefined ? 'GET' : 'POST',
      headers: { ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(12_000) });
    if (response.status === 401) { token = null; connected = false; try { localStorage.removeItem(TOKEN_KEY); } catch {} }
    if (!response.ok) throw new Error('unavailable');
    return response.json();
  }
  function paint() {
    connect.hidden = connected;
    connect.disabled = !configured;
    disconnect.hidden = !connected;
    save.disabled = !connected;
    trigger.classList.toggle('is-connected', connected);
    list.replaceChildren();
    const tasks = store.all().filter(task => task.status !== 'done').slice(0, 40);
    if (!tasks.length) { const empty = document.createElement('p'); empty.textContent = 'Все задачи выполнены. Добавьте новое дело, чтобы поставить напоминание.'; list.appendChild(empty); }
    tasks.forEach(task => {
      const row = document.createElement('div'); row.className = 'telegram-task';
      const label = document.createElement('label');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = Boolean(draft[task.id]); checkbox.disabled = !connected;
      const title = document.createElement('span'); title.textContent = task.text;
      label.append(checkbox, title);
      const time = document.createElement('input'); time.type = 'datetime-local'; time.className = 'input'; time.value = localValue(draft[task.id] || defaultTime(task));
      time.min = localValue(Date.now() + 60_000); time.disabled = !connected || !checkbox.checked; time.setAttribute('aria-label', `Когда напомнить: ${task.text}`);
      checkbox.addEventListener('change', () => { time.disabled = !checkbox.checked; if (checkbox.checked) draft[task.id] = new Date(time.value).getTime(); else delete draft[task.id]; });
      time.addEventListener('change', () => { if (checkbox.checked) draft[task.id] = new Date(time.value).getTime(); });
      row.append(label, time); list.appendChild(row);
    });
  }
  async function refresh() {
    try {
      const status = await api('/status');
      configured = status.configured; connected = status.connected;
      if (!configured) state.textContent = 'Telegram ещё не подключён к сайту. Уведомления станут доступны после настройки.';
      else if (connected) {
        const failed = status.reminders.filter(item => item.state === 'failed' || item.state === 'sending').length;
        let selectionChanged = false;
        status.reminders.forEach(item => {
          if (item.state === 'sent' || item.state === 'sending') {
            // Do not retain stale date inputs or resubmit a delivery already attempted.
            if (selected[item.id] === item.at) { delete selected[item.id]; selectionChanged = true; }
            if (draft[item.id] === item.at) delete draft[item.id];
          } else if (item.state === 'failed' && draft[item.id] === item.at && item.at <= Date.now()) {
            const task = store.get(item.id);
            if (task) draft[item.id] = defaultTime(task);
          }
        });
        if (selectionChanged) persist();
        state.textContent = failed ? 'Telegram подключён. Некоторые напоминания не удалось доставить — выберите для них новое время.' : 'Telegram подключён. Напоминания придут в ваш личный чат с ботом.';
        link.hidden = true; clearTimeout(poll); pairing = null;
      } else state.textContent = status.awaitingCommand ? 'Ссылка подтверждена. Отправьте боту команду /todo, чтобы включить напоминания.' : status.pending ? 'Откройте бота по ссылке, нажмите «Запустить», затем отправьте /todo.' : 'Подключите свой Telegram и разрешите боту отправлять напоминания.';
      paint();
      if (pairing && !connected && Date.now() < pairing.expiresAt) poll = setTimeout(refresh, 3000);
      else if (pairing && !connected) { link.hidden = true; pairing = null; state.textContent = 'Ссылка истекла. Подключите Telegram ещё раз.'; }
    } catch { state.textContent = base ? 'Сейчас не получается связаться с напоминаниями. Попробуйте позже.' : 'Telegram ещё не подключён к сайту. Ваши задачи продолжают работать.'; configured = false; paint(); }
  }
  function remindersFor(selection) {
    // Keep existing due-but-not-yet-delivered reminders until the server scheduler claims them.
    // New reminder times are validated as future dates in the explicit Save flow.
    return store.all().filter(task => task.status !== 'done' && Number.isSafeInteger(selection[task.id]))
      .map(task => ({ id: task.id, title: task.text, at: selection[task.id] }));
  }
  function sync(selection = selected) {
    const snapshot = { ...selection };
    const request = syncQueue.catch(() => {}).then(async () => {
      if (!connected) throw new Error('not_connected');
      const reminders = remindersFor(snapshot);
      await api('/reminders', { reminders });
      selected = Object.fromEntries(reminders.map(reminder => [reminder.id, reminder.at])); persist();
      return reminders.length;
    });
    syncQueue = request;
    return request;
  }
  trigger.addEventListener('click', () => { draft = { ...selected }; dialog.showModal(); paint(); void refresh(); });
  dialog.querySelector('.telegram-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  connect.addEventListener('click', async () => {
    connect.disabled = true;
    try {
      pairing = await api('/link', {}); token = pairing.clientToken;
      try { localStorage.setItem(TOKEN_KEY, token); } catch {}
      link.href = pairing.linkUrl; link.hidden = false;
      state.textContent = 'Откройте Telegram по ссылке, нажмите «Запустить», затем отправьте /todo. Ссылка действует 5 минут.';
      clearTimeout(poll); poll = setTimeout(refresh, 2000);
    } catch { state.textContent = 'Подключение пока недоступно. Попробуйте позже.'; }
    finally { connect.disabled = !configured; }
  });
  disconnect.addEventListener('click', async () => {
    disconnect.disabled = true;
    try { await api('/disconnect', {}); token = null; connected = false; selected = {}; draft = {}; persist(); try { localStorage.removeItem(TOKEN_KEY); } catch {} state.textContent = 'Telegram отключён. Запланированные напоминания удалены.'; paint(); }
    catch { state.textContent = 'Не удалось отключить Telegram. Повторите попытку.'; }
    finally { disconnect.disabled = false; }
  });
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const activeIds = new Set(store.all().filter(task => task.status !== 'done').map(task => task.id));
    if (Object.entries(draft).some(([id, at]) => activeIds.has(id) && (!Number.isSafeInteger(at) || at <= Date.now()))) { state.textContent = 'Выберите будущее время для каждого отмеченного напоминания.'; return; }
    save.disabled = true;
    try { const count = await sync(draft); state.textContent = count ? `Сохранено напоминаний: ${count}. Они придут в Telegram в выбранное время.` : 'Все напоминания сняты.'; draft = { ...selected }; paint(); }
    catch { state.textContent = 'Не удалось сохранить. Проверьте подключение и повторите попытку.'; }
    finally { save.disabled = !connected; }
  });
  store.subscribe(() => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { if (connected && Object.keys(selected).length) void sync().catch(() => { if (dialog.open) state.textContent = 'Не удалось обновить напоминания. Откройте настройки и сохраните их ещё раз.'; }); }, 1000);
  });
  // Restore connection without sending task data; sync only an existing explicit selection.
  if (token) void refresh().then(() => { if (connected && Object.keys(selected).length) void sync().catch(() => {}); });
  return { open: () => trigger.click() };
}
