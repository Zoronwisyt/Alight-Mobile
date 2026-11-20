// rea_am_batch3.mjs — the surface and the quality ladder.
//
// Still open after pass two:
//   - what fi.lG actually is (the preview-quality object the render env carries)
//   - calcCameraZoom: the FOV -> Z conversion makeDefaultCamera depends on
//   - CameraProperties.DEFAULT values (fov, type, fog)
//   - jD.xUY: the per-render canvas wrapper built once per renderWithGpu call
//   - bYT.ny6: the GL surface abstraction the wrapper draws on
//   - EditActivity: which Android view hosts the preview
import { mkdirSync, writeFileSync } from 'node:fs';
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
const CLASSES = [
  'fi.lG',
  'fi.bN',
  'jD.xUY',
  'bYT.ny6',
  `${S}.CameraProperties`,
  `${S}.CameraType`,
  `${S}.Transform`,
  `${S}.SceneOverlay`,
  `${S}.SceneOverlayKt`,
  `${S}.ExportParams`,
  'com.alightcreative.app.motion.activities.EditActivity',
];
const METHODS = [
  [`${S}.CameraElementKt`, 'calcCameraZoom'],
  [`${S}.CameraProperties`, '<clinit>'],
  [`${S}.CameraProperties$Companion`, 'getDEFAULT'],
  ['fi.lG', 'Xu'],
  ['fi.lG', 'Pl3'],
  ['fi.lG', '<clinit>'],
  ['jD.xUY', '<init>'],
  ['jD.xUY', 'PW'],
  ['jD.xUY', 'A'],
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

try {
  await client.initialize();
  console.log(`${stamp()} session up`);

  for (const cls of CLASSES) {
    process.stdout.write(`${stamp()} class ${cls} ... `);
    try {
      const res = await client.call('inspect_android_class', { path: APK, class_name: cls });
      const data = project(res.structured ?? res.text);
      writeFileSync(join(OUT, `class_${cls.replace(/\./g, '_')}.json`), JSON.stringify(data, null, 2), 'utf8');
      console.log(`fields=${data?.fields?.length ?? 0} methods=${data?.methods?.length ?? 0}`);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 120)}`);
    }
  }

  for (const [cls, method] of METHODS) {
    const label = `${cls.split('.').pop()}.${method}`;
    process.stdout.write(`${stamp()} method ${label} ... `);
    try {
      const res = await client.call('inspect_android_method', { path: APK, class_name: cls, method_name: method });
      const text = bodyText(project(res.structured ?? res.text));
      writeFileSync(join(OUT, 'methods', `${label.replace(/[^A-Za-z0-9_.$]/g, '_')}.txt`), text, 'utf8');
      console.log(`${text.length} B`);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 160)}`);
    }
  }
} finally {
  client.close();
  console.log(`${stamp()} done`);
}
