// rea_am_batch2.mjs — second pass: the decisions behind the preview pipeline.
//
// Pass one found the call graph of SceneRenderingKt.renderWithGpu. This pass
// resolves the leaves that the web port has to reproduce exactly:
//   - RenderMode ordinal values (which mode gets which clear behaviour)
//   - the preview-quality enum (fi.lG) and its scale function (fi.Uf.g)
//   - camera defaults and active-camera selection
//   - element fractional time and layer parenting
//   - clipping-mask consumers
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

const save = (name, value) => writeFileSync(join(OUT, name), JSON.stringify(value, null, 2), 'utf8');
/**
 * Method Evidence nests the body as { status, text }: `source` is either the body
 * string (older shape) or a coverage envelope around `text`. Flatten both.
 */
function bodyText(data) {
  const src = data?.source ?? data?.text ?? data?.body ?? '';
  if (typeof src === 'string') return src;
  if (src && typeof src.text === 'string') return src.text;
  return JSON.stringify(src, null, 2);
}

const S = 'com.alightcreative.app.motion.scene';

const CLASSES = [
  'fi.lG',
  'fi.Uf',
  'fi.bN',
  `${S}.BlendingMode`,
  `${S}.CameraProperties`,
  `${S}.CameraElementKt`,
  `${S}.SceneElementKt`,
  `${S}.LayerParentingKt`,
  `${S}.scripting.ScriptExecutorKt`,
  `${S}.SceneElement`,
  `${S}.SceneElementType`,
  `${S}.timemapping`,
];

const METHODS = [
  [`${S}.rendering.RenderMode`, '<clinit>'],
  [`${S}.rendering.RenderMode`, 'values'],
  ['fi.Uf', 'g'],
  ['fi.lG', 's'],
  ['fi.lG', 'dMq'],
  [`${S}.CameraElementKt`, 'makeDefaultCamera'],
  [`${S}.CameraElementKt`, 'getActiveCameraAtTime'],
  [`${S}.CameraElementKt`, 'getCameraTransform'],
  [`${S}.SceneElementKt`, 'fractionalTime'],
  [`${S}.LayerParentingKt`, 'applyLayerParenting'],
  [`${S}.LayerParentingKt`, 'checkParent'],
  [`${S}.BlendingMode`, 'getUsesBackingStore'],
  [`${S}.BlendingMode`, '<clinit>'],
];

const TRACES = [`${S}.SceneElement`];

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
      save(`class_${cls.replace(/\./g, '_')}.json`, data);
      console.log(`fields=${data?.fields?.length ?? 0} methods=${data?.methods?.length ?? 0}`);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 120)}`);
    }
  }

  for (const [cls, method] of METHODS) {
    const label = `${cls.split('.').pop()}.${method}`;
    process.stdout.write(`${stamp()} method ${label} ... `);
    try {
      const res = await client.call('inspect_android_method', {
        path: APK, class_name: cls, method_name: method,
      });
      const data = project(res.structured ?? res.text);
      const text = bodyText(data);
      writeFileSync(join(OUT, 'methods', `${label.replace(/[^A-Za-z0-9_.$]/g, '_')}.txt`), text, 'utf8');
      console.log(`${text.length} B`);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 160)}`);
    }
  }

  // Who reads SceneElement.clippingMask — the mask binding question.
  for (const cls of TRACES) {
    process.stdout.write(`${stamp()} trace refs ${cls} ... `);
    try {
      const res = await client.call('trace_android_references', {
        path: APK, class_name: cls, method_name: 'getClippingMask',
      });
      const data = project(res.structured ?? res.text);
      save('trace_clippingMask.json', data);
      const nodes = data?.using_nodes ?? data?.references ?? data?.nodes ?? [];
      console.log(`${Array.isArray(nodes) ? nodes.length : '?'} using nodes`);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 160)}`);
    }
  }
} finally {
  client.close();
  console.log(`${stamp()} done`);
}
