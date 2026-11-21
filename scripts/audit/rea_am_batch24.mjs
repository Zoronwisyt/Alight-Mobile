// rea_am_batch24.mjs — the real font package: com.alightcreative.app.motion.fonts.
//
// Batch 23 found the package; the earlier obfuscated FQN was wrong. B8K is the
// font-token resolver namespace, BWM is what TextElementKt calls as
// BWM.Rw(String, long). This batch pulls the token grammar out of the resolution
// path so the web importer can normalise every legal token form.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReaClient } from './rea_client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out', 'rea');
mkdirSync(join(OUT, 'methods'), { recursive: true });

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
const bodyText = (d) => {
  const s = d?.source ?? d?.text ?? d?.body ?? '';
  if (typeof s === 'string') return s;
  if (s && typeof s.text === 'string') return s.text;
  return JSON.stringify(s, null, 2);
};
const safe = (s) => s.replace(/[^A-Za-z0-9_.$-]/g, '_');
const save = (n, t) => writeFileSync(join(OUT, n), t, 'utf8');

const CLASSES = [
  'com.alightcreative.app.motion.fonts.B8K',
  'com.alightcreative.app.motion.fonts.B8K.BWM',
  'com.alightcreative.app.motion.fonts.Bb',
  'com.alightcreative.app.motion.fonts.SfT',
  'com.alightcreative.app.motion.fonts.fs',
  'com.alightcreative.app.motion.fonts.mY0',
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();

  for (const cls of CLASSES) {
    process.stdout.write(`class ${cls} ... `);
    let p;
    try {
      const res = await client.call('inspect_android_class', { path: APK, class_name: cls });
      p = project(res.structured ?? res.text);
    } catch (err) {
      console.log(`FAIL ${err.message.slice(0, 70)}`);
      continue;
    }
    save(`class_${safe(cls)}.json`, JSON.stringify(p, null, 2));
    const methods = (p?.reported_signature?.methods ?? p?.methods ?? []).map((m) => m.name ?? m).filter(Boolean);
    const fields = (p?.reported_type?.fields ?? p?.fields ?? []).map((f) => f.name ?? f).filter(Boolean);
    console.log(`${methods.length}m/${fields.length}f`);
    if (methods.length) console.log(`   m: ${methods.slice(0, 24).join(' ')}`);

    for (const m of methods) {
      if (/equals|hashCode|toString|component|copy|get\$|access\$|<clinit>/i.test(m)) continue;
      for (let ov = 0; ov < 3; ov++) {
        process.stdout.write(`  ${m}#${ov} ... `);
        try {
          const r2 = await client.call('inspect_android_method', {
            path: APK,
            class_name: cls,
            method_name: m,
            overload_index: ov,
          });
          const text = bodyText(project(r2.structured ?? r2.text));
          if (!text || text.length > 80000) {
            console.log(`${text ? text.length : 0} B (skip)`);
            if (!text) break;
            continue;
          }
          save(join('methods', `font.${safe(cls)}.${safe(m)}#${ov}.txt`), text);
          console.log(`${text.length} B`);
        } catch {
          console.log('skip');
          break;
        }
      }
    }
  }
} finally {
  client.close();
}
