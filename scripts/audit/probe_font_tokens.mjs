// Probe: every `font="…"` literal in the APK, to catalogue the token forms AM 5.0.280
// itself writes. Used to decide what the web exporter should emit.
import { readFileSync } from 'node:fs';

const apk = process.argv[2];
const b = readFileSync(apk);
const needle = Buffer.from('font="', 'utf8');
let i = 0;
let n = 0;
const seen = new Set();
while ((i = b.indexOf(needle, i)) !== -1) {
  const s = b.slice(i + 6, i + 200).toString('latin1');
  const end = s.indexOf('"');
  const token = s.slice(0, end < 0 ? 80 : end);
  if (!seen.has(token)) {
    seen.add(token);
    console.log(JSON.stringify(token));
  }
  i += 1;
  if (++n > 200) break;
}
console.log('distinct tokens:', seen.size);
