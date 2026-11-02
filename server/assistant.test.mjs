import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createAssistantServer } from './index.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
const close = server => new Promise(resolve => server.close(resolve));
const context = { today: '2026-11-02', stats: { total: 1, remaining: 1 }, tasks: [{ title: 'Проверить сайт', status: 'todo', priority: 'high', tag: 'work', due: '2026-11-03' }] };

test('unconfigured server reports readiness without exposing a key', async () => {
  const server = createAssistantServer({ CORS_ORIGIN: 'https://example.com' });
  const base = await listen(server);
  try {
    assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true, aiConfigured: false });
    const response = await fetch(base + '/api/assistant', { method: 'POST', headers: { Origin: 'https://example.com' } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://example.com');
    const blocked = await fetch(base + '/api/assistant', { method: 'POST', headers: { Origin: 'https://attacker.example' } });
    assert.equal(blocked.status, 403);
  } finally { await close(server); }
});

test('proxy sends only the allowed context, rejects malformed input and limits spending', async () => {
  let captured;
  let authorization;
  const provider = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    captured = JSON.parse(raw); authorization = req.headers.authorization;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'Осталась одна задача.' } }] }));
  });
  const providerUrl = await listen(provider);
  const server = createAssistantServer({ AI_BASE_URL: providerUrl + '/v1', AI_MODEL: 'fake-model', AI_API_KEY: 'fake-test-key', CORS_ORIGIN: 'https://example.com', MAX_DAILY_REQUESTS: '1' });
  const base = await listen(server);
  const headers = { Origin: 'https://example.com', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base + '/api/assistant', { method: 'POST', headers, body: '{broken' })).status, 400);
    const response = await fetch(base + '/api/assistant', { method: 'POST', headers, body: JSON.stringify({ question: 'Что осталось?', context: { ...context, secret: 'not-allowed', tasks: [{ ...context.tasks[0], notes: 'private note' }] } }) });
    assert.deepEqual(await response.json(), { answer: 'Осталась одна задача.', mode: 'ai' });
    assert.equal(authorization, 'Bearer fake-test-key');
    assert.equal(captured.model, 'fake-model');
    assert.equal(JSON.stringify(captured).includes('private note'), false);
    assert.equal(JSON.stringify(captured).includes('not-allowed'), false);
    assert.equal((await fetch(base + '/api/assistant', { method: 'POST', headers, body: JSON.stringify({ question: 'Ещё?', context }) })).status, 429);
  } finally { await close(server); await close(provider); }
});

test('wildcard origins and insecure remote providers fail closed', () => {
  assert.throws(() => createAssistantServer({ CORS_ORIGIN: '*' }), /exact origins/);
  assert.throws(() => createAssistantServer({ AI_BASE_URL: 'http://example.com/v1', AI_MODEL: 'model', AI_API_KEY: 'fake-key' }), /HTTPS/);
});

function streamServer(providerUrl) {
  return createAssistantServer({ AI_BASE_URL: providerUrl + '/v1', AI_MODEL: 'fake-model', AI_API_KEY: 'fake-test-key', CORS_ORIGIN: 'https://example.com' });
}
const streamRequest = { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Что осталось?', context, stream: true }) };
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
const delta = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;
function events(text) {
  return text.trim().split('\n\n').filter(Boolean).map(event => {
    const lines = event.split('\n');
    return { event: lines.find(l => l.startsWith('event: '))?.slice(7), data: JSON.parse(lines.find(l => l.startsWith('data: ')).slice(6)) };
  });
}

test('real SSE relays deltas before completion across event and UTF-8 boundaries', async () => {
  let releaseSecond;
  const gate = new Promise(resolve => { releaseSecond = resolve; });
  let captured;
  const provider = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    captured = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.flushHeaders();
    const bytes = Buffer.from(delta('Привет, '));
    // Explicitly split the first Cyrillic UTF-8 character across network writes.
    const split = bytes.indexOf(Buffer.from('П')) + 1;
    res.write(bytes.subarray(0, split));
    await tick(10);
    res.write(bytes.subarray(split, bytes.length - 1));
    await tick(10);
    res.write(bytes.subarray(bytes.length - 1));
    await gate;
    res.write('data: {"choices":[{"delta":{"reasoning":"PRIVATE_REASONING_DO_NOT_FORWARD"}}]}\n\n');
    res.write(delta('мир!'));
    res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  const providerUrl = await listen(provider);
  const server = streamServer(providerUrl);
  const base = await listen(server);
  try {
    const response = await fetch(base + '/api/assistant', streamRequest);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://example.com');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('Привет, ')) {
      const part = await reader.read();
      assert.equal(part.done, false);
      text += decoder.decode(part.value, { stream: true });
    }
    assert.equal(text.includes('event: done'), false);
    releaseSecond();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    const result = events(text);
    assert.deepEqual(result.map(e => e.event), ['meta', 'delta', 'delta', 'done']);
    assert.equal(result.filter(e => e.event === 'delta').map(e => e.data.text).join(''), 'Привет, мир!');
    assert.deepEqual(result.at(-1).data, { mode: 'ai' });
    assert.equal(text.includes('PRIVATE_REASONING'), false);
    assert.equal(captured.stream, true);
  } finally { releaseSecond(); await close(server); await close(provider); }
});

test('stream errors stay generic, while upstream rejection remains JSON before SSE headers', async () => {
  let requests = 0;
  const provider = http.createServer(async (req, res) => {
    for await (const _ of req) {}
    if (++requests === 1) { res.writeHead(503); res.end('SECRET_PROVIDER_ERROR'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(delta('Начало'));
    res.end('data: {"error":{"message":"SECRET_PROVIDER_ERROR","key":"SECRET"}}\n\n');
  });
  const providerUrl = await listen(provider);
  const server = streamServer(providerUrl);
  const base = await listen(server);
  try {
    const rejected = await fetch(base + '/api/assistant', streamRequest);
    assert.equal(rejected.status, 502);
    assert.match(rejected.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await rejected.json(), { error: 'provider_unavailable' });
    const response = await fetch(base + '/api/assistant', streamRequest);
    const text = await response.text();
    const result = events(text);
    assert.deepEqual(result.map(e => e.event), ['meta', 'delta', 'error']);
    assert.deepEqual(result.at(-1).data, { error: 'assistant_unavailable' });
    assert.equal(text.includes('SECRET'), false);
  } finally { await close(server); await close(provider); }
});

test('SSE marks provider length truncation and clamps text to 8000 characters', async () => {
  let requests = 0;
  const provider = http.createServer(async (req, res) => {
    for await (const _ of req) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (++requests === 1) {
      res.write(delta('Короткий ответ'));
      res.end('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n');
    } else { res.end(delta('я'.repeat(9000)) + 'data: [DONE]\n\n'); }
  });
  const providerUrl = await listen(provider);
  const server = streamServer(providerUrl);
  const base = await listen(server);
  try {
    const length = events(await (await fetch(base + '/api/assistant', streamRequest)).text());
    assert.equal(length.at(-1).data.truncated, true);
    const cap = events(await (await fetch(base + '/api/assistant', streamRequest)).text());
    assert.equal(cap.filter(e => e.event === 'delta').map(e => e.data.text).join('').length, 8000);
    assert.equal(cap.at(-1).data.truncated, true);
  } finally { await close(server); await close(provider); }
});

test('closing the client stream cancels the upstream request', async () => {
  let providerClosed;
  const closed = new Promise(resolve => { providerClosed = resolve; });
  const provider = http.createServer(async (req, res) => {
    for await (const _ of req) {}
    res.on('close', providerClosed);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(delta('Начало'));
  });
  const providerUrl = await listen(provider);
  const server = streamServer(providerUrl);
  const base = await listen(server);
  try {
    const response = await fetch(base + '/api/assistant', streamRequest);
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    const cancelled = await Promise.race([closed.then(() => true), tick(1000).then(() => false)]);
    assert.equal(cancelled, true);
  } finally { await close(server); await close(provider); }
});
