(() => {
  'use strict';

  const STORAGE_KEY = 'taskflow.tasks.v1';
  const THEME_KEY = 'taskflow.theme';
  const TAGS = {
    work: 'Работа',
    home: 'Личное',
    study: 'Учёба',
    urgent: 'Срочно',
  };
  const SPARK_COLORS = ['#c8ff3d', '#2ee6ff', '#9b6bff', '#ff4fa3', '#ff8a3d'];
  const RING_LENGTH = 2 * Math.PI * 50;

  const $ = (sel) => document.querySelector(sel);
  const els = {
    form: $('#composer'),
    input: $('#taskInput'),
    list: $('#list'),
    tpl: $('#itemTpl'),
    empty: $('#empty'),
    emptyTitle: $('#emptyTitle'),
    emptySub: $('#emptySub'),
    pills: document.querySelectorAll('.pill'),
    clearDone: $('#clearDone'),
    ringBar: $('#ringBar'),
    ringPct: $('#ringPct'),
    ring: $('#ring'),
    heroSub: $('#heroSub'),
    statAll: $('#statAll'),
    statActive: $('#statActive'),
    statDone: $('#statDone'),
    cntAll: $('#cntAll'),
    cntActive: $('#cntActive'),
    cntDone: $('#cntDone'),
    toast: $('#toast'),
    toastText: $('#toastText'),
    toastUndo: $('#toastUndo'),
    themeBtn: $('#themeBtn'),
    today: $('#today'),
  };

  let tasks = load();
  let filter = 'all';
  let undo = null; // { items: [{task, index}], timer }

  // ---------- хранение ----------

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(raw)) return [];
      return raw.filter((t) => t && typeof t.text === 'string' && t.id);
    } catch {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // приватный режим или переполнение: работаем без сохранения
    }
  }

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // ---------- действия ----------

  function addTask(text, tag) {
    tasks.unshift({ id: uid(), text, tag, done: false, createdAt: Date.now() });
    save();
    render();
  }

  function toggleTask(id, sourceEl) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.done = !task.done;
    task.doneAt = task.done ? Date.now() : null;
    save();
    if (task.done && sourceEl) burst(sourceEl);
    render();
  }

  function editTask(id, text) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.text = text;
    save();
    render();
  }

  function removeTasks(ids, label) {
    const removed = [];
    tasks.forEach((task, index) => {
      if (ids.includes(task.id)) removed.push({ task, index });
    });
    if (!removed.length) return;

    const finish = () => {
      tasks = tasks.filter((t) => !ids.includes(t.id));
      save();
      render();
      showUndo(removed, label);
    };

    const nodes = ids.map((id) => els.list.querySelector(`[data-id="${id}"]`)).filter(Boolean);
    if (nodes.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((n) => n.classList.add('leaving'));
      setTimeout(finish, 280);
    } else {
      finish();
    }
  }

  function restore() {
    if (!undo) return;
    undo.items
      .sort((a, b) => a.index - b.index)
      .forEach(({ task, index }) => tasks.splice(Math.min(index, tasks.length), 0, task));
    save();
    hideToast();
    render();
  }

  // ---------- уведомление с отменой ----------

  function showUndo(items, label) {
    clearTimeout(undo?.timer);
    undo = { items, timer: setTimeout(hideToast, 5000) };
    els.toastText.textContent = label;
    els.toast.hidden = false;
    // перезапуск анимации появления
    els.toast.style.animation = 'none';
    void els.toast.offsetWidth;
    els.toast.style.animation = '';
  }

  function hideToast() {
    clearTimeout(undo?.timer);
    undo = null;
    els.toast.hidden = true;
  }

  // ---------- отрисовка ----------

  function render() {
    const done = tasks.filter((t) => t.done).length;
    const total = tasks.length;
    const active = total - done;

    setCount(els.statAll, total);
    setCount(els.statActive, active);
    setCount(els.statDone, done);
    els.cntAll.textContent = total;
    els.cntActive.textContent = active;
    els.cntDone.textContent = done;
    els.clearDone.disabled = done === 0;

    const pct = total ? Math.round((done / total) * 100) : 0;
    els.ringBar.style.strokeDashoffset = RING_LENGTH * (1 - pct / 100);
    els.ringBar.style.opacity = pct ? 1 : 0;
    els.ringPct.textContent = pct + '%';
    els.ring.setAttribute('aria-label', `Прогресс ${pct}%`);
    els.heroSub.textContent = heroText(total, active);

    const visible = tasks.filter((t) => (filter === 'all' ? true : filter === 'done' ? t.done : !t.done));

    // Переиспользуем нарисованные элементы и двигаем только те, что стоят не на месте:
    // перенос узла в DOM перезапускает его анимацию появления
    const visibleIds = new Set(visible.map((t) => t.id));
    const existing = new Map();
    [...els.list.children].forEach((li) => {
      if (visibleIds.has(li.dataset.id)) existing.set(li.dataset.id, li);
      else li.remove();
    });
    visible.forEach((task, i) => {
      const li = existing.get(task.id) || createItem(task);
      updateItem(li, task);
      const current = els.list.children[i];
      if (current !== li) els.list.insertBefore(li, current || null);
    });

    const empty = visible.length === 0;
    els.empty.hidden = !empty;
    if (empty) {
      const [title, sub] =
        total === 0
          ? ['Пока пусто', 'Добавьте первую задачу в поле выше.']
          : filter === 'done'
            ? ['Ещё ничего не готово', 'Отметьте задачу, и она появится здесь.']
            : ['Всё сделано!', 'Активных задач нет. Можно отдохнуть.'];
      els.emptyTitle.textContent = title;
      els.emptySub.textContent = sub;
    }
  }

  function createItem(task) {
    const li = els.tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = task.id;
    return li;
  }

  function updateItem(li, task) {
    li.classList.toggle('done', task.done);
    const box = li.querySelector('input[type="checkbox"]');
    box.checked = task.done;
    box.setAttribute('aria-label', task.done ? `Вернуть в работу: ${task.text}` : `Отметить выполненной: ${task.text}`);

    const text = li.querySelector('.item-text');
    if (!li.querySelector('.edit-input')) text.textContent = task.text;

    const chip = li.querySelector('.chip');
    const tag = TAGS[task.tag] ? task.tag : 'work';
    chip.className = 'chip tag-' + tag;
    chip.textContent = TAGS[tag];

    const time = li.querySelector('time');
    const stamp = task.done && task.doneAt ? task.doneAt : task.createdAt;
    time.dateTime = new Date(stamp).toISOString();
    time.textContent = (task.done ? 'выполнено ' : '') + relTime(stamp);

    li.querySelector('.del').setAttribute('aria-label', `Удалить: ${task.text}`);
  }

  function setCount(el, value) {
    if (el.textContent === String(value)) return;
    el.textContent = value;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function heroText(total, active) {
    if (total === 0) return 'Запишите, что нужно сделать, и отмечайте по ходу дня.';
    if (active === 0) return 'Все задачи выполнены. Отличная работа!';
    return `Осталось ${active} ${plural(active, 'задача', 'задачи', 'задач')} из ${total}.`;
  }

  function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
  function relTime(ts) {
    const sec = Math.round((ts - Date.now()) / 1000);
    if (Math.abs(sec) < 45) return 'только что';
    const min = Math.round(sec / 60);
    if (Math.abs(min) < 60) return rtf.format(min, 'minute');
    const hr = Math.round(min / 60);
    if (Math.abs(hr) < 24) return rtf.format(hr, 'hour');
    const day = Math.round(hr / 24);
    if (Math.abs(day) < 7) return rtf.format(day, 'day');
    return new Date(ts).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
  }

  // ---------- редактирование ----------

  function startEdit(li) {
    const id = li.dataset.id;
    const task = tasks.find((t) => t.id === id);
    const text = li.querySelector('.item-text');
    if (!task || li.querySelector('.edit-input')) return;

    const input = document.createElement('input');
    input.className = 'edit-input';
    input.maxLength = 200;
    input.value = task.text;
    input.setAttribute('aria-label', 'Изменить задачу');
    text.hidden = true;
    text.after(input);
    input.focus();
    input.select();

    let closed = false;
    const close = (commit) => {
      if (closed) return;
      closed = true;
      const value = input.value.trim();
      input.remove();
      text.hidden = false;
      if (commit && value && value !== task.text) editTask(id, value);
      else render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(true);
      if (e.key === 'Escape') close(false);
    });
    input.addEventListener('blur', () => close(true));
  }

  // ---------- искры ----------

  function burst(el) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
      s.style.left = cx - 3 + 'px';
      s.style.top = cy - 3 + 'px';
      document.body.appendChild(s);
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      const dist = 26 + Math.random() * 26;
      s.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0)`, opacity: 0 },
        ],
        { duration: 550 + Math.random() * 200, easing: 'cubic-bezier(.2,.8,.2,1)' },
      ).onfinish = () => s.remove();
    }
  }

  // ---------- тема ----------

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]').content = next === 'light' ? '#f4f4f8' : '#05050a';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  }

  // ---------- события ----------

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text) {
      els.form.classList.remove('shake');
      void els.form.offsetWidth;
      els.form.classList.add('shake');
      els.input.focus();
      return;
    }
    const tag = els.form.querySelector('input[name="tag"]:checked')?.value || 'work';
    if (filter === 'done') setFilter('all');
    addTask(text, tag);
    els.input.value = '';
    els.input.focus();
  });

  els.list.addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) {
      const li = e.target.closest('.item');
      toggleTask(li.dataset.id, li.querySelector('.box'));
    }
  });

  els.list.addEventListener('click', (e) => {
    const del = e.target.closest('.del');
    if (del) {
      const li = del.closest('.item');
      removeTasks([li.dataset.id], 'Задача удалена');
    }
  });

  els.list.addEventListener('dblclick', (e) => {
    const body = e.target.closest('.item-body');
    if (body) startEdit(body.closest('.item'));
  });

  function setFilter(next) {
    filter = next;
    els.pills.forEach((p) => {
      const on = p.dataset.filter === next;
      p.classList.toggle('is-active', on);
      p.setAttribute('aria-selected', on);
    });
    render();
  }
  els.pills.forEach((p) => p.addEventListener('click', () => setFilter(p.dataset.filter)));

  els.clearDone.addEventListener('click', () => {
    const ids = tasks.filter((t) => t.done).map((t) => t.id);
    removeTasks(ids, `Удалено готовых: ${ids.length}`);
  });

  els.toastUndo.addEventListener('click', restore);
  els.themeBtn.addEventListener('click', toggleTheme);

  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest('input, textarea, [contenteditable]');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      els.input.focus();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undo && !typing) {
      e.preventDefault();
      restore();
    }
  });

  // синхронизация между вкладками
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      tasks = load();
      render();
    }
  });

  // относительное время обновляем раз в минуту
  setInterval(render, 60_000);

  const todayText = new Date().toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });
  els.today.textContent = todayText;

  render();
})();
