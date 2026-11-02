import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelegramService } from './telegram.mjs';

async function harness(t, configured = true) {
  const directory = mkdtempSync(join(tmpdir(), 'digital-telegram-test-'));
  const dbPath = join(directory, 'reminders.json');
  let clock = Date.now();
  const updates = [];
  const messages = [];
  const env = { REMINDERS_DB: dbPath, ...(configured ? { TELEGRAM_BOT_TOKEN: '123456:TEST_ONLY_NOT_A_REAL_TOKEN' } : {}) };
  let calls = 0;
  const fakeFetch = async (url, options) => {
    calls++;
    const method = url.split('/').at(-1);
    const data = JSON.parse(options.body);
    const result = method === 'getMe' ? { username: 'DigitalToDoTestBot' } : method === 'getUpdates' ? updates.splice(0) : { message_id: messages.push(data) };
    return { ok: true, json: async () => ({ ok: true, result }) };
  };
  const service = createTelegramService(env, { fetchImpl: fakeFetch, now: () => clock, background: false });
  const server = http.createServer(async (req, res) => { if (!await service.handle(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { service.close(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/telegram`;
  const request = async (path, { token, body } = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
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
  return { service, request, pair, updates, messages, env, dbPath, fakeFetch, advance: ms => { clock += ms; }, now: () => clock, calls: () => calls };
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
