import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
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
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET || '';
  const webhookMode = Boolean(webhookSecret);
  const forwardSecret = env.TELEGRAM_FORWARD_WEBHOOK_SECRET || '';
  let forwardUrl = null;
  if (webhookMode && env.TELEGRAM_FORWARD_WEBHOOK_URL) {
    forwardUrl = new URL(env.TELEGRAM_FORWARD_WEBHOOK_URL);
    if (forwardUrl.protocol !== 'https:' || forwardUrl.username || forwardUrl.password || forwardUrl.hash) throw new Error('Telegram forwarding URL must use HTTPS without URL credentials or fragment');
  }
  const dbPath = env.REMINDERS_DB || join(homedir(), '.digital-todo', 'telegram-reminders.json');
  let db = { version: 1, offset: 0, sessions: {} };
  if (configured && existsSync(dbPath)) {
    const saved = JSON.parse(readFileSync(dbPath, 'utf8'));
    if (saved.version !== 1 || !saved.sessions || typeof saved.sessions !== 'object' || Array.isArray(saved.sessions)) throw new Error('Invalid reminders database');
    db = saved;
  }
  let username = /^[A-Za-z0-9_]{5,32}$/.test(env.TELEGRAM_BOT_USERNAME || '') ? env.TELEGRAM_BOT_USERNAME : null;
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
  async function jsonBody(req, limit = 24_000) {
    let length = 0;
    const chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length <= limit) chunks.push(chunk);
    }
    if (length > limit) throw new Error('body_too_large');
    const raw = Buffer.concat(chunks).toString('utf8');
    try { return { value: JSON.parse(raw || '{}'), raw }; }
    catch { throw new Error('invalid_json'); }
  }
  async function body(req) { return (await jsonBody(req)).value; }
  function validWebhookSecret(req) {
    const supplied = req.headers['x-telegram-bot-api-secret-token'];
    if (!webhookMode || typeof supplied !== 'string' || supplied.length > 512) return false;
    return timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(webhookSecret).digest());
  }
  async function forwardUpdate(raw) {
    if (!forwardUrl) throw new Error('forward_not_configured');
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(forwardUrl.href, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(forwardSecret ? { 'X-Telegram-Bot-Api-Secret-Token': forwardSecret } : {}) },
        body: raw, signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error('forward_unavailable');
      // Telegram also supports Bot API calls returned directly by the old webhook.
      // Relay that response too, otherwise a reply-based legacy bot would go silent.
      const reply = typeof response.text === 'function' ? await response.text() : '';
      if (Buffer.byteLength(reply, 'utf8') > 64 * 1024) throw new Error('forward_unavailable');
      return reply;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  async function webhook(req, res) {
    if (req.method !== 'POST') { send(res, 405, { error: 'method_not_allowed' }); return; }
    if (!validWebhookSecret(req)) { send(res, 403, { error: 'invalid_webhook_secret' }); return; }
    if (!configured) { send(res, 503, { error: 'telegram_not_configured' }); return; }
    try {
      const { value: update, raw } = await jsonBody(req, 64 * 1024);
      if (!update || typeof update !== 'object' || Array.isArray(update) || !Number.isSafeInteger(update.update_id)) throw new Error('invalid_update');
      // Only our namespaced deep links belong to To-Do. Ordinary messages, callbacks,
      // other applications' /start commands and unknown update types stay untouched.
      if (!await consumePairing(update, false)) {
        const reply = await forwardUpdate(raw);
        if (reply) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(reply);
          return;
        }
      }
      send(res, 200, { ok: true });
    } catch (error) {
      const bad = ['invalid_json', 'invalid_update', 'body_too_large'].includes(error.message);
      send(res, bad ? error.message === 'body_too_large' ? 413 : 400 : 503, { error: bad ? error.message : 'webhook_retry' });
    }
  }
  function rateAllowed(req, path) {
    const ip = env.TRUST_PROXY === 'true' ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
    const key = `${ip || 'unknown'}:${path === '/api/telegram/link' ? 'link' : 'other'}`;
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
    // Telegram is authenticated by its shared webhook secret, not a browser IP limit.
    // Rate-limiting this shared transport could interrupt the previous application.
    if (path === '/api/telegram/webhook') { await webhook(req, res); return true; }
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
        send(res, 200, { clientToken: bearer, linkUrl: `https://t.me/${name}?start=dt_${nonce}`, expiresAt: now() + PAIR_TTL });
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
  async function consumePairing(update, allowLegacy) {
    const message = update.message;
    const text = typeof message?.text === 'string' ? message.text : '';
    const own = /^\/start(?:@[A-Za-z0-9_]+)?\s+dt_/.test(text);
    const match = /^\/start(?:@[A-Za-z0-9_]+)?\s+dt_([A-Za-z0-9_-]{43})\s*$/.exec(text) ||
      (allowLegacy ? /^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{43})$/.exec(text) : null);
    if (!own && !match) return false;
    // Expired or malformed To-Do links are still ours and must not trigger the old bot.
    if (!match || message.chat?.type !== 'private') return true;
    const digest = hash(match[1]);
    const session = Object.values(db.sessions).find(item => !item.chatId && item.pairHash === digest && item.pairExpires > now());
    if (!session) return true;
    session.chatId = String(message.chat.id);
    delete session.pairHash;
    delete session.pairExpires;
    persist();
    try { await telegram('sendMessage', { chat_id: session.chatId, text: 'Digital To-Do подключён. Выберите задачи и время напоминания на сайте. Отключить уведомления можно там же.' }); } catch {}
    return true;
  }
  async function processUpdates() {
    if (webhookMode) return;
    const updates = await telegram('getUpdates', { offset: db.offset, timeout: 20, allowed_updates: ['message'] }, true);
    for (const update of updates) {
      db.offset = Math.max(db.offset, update.update_id + 1);
      await consumePairing(update, true);
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
    if (!webhookMode) void (async () => {
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
