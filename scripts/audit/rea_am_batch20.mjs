// rea_am_batch20.mjs — TextElementKt: the XML <text> children and the font token.
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

const T = 'com.alightcreative.app.motion.scene.TextElementKt';

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  process.stdout.write('class TextElementKt ... ');
  const res = await client.call('inspect_android_class', { path: APK, class_name: T });
  const p = project(res.structured ?? res.text);
  save('class_TextElementKt.json', JSON.stringify(p, null, 2));
  const methods = (p?.reported_signature?.methods ?? p?.methods ?? []).map((m) => m.name ?? m).filter(Boolean);
  const fields = (p?.reported_type?.fields ?? p?.fields ?? []).map((f) => f.name ?? f).filter(Boolean);
  console.log(`${fields.length} fields, ${methods.length} methods`);
  console.log(`   fields: ${fields.join(' ')}`);
  console.log(`   methods: ${methods.join(' ')}`);

  const WANT = methods.filter((m) => /read|parse|font|size|text/i.test(m));
  for (const m of WANT) {
    for (let ov = 0; ov < 2; ov++) {
      process.stdout.write(`  ${m}#${ov} ... `);
      try {
        const r2 = await client.call('inspect_android_method', {
          path: APK,
          class_name: T,
          method_name: m,
          overload_index: ov,
        });
        const text = bodyText(project(r2.structured ?? r2.text));
        if (!text) {
          console.log('0 B');
          continue;
        }
        save(join('methods', `text.${safe(m)}#${ov}.txt`), text);
        console.log(`${text.length} B`);
        if (text.includes('<init>') || text.length < 40) break;
      } catch {
        console.log('skip');
        break;
      }
    }
  }
} finally {
  client.close();
}
