// rea_am_batch40.mjs — O1/O2: read the AM XML writer, don't guess the dialect.
//
// REA 6.10.1 advertises `inspect_android_class` (methods, fields, DEX prototypes, encoded
// static finals), not the older `get_android_class` name batch 38 guessed. The scene writer
// is `SceneSerializerKt`; `TextElementKt` and `StrokeKt` own the elements whose attribute
// spellings src/engine/amXmlCodec.ts does not know.
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

const TARGETS = [
  'com.alightcreative.app.motion.scene.serializer.SceneSerializerKt',
  'com.alightcreative.app.motion.scene.TextElementKt',
  'com.alightcreative.app.motion.scene.StrokeKt',
  'com.alightcreative.app.motion.scene.Stroke',
  'com.alightcreative.app.motion.scene.StrokeCap',
  'com.alightcreative.app.motion.scene.StrokeJoin',
  'com.alightcreative.app.motion.scene.StrokeEnd',
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  for (const fqn of TARGETS) {
    const short = fqn.split('.').pop();
    process.stdout.write(`${short} ... `);
    try {
      const res = await client.call('inspect_android_class', { path: APK, class_name: fqn });
      const text = res.text ?? JSON.stringify(project(res.structured), null, 2);
      console.log(`${text.length} chars`);
      writeFileSync(join(OUT, `b40_${short}.json`), JSON.stringify(project(res.structured) ?? { text }, null, 2), 'utf8');
      writeFileSync(join(OUT, `b40_${short}.txt`), text, 'utf8');
    } catch (err) {
      console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
} finally {
  client.close();
}
