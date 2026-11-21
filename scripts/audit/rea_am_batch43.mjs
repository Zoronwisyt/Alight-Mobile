// rea_am_batch43.mjs — O1/O2 answer pass.
//
// Batch 42's class inventory shows exactly the methods that own the dialect:
//   serialize(SceneElement, String, XmlSerializer)
//   serialize(Stroke, String, XmlSerializer)          <- overload 1
//   serializeCommonAttributes(SceneElement, String, XmlSerializer)
//   serializeCommonChildTags(SceneElement, String, XmlSerializer)
//   unserializeStroke(String, XmlPullParser)
// The body of those is the attribute spelling. No guessing left to do once they land.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReaClient } from './rea_client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out', 'rea');
mkdirSync(OUT, { recursive: true });

const NODE = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node.exe';
const SCRIPT =
  'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node_modules\\rea-agents\\scripts\\rea.mjs';
const APK = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\opencode\\AlightMotion-5.0.280-raw.apk';
const ENV = {
  REA_JADX_MCP_JAR: `${process.env.USERPROFILE}\\.local\\share\\rea\\android\\jadx-headless-mcp-0.7.1-all.jar`,
  REA_JADX_OPERATION_TIMEOUT_MS: '900000',
  REA_JADX_HEAP_MIB: '8192',
};

const save = (n, t) => writeFileSync(join(OUT, n), t, 'utf8');
const CLS = 'com.alightcreative.app.motion.scene.SceneElementKt';

const CALLS = [
  ['serialize_element', { class_name: CLS, method_name: 'serialize', overload_index: 0 }],
  ['serialize_stroke', { class_name: CLS, method_name: 'serialize', overload_index: 1 }],
  ['serialize_common_attributes', { class_name: CLS, method_name: 'serializeCommonAttributes', overload_index: 0 }],
  ['serialize_common_child_tags', { class_name: CLS, method_name: 'serializeCommonChildTags', overload_index: 0 }],
  ['unserialize_stroke', { class_name: CLS, method_name: 'unserializeStroke', overload_index: 0 }],
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  for (const [label, args] of CALLS) {
    process.stdout.write(`${label} ... `);
    try {
      const res = await client.call('inspect_android_method', { path: APK, ...args });
      const text = res.text ?? '';
      console.log(`${text.length} chars`);
      save(`b43_${label}.txt`, text);
    } catch (err) {
      console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
} finally {
  client.close();
}
