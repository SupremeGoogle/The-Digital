// Streaming transport stays separate from the chat's presentation and task data.
export async function readAssistantResponse(response, onText = () => {}) {
  if (!response.ok) throw new Error('Assistant unavailable');
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const result = await response.json();
    if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('Empty answer');
    const answer = result.answer.slice(0, 8000);
    onText(answer);
    return { answer, truncated: false };
  }
  if (!response.body) throw new Error('Empty stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', answer = '', finished = false, truncated = false;
  function frame(value) {
    let event = 'message';
    const data = [];
    for (const line of value.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join('\n'));
    if (event === 'error') throw new Error('Stream interrupted');
    if (event === 'delta' && typeof payload.text === 'string') {
      answer = (answer + payload.text).slice(0, 8000);
      onText(answer);
    }
    if (event === 'done') { finished = true; truncated = payload.truncated === true; }
  }
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 100000) throw new Error('Stream frame too large');
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        frame(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (finished) break;
      }
      if (done) {
        if (buffer.trim() && !finished) frame(buffer);
        break;
      }
    }
    if (!finished || !answer.trim()) throw new Error('Incomplete answer');
    return { answer, truncated };
  } catch (error) {
    error.partialAnswer = answer;
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
