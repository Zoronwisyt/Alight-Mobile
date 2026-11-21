// rea_am_batch23.mjs — the AM font-token grammar.
//
// Real AM text layers carry tokens like
//   font="googlefonts?name=Roboto&weight=400"
// (assets/effects/presets/text-presets.xml, 3.6.0-era, still written by 5.0.280).
// TextElementKt resolves the token through B8K.BWM.Rw(String, long), so that body
// is the ground truth for what a token is allowed to look like — and therefore for
// what the web importer must normalise before it decides a font is "missing".
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReaClient } from './rea_client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out', 'rea');
mkdirSync(join(OUT, 'methods'), { recursive: true });

const NODE = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node.exe';
const SCRIPT =
  'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node_modules\\rea-agents\\scripts\\rea.mjs';
const APK = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\opencode\\AlightMotion-5.0.280-raw.apk';
const ENV = {
  REA_JADX_MCP_JAR: `${process.env.USERPROFILE}\\.local\\share\\rea\\android\\jadx-headless-mcp-0.7.1-all.jar`,
  REA_JADX_OPERATION_TIMEOUT_MS: '900000',
  REA_JADX_HEAP_MIB: '8192',
};

const project = (p) => {
  if (!p) return null;
  if (typeof p === 'string') {
    try {
      return JSON.parse(p);
    } catch {
      return { text: p };
    }
  }
  return p.normalized_result ?? p;
};
const bodyText = (d) => {
  const s = d?.source ?? d?.text ?? d?.body ?? '';
  if (typeof s === 'string') return s;
  if (s && typeof s.text === 'string') return s.text;
  return JSON.stringify(s, null, 2);
};
const safe = (s) => s.replace(/[^A-Za-z0-9_.$-]/g, '_');
const save = (n, t) => writeFileSync(join(OUT, n), t, 'utf8');

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();

  for (const q of ['GoogleFont', 'FontFamily', 'Typeface', 'fonts']) {
    process.stdout.write(`search ${q} ... `);
    try {
      const res = await client.call('search_android_classes', { path: APK, query: q });
      const p = project(res.structured ?? res.text);
      const hits = (p?.matches ?? []).map((h) => h.name ?? h.qualified_name ?? h);
      console.log(`${hits.length}${hits.length ? ': ' + hits.slice(0, 6).join(' ') : ''}`);
      if (hits.length) save(`search_${safe(q)}.json`, JSON.stringify(p, null, 2));
    } catch (err) {
      console.log(`FAIL ${err.message.slice(0, 50)}`);
    }
  }

  // The resolver TextElement uses: B8K.BWM.Rw(String token, long timeout)
  for (const cls of ['B8K.BWM', 'B8K']) {
    process.stdout.write(`class ${cls} ... `);
    try {
      const res = await client.call('inspect_android_class', { path: APK, class_name: cls });
      const p = project(res.structured ?? res.text);
      save(`class_${safe(cls)}.json`, JSON.stringify(p, null, 2));
      const methods = (p?.reported_signature?.methods ?? p?.methods ?? []).map((m) => m.name ?? m).filter(Boolean);
      console.log(`${methods.length} methods: ${methods.slice(0, 20).join(' ')}`);
      for (const m of methods) {
        if (!/Rw|font|parse|typeface/i.test(m)) continue;
        for (let ov = 0; ov < 3; ov++) {
          process.stdout.write(`  ${cls}.${m}#${ov} ... `);
          try {
            const r2 = await client.call('inspect_android_method', {
              path: APK,
              class_name: cls,
              method_name: m,
              overload_index: ov,
            });
            const text = bodyText(project(r2.structured ?? r2.text));
            if (!text || text.length > 60000) {
              console.log(`${text.length} B (skip)`);
              continue;
            }
            save(join('methods', `font.${safe(cls)}.${safe(m)}#${ov}.txt`), text);
            console.log(`${text.length} B`);
          } catch {
            console.log('skip');
            break;
          }
        }
      }
    } catch (err) {
      console.log(`FAIL ${err.message.slice(0, 60)}`);
    }
  }
} finally {
  client.close();
}
