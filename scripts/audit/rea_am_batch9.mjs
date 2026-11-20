// rea_am_batch9.mjs — the pieces readEffect delegates to.
//
// readPasses / readShader / visualEffectFromXml settle the <passes> and <shader>
// contract. UserParamParserKt.readUserParams is the authoritative param-tag list.
// ACScriptParserKt.readACScript settles <script>.
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

const V = 'com.alightcreative.app.motion.scene.visualeffect.VisualEffectParserKt';

// [label, class, method, overload]
const METHODS = [
  ['Parser.readPasses', V, 'readPasses', 0],
  ['Parser.readShader', V, 'readShader', 0],
  ['Parser.visualEffectFromXml', V, 'visualEffectFromXml', 0],
  ['Parser.readPresets', V, 'readPresets', 0],
  ['UserParamParserKt.readUserParams', 'com.alightcreative.app.motion.scene.effect.UserParamParserKt', 'readUserParams', 0],
  ['UserParamParserKt', 'com.alightcreative.app.motion.scene.effect.UserParamParserKt', 'readUserParam', 0],
  ['ACScriptParserKt.readACScript', 'com.alightcreative.app.motion.scene.scripting.ACScriptParserKt', 'readACScript', 0],
];

const CLASSES = [
  'com.alightcreative.app.motion.scene.visualeffect.EffectRenderPass',
  'com.alightcreative.app.motion.scene.visualeffect.ShaderInfo',
  'com.alightcreative.app.motion.scene.visualeffect.ShaderGroup',
  'com.alightcreative.app.motion.scene.visualeffect.EffectType',
  'com.alightcreative.app.motion.scene.visualeffect.EffectAffinity',
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();

  for (const cls of CLASSES) {
    process.stdout.write(`class ${cls.split('.').pop()} ... `);
    try {
      const res = await client.call('inspect_android_class', { path: APK, class_name: cls });
      const p = project(res.structured ?? res.text);
      save(`class_${safe(cls)}.json`, JSON.stringify(p, null, 2));
      const methods = p?.reported_signature?.methods ?? p?.methods ?? [];
      const fields = p?.reported_type?.fields ?? p?.fields ?? [];
      console.log(`${fields.length} fields, ${methods.length} methods`);
      const fnames = fields.map((f) => f.name ?? f).filter(Boolean);
      if (fnames.length) console.log(`   fields: ${fnames.slice(0, 24).join(' ')}`);
    } catch (err) {
      console.log(`FAIL ${err.message.slice(0, 70)}`);
    }
  }

  for (const [label, cls, method, ov] of METHODS) {
    process.stdout.write(`method ${label} ... `);
    try {
      const res = await client.call('inspect_android_method', {
        path: APK,
        class_name: cls,
        method_name: method,
        overload_index: ov,
      });
      const text = bodyText(project(res.structured ?? res.text));
      save(join('methods', `${safe(label)}.txt`), text);
      console.log(`${text.length} B`);
    } catch (err) {
      console.log(`FAIL ${err.message.slice(0, 70)}`);
    }
  }
} finally {
  client.close();
}
