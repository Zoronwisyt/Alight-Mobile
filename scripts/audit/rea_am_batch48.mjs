// rea_am_batch48.mjs — last piece for the stroke fix: the direction vocabulary.
//
// KeyableEdgeDecoration's `<path-stroke>` always writes `direction`, and only writes
// cap/join/start/end when they differ from the caller's default. So the defaults and the
// enum ids are needed before the exporter can emit an element AM will accept. Also pulls
// EdgeDecorationType and EdgeDecorationDirection <clinit> bodies.
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
  'com.alightcreative.app.motion.scene.EdgeDecorationDirection',
  'com.alightcreative.app.motion.scene.EdgeDecorationType',
  'com.alightcreative.app.motion.scene.StyledTextAlign',
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
      save(`b48_class_${short}.txt`, text);
      const nr = JSON.parse(text).normalized_result ?? {};
      const fields = (nr.fields ?? []).map((f) => f.name);
      console.log(`fields: ${fields.join(', ')}`);
      process.stdout.write(`   <clinit> ... `);
      try {
        const r2 = await client.call('inspect_android_method', {
          path: APK,
          class_name: fqn,
          method_name: '<clinit>',
        });
        console.log(`${(r2.text ?? '').length} chars`);
        save(`b48_${short}_clinit.txt`, r2.text ?? '');
      } catch (err) {
        console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    } catch (err) {
      console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
} finally {
  client.close();
}
