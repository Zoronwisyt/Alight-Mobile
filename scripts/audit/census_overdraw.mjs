// Census: which shipped effects declare overdraw, and how much.
// `overdraw="true"` + `max-overdraw="N"` expand the layer FBO in AM so a shader can
// sample outside the layer rect. The web renderer currently derives padding from
// animation only, so this is the list of places that can diverge.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const rows = [];
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.xml')) continue;
  const s = readFileSync(join(dir, file), 'utf8');
  const overdraw = /\soverdraw="true"/.test(s);
  const maxMatch = s.match(/max-overdraw="([^"]+)"/) || s.match(/maxOverdraw="([^"]+)"/);
  if (overdraw || maxMatch) {
    rows.push({ file, overdraw, maxOverdraw: maxMatch ? Number(maxMatch[1]) : null });
  }
}
rows.sort((a, b) => (b.maxOverdraw || 0) - (a.maxOverdraw || 0));
for (const r of rows) console.log(`${r.file}\toverdraw=${r.overdraw}\tmax=${r.maxOverdraw}`);
console.log('declaring overdraw:', rows.length);
