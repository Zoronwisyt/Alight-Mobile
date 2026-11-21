// rea_am_batch35.mjs — jD.xUY: the layer composite methods.
//
// xUY$fs turned out to be a plain data holder (every method is a getter/setter over the
// BlendingMode field), so the decision is made after the layer's gfx block is popped. These
// are the remaining xUY entry points that could own it.
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

const JOBS = [
  ['jD.xUY', 'jCs', 0],
  ['jD.xUY', 'lTc', 0],
  ['jD.xUY', 'n7J', 0],
  ['jD.xUY', 'bdS', 0],
  ['jD.xUY', 'pQ', 0],
  ['jD.xUY', 'n3', 0],
  ['jD.xUY', 'j4', 0],
  ['jD.xUY', 'a', 0],
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  for (const [cls, m, ov] of JOBS) {
    process.stdout.write(`${cls}.${m}#${ov} ... `);
    try {
      const r = await client.call('inspect_android_method', {
        path: APK,
        class_name: cls,
        method_name: m,
        overload_index: ov,
      });
      const text = bodyText(project(r.structured ?? r.text));
      save(join('methods', `comp.${safe(m)}#${ov}.txt`), text);
      console.log(`${text.length} B`);
    } catch (err) {
      console.log(`FAIL ${err.message.slice(0, 60)}`);
    }
  }
} finally {
  client.close();
}
