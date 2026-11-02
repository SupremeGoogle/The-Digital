import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const hash = value => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const PAIR_TTL = 5 * 60_000;

/** Server-only Telegram transport; never exposes the bot token or chat identifier. */
export function createTelegramService(env = process.env, { fetchImpl = fetch, now = Date.now, background = true } = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || '';
  const configured = Boolean(token && !/REPLACE_|YOUR_|^</.test(token));
  const dbPath = env.REMINDERS_DB || join(homedir(), '.digital-todo', 'telegram-reminders.json');
  let db = { version: 1, offset: 0, sessions: {} };
  if (configured && existsSync(dbPath)) {
    const saved = JSON.parse(readFileSync(dbPath, 'utf8'));
    if (saved.version !== 1 || !saved.sessions || typeof saved.sessions !== 'object' || Array.isArray(saved.sessions)) throw new Error('Invalid reminders database');
    db = saved;
  }
  let username = null;
  let running = false;
  let timer = null;
  let ticking = false;
  const controllers = new Set();
  const rates = new Map();

  function persist() {
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    const temporary = `${dbPath}.next`;
    writeFileSync(temporary, JSON.stringify(db), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, dbPath);
    chmodSync(dbPath, 0o600);
  }
  async function telegram(method, data = {}, longPoll = false) {
    if (!configured) throw new Error('telegram_not_configured');
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), longPoll ? 28_000 : 10_000);
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error('telegram_unavailable');
      return result.result;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  async function identify() {
    if (username) return username;
    const bot = await telegram('getMe');
    if (!/^[A-Za-z0-9_]{5,32}$/.test(bot.username || '')) throw new Error('telegram_unavailable');
    username = bot.username;
    return username;
  }
  function credential(req) {
    const value = req.headers.authorization || '';
    return /^Bearer [A-Za-z0-9_-]{43}$/.test(value) ? value.slice(7) : null;
  }
  function authenticated(req) {
    const bearer = credential(req);
    return bearer ? db.sessions[hash(bearer)] : null;
  }
  function send(res, status, payload) {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(payload));
  }
  async function body(req) {
    let length = 0;
    const chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 24_000) throw new Error('body_too_large');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { throw new Error('invalid_json'); }
  }
  function rateAllowed(req, path) {
    const key = `${req.socket.remoteAddress || 'unknown'}:${path === '/api/telegram/link' ? 'link' : 'other'}`;
    const minute = Math.floor(now() / 60_000);
    const current = rates.get(key);
    const next = current?.minute === minute ? current : { minute, count: 0 };
    next.count++;
    rates.set(key, next);
    if (rates.size > 5000) for (const [k, entry] of rates) if (entry.minute < minute) rates.delete(k);
    return next.count <= (path === '/api/telegram/link' ? 5 : 80);
  }
  async function handle(req, res) {
    const path = (req.url || '').split('?')[0];
    if (!path.startsWith('/api/telegram/')) return false;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' });
      res.end();
      return true;
    }
    if (!rateAllowed(req, path)) { send(res, 429, { error: 'rate_limited' }); return true; }
    if (!['/api/telegram/status', '/api/telegram/link', '/api/telegram/reminders', '/api/telegram/disconnect'].includes(path)) { send(res, 404, { error: 'not_found' }); return true; }
    if (path === '/api/telegram/status' && req.method === 'GET') {
      const session = authenticated(req);
      if (req.headers.authorization && !session) { send(res, 401, { error: 'invalid_session' }); return true; }
      send(res, 200, { configured, ready: Boolean(username), connected: Boolean(session?.chatId),
        pending: Boolean(session?.pairExpires > now() && !session?.chatId),
        reminders: session?.reminders?.map(({ id, at, state }) => ({ id, at, state })) || [] });
      return true;
    }
    if (req.method !== 'POST') { send(res, 405, { error: 'method_not_allowed' }); return true; }
    if (!configured) { send(res, 503, { error: 'telegram_not_configured' }); return true; }
    try {
      if (path === '/api/telegram/link') {
        await body(req);
        const name = await identify();
        if (!running && background) void start();
        const existing = authenticated(req);
        if (existing?.chatId) { send(res, 409, { error: 'already_connected' }); return true; }
        for (const [key, session] of Object.entries(db.sessions)) if (!session.chatId && session.pairExpires < now()) delete db.sessions[key];
        if (Object.keys(db.sessions).length >= 1000) { send(res, 503, { error: 'capacity_reached' }); return true; }
        const bearer = existing ? credential(req) : opaque();
        const nonce = opaque();
        db.sessions[hash(bearer)] = { chatId: null, pairHash: hash(nonce), pairExpires: now() + PAIR_TTL, reminders: [] };
        persist();
        send(res, 200, { clientToken: bearer, linkUrl: `https://t.me/${name}?start=${nonce}`, expiresAt: now() + PAIR_TTL });
        return true;
      }
      const session = authenticated(req);
      if (!session) { send(res, 401, { error: 'invalid_session' }); return true; }
      if (path === '/api/telegram/disconnect') {
        await body(req);
        delete db.sessions[hash(credential(req))];
        persist(); send(res, 200, { disconnected: true }); return true;
      }
      if (!session.chatId) { send(res, 409, { error: 'not_connected' }); return true; }
      const value = await body(req);
      if (!Array.isArray(value.reminders) || value.reminders.length > 40) throw new Error('invalid_reminders');
      const ids = new Set();
      const previous = new Map(session.reminders.map(reminder => [reminder.id, reminder]));
      const reminders = value.reminders.map(reminder => {
        const old = previous.get(reminder?.id);
        const existingTime = old?.at === reminder?.at;
        if (!reminder || typeof reminder.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(reminder.id) || ids.has(reminder.id) ||
          typeof reminder.title !== 'string' || !reminder.title.trim() || reminder.title.length > 200 ||
          !Number.isSafeInteger(reminder.at) || (reminder.at <= now() && !existingTime) || reminder.at > now() + 366 * 864e5) throw new Error('invalid_reminders');
        ids.add(reminder.id);
        return { id: reminder.id, title: reminder.title.trim(), at: reminder.at,
          state: old?.at === reminder.at ? old.state : 'pending' };
      });
      session.reminders = reminders;
      persist(); send(res, 200, { saved: reminders.length });
    } catch (error) {
      const bad = ['invalid_json', 'invalid_reminders', 'body_too_large'].includes(error.message);
      send(res, bad ? error.message === 'body_too_large' ? 413 : 400 : 503, { error: bad ? error.message : 'telegram_unavailable' });
    }
    return true;
  }
  async function processUpdates() {
    const updates = await telegram('getUpdates', { offset: db.offset, timeout: 20, allowed_updates: ['message'] }, true);
    for (const update of updates) {
      db.offset = Math.max(db.offset, update.update_id + 1);
      const message = update.message;
      const match = /^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{43})$/.exec(message?.text || '');
      if (!match || message.chat?.type !== 'private') continue;
      const digest = hash(match[1]);
      const session = Object.values(db.sessions).find(item => !item.chatId && item.pairHash === digest && item.pairExpires > now());
      if (!session) continue;
      session.chatId = String(message.chat.id);
      delete session.pairHash;
      delete session.pairExpires;
      persist();
      try { await telegram('sendMessage', { chat_id: session.chatId, text: 'Digital To-Do подключён. Выберите задачи и время напоминания на сайте. Отключить уведомления можно там же.' }); } catch {}
    }
    if (updates.length) persist();
  }
  async function tick() {
    if (!configured || ticking) return;
    ticking = true;
    try {
      for (const session of Object.values(db.sessions)) {
        if (!session.chatId) continue;
        for (const reminder of session.reminders) {
          if (reminder.state !== 'pending' || reminder.at > now()) continue;
          // Persist the attempt before sending: a crash must not duplicate a reminder.
          reminder.state = 'sending'; persist();
          try {
            await telegram('sendMessage', { chat_id: session.chatId, text: `Напоминание Digital To-Do\n\n${reminder.title}` });
            reminder.state = 'sent';
          } catch { reminder.state = 'failed'; }
          persist();
        }
      }
    } finally { ticking = false; }
  }
  async function start() {
    if (!configured || running) return false;
    running = true;
    try { await identify(); } catch { running = false; return false; }
    timer = setInterval(() => { void tick(); }, 15_000);
    timer.unref?.();
    void (async () => {
      while (running) {
        try { await processUpdates(); }
        catch { if (running) await new Promise(resolve => { const retry = setTimeout(resolve, 3000); retry.unref?.(); }); }
      }
    })();
    void tick();
    return true;
  }
  function close() {
    running = false; clearInterval(timer);
    controllers.forEach(controller => controller.abort());
  }
  return { handle, start, close, tick, processUpdates, configured };
}
