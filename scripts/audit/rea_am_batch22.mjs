// rea_am_batch22.mjs — StyledText parser: attribute names + defaults for <content>.
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

const CLS = 'com.alightcreative.app.motion.scene.StyledText';

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  process.stdout.write('StyledText ... ');
  const res = await client.call('inspect_android_class', { path: APK, class_name: CLS });
  const p = project(res.structured ?? res.text);
  save('class_StyledText.json', JSON.stringify(p, null, 2));
  const methods = (p?.reported_signature?.methods ?? p?.methods ?? []).map((m) => m.name ?? m).filter(Boolean);
  const fields = (p?.reported_type?.fields ?? p?.fields ?? []).map((f) => f.name ?? f).filter(Boolean);
  console.log(`${fields.length} fields, ${methods.length} methods`);
  console.log(`   fields: ${fields.join(' ')}`);
  console.log(`   methods: ${methods.slice(0, 40).join(' ')}`);

  for (const m of methods) {
    if (!/read|parse|fromXml|stat|toText|get|set/i.test(m)) continue;
    process.stdout.write(`  ${m} ... `);
    try {
      const r2 = await client.call('inspect_android_method', {
        path: APK,
        class_name: CLS,
        method_name: m,
        overload_index: 0,
      });
      const text = bodyText(project(r2.structured ?? r2.text));
      if (!text || text.length > 40000) {
        console.log(`${text.length} B (skipped)`);
        continue;
      }
      save(join('methods', `styled.${safe(m)}.txt`), text);
      console.log(`${text.length} B`);
    } catch {
      console.log('skip');
    }
  }
} finally {
  client.close();
}
