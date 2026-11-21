// rea_am_batch42.mjs — O1/O2: the element writer itself.
//
// `trace_android_references` on StrokeCap returns exactly four AM classes:
// SceneElementKt, StrokeKt, EdgeDecorationKt and KeyableEdgeDecoration. SceneElementKt is
// the one that would write attributes for every element type, so it is the likely home of
// both the stroke attributes and the text attributes the codec does not know.
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

const CLASSES = [
  'com.alightcreative.app.motion.scene.SceneElementKt',
  'com.alightcreative.app.motion.scene.EdgeDecorationKt',
  'com.alightcreative.app.motion.scene.KeyableEdgeDecoration',
];

const METHODS = [
  ['com.alightcreative.app.motion.scene.SceneElementKt', 'toXml'],
  ['com.alightcreative.app.motion.scene.SceneElementKt', 'write'],
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  for (const fqn of CLASSES) {
    const short = fqn.split('.').pop();
    process.stdout.write(`class ${short} ... `);
    try {
      const res = await client.call('inspect_android_class', { path: APK, class_name: fqn });
      const text = res.text ?? '';
      console.log(`${text.length} chars`);
      save(`b42_class_${short}.txt`, text);
    } catch (err) {
      console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
  for (const [cls, m] of METHODS) {
    process.stdout.write(`method ${cls.split('.').pop()}.${m} ... `);
    try {
      const res = await client.call('inspect_android_method', { path: APK, class_name: cls, method_name: m });
      console.log(`${(res.text ?? '').length} chars`);
      save(`b42_method_${m}.txt`, res.text ?? '');
    } catch (err) {
      console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
} finally {
  client.close();
}
