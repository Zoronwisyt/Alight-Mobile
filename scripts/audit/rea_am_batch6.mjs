// rea_am_batch6.mjs — the constants that decide what the canvas looks like.
//
// The matte colour and the transparency checker are the only two places the
// preview differs from the export by design. Both are static initialisers.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReaClient } from './rea_client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out', 'rea');
mkdirSync(join(OUT, 'methods'), { recursive: true });

const NODE = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node.exe';
const SCRIPT = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node_modules\\rea-agents\\scripts\\rea.mjs';
const APK = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\opencode\\AlightMotion-5.0.280-raw.apk';
const ENV = {
  REA_JADX_MCP_JAR: `${process.env.USERPROFILE}\\.local\\share\\rea\\android\\jadx-headless-mcp-0.7.1-all.jar`,
  REA_JADX_OPERATION_TIMEOUT_MS: '900000',
  REA_JADX_HEAP_MIB: '8192',
};

function project(p) {
  if (!p) return null;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { return { text: p }; } }
  return p.normalized_result ?? p;
}
function bodyText(d) {
  const s = d?.source ?? d?.text ?? d?.body ?? '';
  if (typeof s === 'string') return s;
  if (s && typeof s.text === 'string') return s.text;
  return JSON.stringify(s, null, 2);
}

const R = 'com.alightcreative.app.motion.scene.rendering.SceneRenderingKt';
const METHODS = [
  [R, 'renderWithGpu$lambda$29$clearToMatteColor', 0],
  [R, '<clinit>', 0],
  ['fi.K', '<clinit>', 0],
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  for (const [cls, method, overload] of METHODS) {
    const label = `${cls.split('.').pop()}.${method}`;
    process.stdout.write(`method ${label} ... `);
    try {
      const res = await client.call('inspect_android_method', {
        path: APK, class_name: cls, method_name: method, overload_index: overload,
      });
      const text = bodyText(project(res.structured ?? res.text));
      writeFileSync(join(OUT, 'methods', `${label.replace(/[^A-Za-z0-9_.$]/g, '_')}.txt`), text, 'utf8');
      console.log(`${text.length} B`);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 200)}`);
    }
  }
  const cls = await client.call('inspect_android_class', { path: APK, class_name: 'fi.K' });
  writeFileSync(join(OUT, 'class_fi_K.json'), JSON.stringify(project(cls.structured ?? cls.text), null, 2), 'utf8');
  console.log('fi.K inventory saved');
} finally {
  client.close();
}
