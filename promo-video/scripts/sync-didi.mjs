// Pulls Didi's current look from the site (js/assistant.js) into every
// <!--didi:NAME--> … <!--/didi--> block of the compositions.
// Run before each render: node scripts/sync-didi.mjs
import fs from 'node:fs';
import path from 'node:path';

const site = fs.readFileSync(new URL('../../js/assistant.js', import.meta.url), 'utf8');
const match = site.match(/const robot = `([\s\S]*?<\/svg>)`;/);
if (!match) throw new Error('Robot SVG not found in js/assistant.js');
const svg = match[1];
const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);

const dir = new URL('../compositions/', import.meta.url);
const files = ['index.html', ...fs.readdirSync(dir).map(f => path.join('compositions', f))];
let total = 0;
for (const rel of files) {
  const file = new URL(`../${rel.replaceAll('\\', '/')}`, import.meta.url);
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/<!--didi:([\w-]+)-->[\s\S]*?<!--\/didi-->/g, (_, name) => {
    total++;
    // Gradient ids must be unique per copy on the assembled page.
    let copy = svg.replace('class="pal-robot"', `class="pal-robot" id="${name}"`);
    for (const id of ids) copy = copy.replaceAll(`id="${id}"`, `id="${name}-${id}"`).replaceAll(`url(#${id})`, `url(#${name}-${id})`);
    return `<!--didi:${name}-->${copy}<!--/didi-->`;
  });
  if (out !== src) fs.writeFileSync(file, out);
}
console.log(`Didi synced into ${total} block(s).`);
