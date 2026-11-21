// rea_am_batch45.mjs — O1: the text element's own serializer.
//
// `trace_android_references` on TextElementKt names exactly one element-type class:
// com.alightcreative.app.motion.scene.TextElementTypeImpl. That is where the `<text>`
// attributes the codec hardcodes (line height, letter spacing, align) are written.
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
const CLS = 'com.alightcreative.app.motion.scene.TextElementTypeImpl';

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  process.stdout.write('class TextElementTypeImpl ... ');
  let methods = [];
  try {
    const res = await client.call('inspect_android_class', { path: APK, class_name: CLS });
    const text = res.text ?? '';
    console.log(`${text.length} chars`);
    save('b45_class_TextElementTypeImpl.txt', text);
    const nr = JSON.parse(text).normalized_result ?? {};
    methods = (nr.methods ?? []).map((m) => m.name);
    console.log(`   methods: ${methods.join(', ')}`);
  } catch (err) {
    console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  const wanted = methods.filter((m) => /serial|write|xml/i.test(m));
  for (const m of wanted) {
    process.stdout.write(`method ${m} ... `);
    try {
      const res = await client.call('inspect_android_method', { path: APK, class_name: CLS, method_name: m });
      console.log(`${(res.text ?? '').length} chars`);
      save(`b45_method_${m}.txt`, res.text ?? '');
    } catch (err) {
      console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
} finally {
  client.close();
}
