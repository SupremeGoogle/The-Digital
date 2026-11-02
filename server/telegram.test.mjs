import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelegramService } from './telegram.mjs';

async function harness(t, configured = true, webhook = false) {
  const directory = mkdtempSync(join(tmpdir(), 'digital-telegram-test-'));
  const dbPath = join(directory, 'reminders.json');
  let clock = Date.now();
  const updates = [];
  const messages = [];
  const env = { REMINDERS_DB: dbPath, ...(configured ? { TELEGRAM_BOT_TOKEN: '123456:TEST_ONLY_NOT_A_REAL_TOKEN' } : {}),
    ...(webhook ? { TELEGRAM_WEBHOOK_SECRET: 'new_test_secret', TELEGRAM_FORWARD_WEBHOOK_URL: 'https://previous-app.example/private-webhook', TELEGRAM_FORWARD_WEBHOOK_SECRET: 'previous_test_secret' } : {}) };
  let calls = 0;
  let forwardingOkay = true;
  let forwardingReply = '';
  const forwarded = [];
  const methods = [];
  const fakeFetch = async (url, options) => {
    calls++;
    if (new URL(url).hostname === 'previous-app.example') {
      forwarded.push({ body: options.body, headers: options.headers });
      return { ok: forwardingOkay, text: async () => forwardingReply };
    }
    const method = url.split('/').at(-1);
    methods.push(method);
    const data = JSON.parse(options.body);
    const result = method === 'getMe' ? { username: 'DigitalToDoTestBot' } : method === 'getUpdates' ? updates.splice(0) : { message_id: messages.push(data) };
    return { ok: true, json: async () => ({ ok: true, result }) };
  };
  const service = createTelegramService(env, { fetchImpl: fakeFetch, now: () => clock, background: false });
  const server = http.createServer(async (req, res) => { if (!await service.handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { service.close(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/telegram`;
  const request = async (path, { token, body, headers = {}, raw } = {}) => {
    const post = body !== undefined || raw !== undefined;
    const response = await fetch(base + path, { method: post ? 'POST' : 'GET',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(post ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(post ? { body: raw === undefined ? JSON.stringify(body) : raw } : {}) });
    return { status: response.status, value: await response.json() };
  };
  async function pair() {
    const response = await request('/link', { body: {} });
    assert.equal(response.status, 200);
    const nonce = new URL(response.value.linkUrl).searchParams.get('start');
    updates.push({ update_id: 1, message: { text: `/start ${nonce}`, chat: { id: 42, type: 'private' } } });
    await service.processUpdates();
    return response.value.clientToken;
  }
  return { service, request, pair, updates, messages, env, dbPath, fakeFetch, forwarded, methods,
    setForwardOkay: value => { forwardingOkay = value; },
    setForwardReply: value => { forwardingReply = value; },
    advance: ms => { clock += ms; }, now: () => clock, calls: () => calls };
}

test('no token: truthful status, no Telegram traffic or database writes', async t => {
  const h = await harness(t, false);
  const status = await h.request('/status');
  assert.deepEqual(status.value, { configured: false, ready: false, connected: false, pending: false, reminders: [] });
  assert.equal((await h.request('/link', { body: {} })).status, 503);
  assert.equal(await h.service.start(), false);
  await h.service.tick();
  assert.equal(h.calls(), 0);
  assert.equal(existsSync(h.dbPath), false);
});

test('disabled Telegram ignores a malformed unused database without overwriting it', async t => {
  const h = await harness(t, false);
  writeFileSync(h.dbPath, 'not valid JSON');
  const disabled = createTelegramService(h.env, { fetchImpl: h.fakeFetch, background: false });
  assert.equal(disabled.configured, false);
  assert.equal(await disabled.start(), false);
  assert.equal(readFileSync(h.dbPath, 'utf8'), 'not valid JSON');
  assert.equal(h.calls(), 0);
  disabled.close();
});

test('one-time pairing, hashed browser credential, isolated authorization', async t => {
  const h = await harness(t);
  const token = await h.pair();
  const status = await h.request('/status', { token });
  assert.equal(status.value.connected, true);
  assert.equal('chatId' in status.value, false);
  assert.equal((await h.request('/status', { token: 'A'.repeat(43) })).status, 401);
  assert.equal((await h.request('/disconnect', { token: 'A'.repeat(43), body: {} })).status, 401);
  const file = readFileSync(h.dbPath, 'utf8');
  assert.equal(file.includes(token), false);
  assert.equal(file.includes(h.env.TELEGRAM_BOT_TOKEN), false);
  assert.equal(h.messages.length, 1);
  await h.service.processUpdates();
  assert.equal(h.messages.length, 1);
});

test('remind once, survives restart, replacing selection cancels completed/deleted tasks', async t => {
  const h = await harness(t);
  const token = await h.pair();
  const reminder = { id: 'example-task', title: 'Проверить мобильную версию', at: h.now() + 1000 };
  assert.equal((await h.request('/reminders', { token, body: { reminders: [reminder] } })).value.saved, 1);
  h.advance(2000);
  await h.service.tick(); await h.service.tick();
  assert.equal(h.messages.filter(message => message.text.startsWith('Напоминание')).length, 1);
  const restarted = createTelegramService(h.env, { fetchImpl: h.fakeFetch, now: h.now, background: false });
  await restarted.tick(); restarted.close();
  assert.equal(h.messages.filter(message => message.text.startsWith('Напоминание')).length, 1);
  const next = { ...reminder, id: 'now-completed', at: h.now() + 1000 };
  await h.request('/reminders', { token, body: { reminders: [next] } });
  await h.request('/reminders', { token, body: { reminders: [] } });
  h.advance(2000); await h.service.tick();
  assert.equal(h.messages.filter(message => message.text.startsWith('Напоминание')).length, 1);
  assert.equal((await h.request('/disconnect', { token, body: {} })).status, 200);
  assert.equal((await h.request('/status', { token })).status, 401);
});

test('expired pairing, group chats, missing auth and invalid schedules are rejected', async t => {
  const h = await harness(t);
  const linked = await h.request('/link', { body: {} });
  const nonce = new URL(linked.value.linkUrl).searchParams.get('start');
  h.updates.push({ update_id: 1, message: { text: `/start ${nonce}`, chat: { id: 99, type: 'group' } } });
  await h.service.processUpdates();
  assert.equal((await h.request('/status', { token: linked.value.clientToken })).value.connected, false);
  h.advance(6 * 60_000);
  h.updates.push({ update_id: 2, message: { text: `/start ${nonce}`, chat: { id: 42, type: 'private' } } });
  await h.service.processUpdates();
  assert.equal((await h.request('/status', { token: linked.value.clientToken })).value.connected, false);
  const token = await h.pair();
  assert.equal((await h.request('/reminders', { body: { reminders: [] } })).status, 401);
  assert.equal((await h.request('/reminders', { token, body: { reminders: [{ id: 'a', title: 'Task', at: h.now() - 1 }] } })).status, 400);
  assert.equal((await h.request('/reminders', { token, body: { reminders: Array(41).fill({}) } })).status, 400);
});

test('autosync preserves an already due pending reminder until its scheduled delivery', async t => {
  const h = await harness(t);
  const token = await h.pair();
  const dueSoon = { id: 'due-soon', title: 'Важная задача', at: h.now() + 1000 };
  const later = { id: 'later', title: 'Другая задача', at: h.now() + 60_000 };
  await h.request('/reminders', { token, body: { reminders: [dueSoon, later] } });
  h.advance(2000);
  const synced = await h.request('/reminders', { token, body: { reminders: [dueSoon, { ...later, title: 'Переименованная другая задача' }] } });
  assert.equal(synced.status, 200);
  assert.equal(synced.value.saved, 2);
  const newPast = { id: 'new-past', title: 'Новое напоминание в прошлом', at: dueSoon.at };
  assert.equal((await h.request('/reminders', { token, body: { reminders: [dueSoon, later, newPast] } })).status, 400);
  await h.service.tick(); await h.service.tick();
  const sent = h.messages.filter(message => message.text.startsWith('Напоминание'));
  assert.equal(sent.length, 1);
  assert(sent[0].text.includes(dueSoon.title));
});

test('polling keeps accepting existing legacy 43-character pairing links', async t => {
  const h = await harness(t);
  const response = await h.request('/link', { body: {} });
  const nonce = new URL(response.value.linkUrl).searchParams.get('start').replace(/^dt_/, '');
  assert.equal(nonce.length, 43);
  h.updates.push({ update_id: 1, message: { text: `/start ${nonce}`, chat: { id: 42, type: 'private' } } });
  await h.service.processUpdates();
  assert.equal((await h.request('/status', { token: response.value.clientToken })).value.connected, true);
});

test('webhook authenticates Telegram, forwards original payloads and preserves old-app commands', async t => {
  const h = await harness(t, true, true);
  const headers = { 'X-Telegram-Bot-Api-Secret-Token': h.env.TELEGRAM_WEBHOOK_SECRET };
  const raw = '{ "update_id": 21, "message": { "text": "/start previous_app", "chat": { "id": 42, "type": "private" } }, "extra": [1, {"keep":true}] }';
  assert.equal((await h.request('/webhook', { raw })).status, 403);
  assert.equal((await h.request('/webhook', { raw, headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong_secret' } })).status, 403);
  assert.equal(h.forwarded.length, 0);
  assert.equal((await h.request('/webhook', { raw, headers })).status, 200);
  assert.equal(h.forwarded[0].body, raw);
  assert.equal(h.forwarded[0].headers['X-Telegram-Bot-Api-Secret-Token'], 'previous_test_secret');
  const callback = { update_id: 22, callback_query: { id: 'abc', data: 'old-app-action', from: { id: 42 } } };
  assert.equal((await h.request('/webhook', { body: callback, headers })).status, 200);
  assert.deepEqual(JSON.parse(h.forwarded[1].body), callback);
  assert.equal(h.messages.length, 0);
});

test('webhook intercepts only namespaced To-Do links, including invalid or expired ones', async t => {
  const h = await harness(t, true, true);
  const headers = { 'X-Telegram-Bot-Api-Secret-Token': h.env.TELEGRAM_WEBHOOK_SECRET };
  const response = await h.request('/link', { body: {} });
  const payload = new URL(response.value.linkUrl).searchParams.get('start');
  assert.match(payload, /^dt_[A-Za-z0-9_-]{43}$/);
  const own = { update_id: 1, message: { text: `/start ${payload}`, chat: { id: 42, type: 'private' } } };
  assert.equal((await h.request('/webhook', { body: own, headers })).status, 200);
  assert.equal((await h.request('/status', { token: response.value.clientToken })).value.connected, true);
  assert.equal((await h.request('/webhook', { body: own, headers })).status, 200);
  assert.equal(h.messages.length, 1);
  assert.equal(h.forwarded.length, 0);
  const invalid = { update_id: 2, message: { text: '/start dt_invalid', chat: { id: 42, type: 'private' } } };
  assert.equal((await h.request('/webhook', { body: invalid, headers })).status, 200);
  h.advance(6 * 60_000);
  assert.equal((await h.request('/webhook', { body: { ...own, update_id: 3 }, headers })).status, 200);
  assert.equal(h.forwarded.length, 0);
  // Even an already linked chat's ordinary messages still belong to the original bot.
  const ordinary = { update_id: 4, message: { text: 'Привет старому приложению', chat: { id: 42, type: 'private' } } };
  await h.request('/webhook', { body: ordinary, headers });
  assert.deepEqual(JSON.parse(h.forwarded[0].body), ordinary);
});

test('failed forwarding returns 503 for Telegram retry; oversized payloads are rejected', async t => {
  const h = await harness(t, true, true);
  const headers = { 'X-Telegram-Bot-Api-Secret-Token': h.env.TELEGRAM_WEBHOOK_SECRET };
  const update = { update_id: 10, edited_message: { text: 'Keep old behavior' } };
  h.setForwardOkay(false);
  assert.equal((await h.request('/webhook', { body: update, headers })).status, 503);
  h.setForwardOkay(true);
  assert.equal((await h.request('/webhook', { body: update, headers })).status, 200);
  assert.equal(h.forwarded.length, 2);
  assert.equal(h.forwarded[0].body, h.forwarded[1].body);
  assert.equal((await h.request('/webhook', { raw: JSON.stringify({ update_id: 11, filler: 'x'.repeat(66_000) }), headers })).status, 413);
  assert.equal(h.forwarded.length, 2);
});

test('webhook start identifies bot and runs scheduler without starting getUpdates', async t => {
  const h = await harness(t, true, true);
  assert.equal(await h.service.start(), true);
  await h.service.processUpdates();
  assert.equal(h.methods.filter(method => method === 'getMe').length, 1);
  assert.equal(h.methods.includes('getUpdates'), false);
});

test('legacy Bot API webhook replies pass through to Telegram unchanged', async t => {
  const h = await harness(t, true, true);
  const headers = { 'X-Telegram-Bot-Api-Secret-Token': h.env.TELEGRAM_WEBHOOK_SECRET };
  const reply = { method: 'sendMessage', chat_id: 42, text: 'Ответ прежнего приложения' };
  h.setForwardReply(JSON.stringify(reply));
  const response = await h.request('/webhook', { body: { update_id: 1, message: { text: '/start old_app' } }, headers });
  assert.equal(response.status, 200);
  assert.deepEqual(response.value, reply);
});
