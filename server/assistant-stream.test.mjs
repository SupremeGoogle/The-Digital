import test from 'node:test';
import assert from 'node:assert/strict';
import { readAssistantResponse } from '../js/assistant-stream.js';

const streamed = text => {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    // One-byte chunks exercise split Cyrillic characters and split SSE boundaries.
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
};
test('browser transport reveals successive real deltas without corrupting UTF-8', async () => {
  const partial = [];
  const result = await readAssistantResponse(streamed('event: meta\r\ndata: {"mode":"ai"}\r\n\r\nevent: delta\r\ndata: {"text":"Осталось "}\r\n\r\nevent: delta\ndata: {"text":"две задачи."}\n\nevent: done\ndata: {"mode":"ai"}\n\n'), text => partial.push(text));
  assert.deepEqual(partial, ['Осталось ', 'Осталось две задачи.']);
  assert.equal(result.answer, 'Осталось две задачи.');
  assert.equal(result.truncated, false);
});
test('browser transport retains partial answers on interruption', async () => {
  await assert.rejects(readAssistantResponse(streamed('event: delta\ndata: {"text":"Начало ответа"}\n\nevent: error\ndata: {"error":"assistant_unavailable"}\n\n')), error => error.partialAnswer === 'Начало ответа');
  await assert.rejects(readAssistantResponse(streamed('event: delta\ndata: {"text":"Оборвано"}\n\n')), /Incomplete answer/);
});
test('JSON compatibility keeps older API servers usable', async () => {
  const result = await readAssistantResponse(Response.json({ answer: 'Готово.' }));
  assert.equal(result.answer, 'Готово.');
});
