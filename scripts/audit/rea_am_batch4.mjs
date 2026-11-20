// rea_am_batch4.mjs — enum bodies and the camera defaults.
//
// The remaining unknowns are all defaults: what fi.bN's tiers are called, what
// CameraType offers, and which values CameraProperties' primary constructor
// synthesizes when DEFAULT constructs it with an all-defaults mask.
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

function project(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return { text: payload }; }
  }
  return payload.normalized_result ?? payload;
}
function bodyText(data) {
  const src = data?.source ?? data?.text ?? data?.body ?? '';
  if (typeof src === 'string') return src;
  if (src && typeof src.text === 'string') return src.text;
  return JSON.stringify(src, null, 2);
}

const S = 'com.alightcreative.app.motion.scene';
const METHODS = [
  ['fi.bN', '<clinit>'],
  [`${S}.CameraType`, '<clinit>'],
  [`${S}.CameraProperties`, '<init>', 0],
  [`${S}.CameraProperties`, 'getFov'],
  [`${S}.CameraProperties`, '<init>', 1],
  [`${S}.ExportParams`, '<clinit>'],
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  for (const [cls, method, overload] of METHODS) {
    const label = `${cls.split('.').pop()}.${method}${overload !== undefined ? `#${overload}` : ''}`;
    process.stdout.write(`method ${label} ... `);
    const args = { path: APK, class_name: cls, method_name: method };
    if (overload !== undefined) args.overload_index = overload;
    try {
      const res = await client.call('inspect_android_method', args);
      const text = bodyText(project(res.structured ?? res.text));
      writeFileSync(join(OUT, 'methods', `${label.replace(/[^A-Za-z0-9_.$#]/g, '_')}.txt`), text, 'utf8');
      console.log(`${text.length} B`);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 200)}`);
    }
  }
} finally {
  client.close();
}
