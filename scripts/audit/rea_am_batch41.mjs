// rea_am_batch41.mjs — O2: the stroke vocabulary as the APK writes it.
//
// StrokeCap / StrokeJoin / StrokeEnd are Kotlin enums that each carry a `String id`
// (verified in batch 40: fields Butt/Round/Square + `id`). `<clinit>` constructs them,
// so the id literals ARE the XML spelling. Also traces who references StrokeCap, which
// is how the element writer gets located instead of guessed.
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

const METHODS = [
  ['com.alightcreative.app.motion.scene.StrokeCap', '<clinit>'],
  ['com.alightcreative.app.motion.scene.StrokeJoin', '<clinit>'],
  ['com.alightcreative.app.motion.scene.StrokeEnd', '<clinit>'],
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  for (const [cls, method] of METHODS) {
    const short = cls.split('.').pop();
    process.stdout.write(`${short}.${method} ... `);
    try {
      const res = await client.call('inspect_android_method', {
        path: APK,
        class_name: cls,
        method_name: method,
      });
      const text = res.text ?? '';
      console.log(`${text.length} chars`);
      save(`b41_${short}_clinit.txt`, text);
    } catch (err) {
      console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
  process.stdout.write('trace StrokeCap ... ');
  try {
    const res = await client.call('trace_android_references', {
      path: APK,
      class_name: 'com.alightcreative.app.motion.scene.StrokeCap',
    });
    console.log(`${(res.text ?? '').length} chars`);
    save('b41_trace_strokecap.txt', res.text ?? '');
  } catch (err) {
    console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
} finally {
  client.close();
}
