// rea_am_methods.mjs — decompile the playback-preview method bodies.
//
// Selection rule: only methods whose body encodes a decision the web port must
// reproduce (mode dispatch, time quantization, Z order, matrix fit, cache reuse).
// Bodies are written whole to scripts/audit/out/rea/methods/ and a head is printed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReaClient } from './rea_client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out', 'rea', 'methods');
mkdirSync(OUT, { recursive: true });

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

const R = 'com.alightcreative.app.motion.scene.rendering.SceneRenderingKt';
const E = 'com.alightcreative.app.motion.scene.rendering.SceneElementRenderingKt';
const T = 'com.alightcreative.app.motion.scene.rendering.RenderEnvironmentTimeQuant';
const L = 'com.alightcreative.app.motion.scene.rendering.GlobalSceneRenderLock';
const A = 'com.alightcreative.app.motion.scene.rendering.RenderEnvironmentAdj';
const K = 'com.alightcreative.app.motion.scene.rendering.RenderEnvironmentKt';

const TARGETS = [
  [R, 'getRenderEnvFromCache'],
  [R, 'returnRenderEnvToCache'],
  [R, 'renderWithGpu', 0],
  [R, 'renderWithGpu$lambda$29$sortByZ', 0],
  [R, 'renderWithGpu$lambda$29$adjustMatrix', 0],
  [R, 'renderWithGpu$lambda$29$clearBackground', 0],
  [E, 'renderInternal', 0],
  [E, 'renderWithEffects', 0],
  [E, 'renderWithRepeat', 0],
  [T, 'getTime', 0],
  [L, '<clinit>', 0],
  [K, 'withMode', 0],
  [K, 'withTimingForElement', 0],
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const index = [];

try {
  await client.initialize();
  console.log(`${stamp()} session up`);

  for (const [className, methodName, overloadIndex] of TARGETS) {
    const label = `${className.split('.').pop()}.${methodName}`;
    process.stdout.write(`${stamp()} ${label} ... `);
    const args = { path: APK, class_name: className, method_name: methodName };
    if (overloadIndex !== undefined) args.overload_index = overloadIndex;
    try {
      const res = await client.call('inspect_android_method', args);
      const data = project(res.structured ?? res.text);
      const src = data?.source ?? data?.body ?? '';
      const safe = label.replace(/[^A-Za-z0-9_.$]/g, '_');
      writeFileSync(join(OUT, `${safe}.txt`), typeof src === 'string' ? src : JSON.stringify(src, null, 2), 'utf8');
      writeFileSync(join(OUT, `${safe}.meta.json`), JSON.stringify({
        class_name: className,
        method_name: methodName,
        overload_index: overloadIndex,
        representation: data?.representation,
        body_status: data?.body_status,
        dex_descriptor: data?.dex_descriptor,
        truncated: data?.source_coverage ?? data?.coverage ?? null,
        bytes: typeof src === 'string' ? src.length : 0,
      }, null, 2), 'utf8');
      index.push({ label, bytes: typeof src === 'string' ? src.length : 0, status: data?.body_status ?? 'ok' });
      console.log(`${typeof src === 'string' ? src.length : 0} B  status=${data?.body_status ?? 'ok'} rep=${data?.representation ?? '?'}`);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 200)}`);
      index.push({ label, error: err.message.slice(0, 400) });
    }
  }
  writeFileSync(join(OUT, '_index.json'), JSON.stringify(index, null, 2), 'utf8');
} finally {
  client.close();
  console.log(`${stamp()} done`);
}
