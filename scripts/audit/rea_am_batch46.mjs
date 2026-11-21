// rea_am_batch46.mjs — O2: where cap / join / dash actually live.
//
// Batch 43 settled <stroke color width type points> — and `type` there is the drawing TOOL
// (pen/eraser), not a cap. Batch 41 settled the id vocabulary (butt|round|square,
// miter|round|bevel, and 13 edge-decoration ids). This pass reads the shape serializer and
// the edge-decoration serializer, which is where those ids must be written.
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
  'com.alightcreative.app.motion.scene.ShapeElementTypeImpl',
  'com.alightcreative.app.motion.scene.EdgeDecorationKt',
  'com.alightcreative.app.motion.scene.KeyableEdgeDecoration',
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  for (const fqn of CLASSES) {
    const short = fqn.split('.').pop();
    process.stdout.write(`class ${short} ... `);
    let methods = [];
    try {
      const res = await client.call('inspect_android_class', { path: APK, class_name: fqn });
      const text = res.text ?? '';
      save(`b46_class_${short}.txt`, text);
      const nr = JSON.parse(text).normalized_result ?? {};
      methods = (nr.methods ?? []).map((m) => m.name);
      const ser = methods.filter((m) => /serial|write/i.test(m));
      console.log(`${methods.length} methods; serialize-ish: ${ser.join(', ') || 'none'}`);
      for (const m of ser) {
        process.stdout.write(`   ${m} ... `);
        try {
          const r2 = await client.call('inspect_android_method', { path: APK, class_name: fqn, method_name: m });
          console.log(`${(r2.text ?? '').length} chars`);
          save(`b46_method_${short}_${m}.txt`, r2.text ?? '');
        } catch (err) {
          console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 120)}`);
        }
      }
    } catch (err) {
      console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
} finally {
  client.close();
}
