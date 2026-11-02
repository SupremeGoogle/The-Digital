// Measures element boxes of the frozen UI (same DOM, CSS and fonts as the film)
// and writes them into the /*RECTS*/ block of compositions/app.html.
// Usage: node scripts/measure-ui.mjs <path-to-puppeteer>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require(process.argv[2]);
const root = new URL('../', import.meta.url);
const file = new URL('compositions/app.html', root);
const src = fs.readFileSync(file, 'utf8');
const inner = src.match(/<template>([\s\S]*)<\/template>/)[1].replace(/<script>[\s\S]*<\/script>/, '');
const index = fs.readFileSync(new URL('index.html', root), 'utf8');
const links = index.match(/<link rel="stylesheet"[^>]*>/g).join('\n');
const harness = `<!doctype html><html lang="ru" data-theme="light"><head><meta charset="utf-8">
<base href="${root.href}">${links}
<style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#eaf4ff}#host{position:relative;width:1920px;height:1080px}</style>
</head><body><div id="host">${inner}</div></body></html>`;
const tmp = new URL('scripts/.measure.html', root);
fs.writeFileSync(tmp, harness);

const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], defaultViewport: { width: 1920, height: 1080 } });
const page = await browser.newPage();
await page.goto(tmp.href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const R = await page.evaluate(() => {
  const cam = document.querySelector('#a-cam').getBoundingClientRect();
  const box = (sel, rel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    const r = el.getBoundingClientRect(), o = rel ? document.querySelector(rel).getBoundingClientRect() : cam;
    return { x: Math.round(r.left - o.left), y: Math.round(r.top - o.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const first = (s) => `.col-list[data-status=${s}] > li`;
  const input = document.querySelector('#taskInput');
  const cs = getComputedStyle(input);
  document.querySelector('#calendar').style.width = `${document.querySelector('#board').getBoundingClientRect().width}px`;
  const todo = box(first('todo')), second = box(`${first('todo')}:nth-child(2)`);
  return {
    input: box('#taskInput'), add: box('.composer .btn-primary'),
    inputPad: parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth),
    inputFont: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, inputLine: Math.round(parseFloat(cs.fontSize) * 1.3),
    todoFirst: todo, doingFirst: box(first('doing')), doneFirst: box(first('done')),
    cardH: todo.h, gap: second.y - todo.y - todo.h,
    cardOrigin: box('#a-card'), boxOff: box('#a-v-doing .check .box', '#a-v-doing'),
    progress: box('.progress.card'), video: box('#a-3d-box'),
    launcher: box('#a-pal .pal-launcher'), panel: box('#a-pal .pal-panel'),
    suggest: box('#a-pal .pal-suggestions button:nth-child(2)'), messages: box('#a-pal .pal-messages'),
    board: box('#board'), calOrigin: box('#calendar'), viewCal: box('#a-vs-board [data-layout=calendar]'),
    more: box('.board-actions > summary'), tgTrigger: box('.telegram-settings'),
    cell3: box('[data-day="2026-11-03"]', '#calendar'),
    tg: box('#a-tg', '#a-tg'), tgCheck: box('#a-tg-rowA input[type=checkbox]', '#a-tg'), tgSave: box('#a-tg .telegram-save', '#a-tg'),
  };
});
await browser.close();
fs.unlinkSync(tmp);
fs.writeFileSync(file, src.replace(/\/\*RECTS\*\/[\s\S]*?\/\*\/RECTS\*\//, `/*RECTS*/${JSON.stringify(R)}/*/RECTS*/`));
console.log(JSON.stringify(R));
