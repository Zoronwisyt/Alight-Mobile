// rea_am_batch47.mjs — the shape of a keyable attribute, so the writer can be corrected.
//
// Batch 46 settled the edge-decoration dialect:
//   <path-stroke direction [enabled] [cap] [join] [start] [end] end-size ...>
//   <border>, <shadow>, <glow> share the same tag family.
// Every non-geometry value there is written by KeyableSerializerKt.serialize(name) — colour,
// opacity, size, hardness, offset — so that method decides whether a value lands as an
// attribute or as a child <property>. This reads it, plus StyledText, to confirm what the
// text element does and does not carry on disk.
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

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();

  process.stdout.write('class KeyableSerializerKt ... ');
  try {
    const res = await client.call('inspect_android_class', {
      path: APK,
      class_name: 'com.alightcreative.app.motion.scene.KeyableSerializerKt',
    });
    const text = res.text ?? '';
    save('b47_class_KeyableSerializerKt.txt', text);
    const nr = JSON.parse(text).normalized_result ?? {};
    const methods = (nr.methods ?? []).map((m) => `${m.name}/${m.overload_index}`);
    console.log(methods.join(', '));
    for (const m of nr.methods ?? []) {
      if (!/serialize/i.test(m.name)) continue;
      process.stdout.write(`   ${m.name}#${m.overload_index} ... `);
      try {
        const r2 = await client.call('inspect_android_method', {
          path: APK,
          class_name: 'com.alightcreative.app.motion.scene.KeyableSerializerKt',
          method_name: m.name,
          overload_index: m.overload_index,
        });
        console.log(`${(r2.text ?? '').length} chars`);
        save(`b47_method_${m.name}_${m.overload_index}.txt`, r2.text ?? '');
      } catch (err) {
        console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
  } catch (err) {
    console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
  }

  process.stdout.write('class StyledText ... ');
  try {
    const res = await client.call('inspect_android_class', {
      path: APK,
      class_name: 'com.alightcreative.app.motion.scene.StyledText',
    });
    save('b47_class_StyledText.txt', res.text ?? '');
    const nr = JSON.parse(res.text ?? '{}').normalized_result ?? {};
    const fields = (nr.fields ?? []).map((f) => `${f.name}:${f.reported_type}`);
    console.log(fields.join(', '));
  } catch (err) {
    console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 140)}`);
  }
} finally {
  client.close();
}
