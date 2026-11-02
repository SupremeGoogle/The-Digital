// Generates the voiceover line by line through Router AI (ElevenLabs v4).
// Usage: node --env-file=.env scripts/gen-vo.mjs [lineId ...]
// e1 keeps the pressure relatable, without shouting or an escalating foreign word.
import fs from 'node:fs';

const VOICE = process.env.VO_VOICE || 'Liam';
const LINES = {
  c1: '[calm] Знаешь это чувство… Когда дел так много, что непонятно, с чего начать?',
  e1: '[calm] Отчёт — вчера. Корм коту. Сроки, сроки, сроки.',
  e2: 'Знакомься — это Диди. Он разгребает хаос за тебя.',
  e3: 'Пишешь как думаешь — а метка, приоритет и срок встают сами.',
  e4: 'Задача сразу на доске… и в календаре.',
  e5: 'А чтобы точно не забыть — напоминание придёт в Телегра́м.',
  e6: 'Перетащил — в работе. Галочка — и готово!',
  e7: 'Прогре́сс растёт прямо на глазах.',
  e8: 'Запутался? Спроси Диди — он подскажет, что главное.',
  e9: 'Все дела — в одном маленьком мире.',
  e10: 'Диджитал Ту-Ду. Большие планы. Маленькие шаги.',
};

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LINES);
fs.mkdirSync('assets/vo2', { recursive: true });
await Promise.all(ids.map(async (id) => {
  const res = await fetch(`${process.env.ROUTERAI_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ROUTERAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'elevenlabs/eleven-v4', input: LINES[id], voice: VOICE, response_format: 'mp3' }),
  });
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} ${await res.text()}`);
  fs.writeFileSync(`assets/vo2/${id}.mp3`, Buffer.from(await res.arrayBuffer()));
  console.log(`${id} ok`);
}));
