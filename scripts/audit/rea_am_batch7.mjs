// rea_am_batch7.mjs — the effect runtime.
//
// The 702 XML files in assets/effects are the authoring surface. This batch finds
// the code that loads them, the class that binds params to uniforms, and the
// script environment, so the authoring guide can be written from the engine, not
// from the XML files alone.
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

function project(p) {
  if (!p) return null;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      return { text: p };
    }
  }
  return p.normalized_result ?? p;
}
function bodyText(d) {
  const s = d?.source ?? d?.text ?? d?.body ?? '';
  if (typeof s === 'string') return s;
  if (s && typeof s.text === 'string') return s.text;
  return JSON.stringify(s, null, 2);
}
const save = (name, text) => writeFileSync(join(OUT, name), text, 'utf8');
const safe = (s) => s.replace(/[^A-Za-z0-9_.$-]/g, '_');

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });

const PKG = 'com.alightcreative.app.motion.scene.visualeffect';
const CLASSES = [
  `${PKG}.VisualEffectDefinition`,
  `${PKG}.VisualEffectDefinitionKt`,
  `${PKG}.VisualEffect`,
  `${PKG}.KeyableVisualEffectRef`,
  `${PKG}.EffectShader`,
  `${PKG}.EffectPass`,
  `${PKG}.EffectParam`,
  `${PKG}.EffectParamType`,
  `${PKG}.EffectLibrary`,
  `${PKG}.EffectLoader`,
  `${PKG}.VisualEffectKt`,
];

try {
  await client.initialize();

  process.stdout.write('package ... ');
  try {
    const res = await client.call('inspect_android_package', { path: APK, package_name: PKG });
    const p = project(res.structured ?? res.text);
    save('package_visualeffect.json', JSON.stringify(p, null, 2));
    const names = (p?.classes ?? p?.types ?? []).map?.((c) => c.name ?? c) ?? [];
    console.log(`${names.length} classes`);
    save('package_visualeffect_names.txt', names.join('\n'), 'utf8');
  } catch (err) {
    console.log(`FAIL ${err.message}`);
  }

  process.stdout.write('search VisualEffect ... ');
  try {
    const res = await client.call('search_android_classes', {
      path: APK,
      query: 'VisualEffect',
    });
    const p = project(res.structured ?? res.text);
    save('search_visualeffect.json', JSON.stringify(p, null, 2));
    const hits = p?.results ?? p?.classes ?? p?.matches ?? [];
    console.log(`${hits.length} hits`);
  } catch (err) {
    console.log(`FAIL ${err.message}`);
  }

  process.stdout.write('classes by name search ...\n');
  for (const q of ['EffectDefinition', 'EffectParam', 'EffectPass', 'EffectShader', 'EffectLibrary', 'EffectLoader', 'VisualEffect']) {
    process.stdout.write(`  search ${q} ... `);
    try {
      const res = await client.call('search_android_classes', { path: APK, query: q });
      const p = project(res.structured ?? res.text);
      save(`search_${safe(q)}.json`, JSON.stringify(p, null, 2));
      const hits = p?.results ?? p?.classes ?? p?.matches ?? p?.items ?? [];
      console.log(`${Array.isArray(hits) ? hits.length : '?'}`);
    } catch (err) {
      console.log(`FAIL ${err.message.slice(0, 80)}`);
    }
  }

  for (const cls of CLASSES) {
    process.stdout.write(`class ${cls.split('.').pop()} ... `);
    try {
      const res = await client.call('inspect_android_class', { path: APK, class_name: cls });
      const p = project(res.structured ?? res.text);
      save(`class_${safe(cls)}.json`, JSON.stringify(p, null, 2));
      const fields = p?.reported_type?.fields?.length ?? p?.fields?.length ?? 0;
      const methods = p?.reported_signature?.methods?.length ?? p?.methods?.length ?? 0;
      console.log(`${fields} fields, ${methods} methods`);
    } catch (err) {
      console.log(`MISSING (${err.message.slice(0, 60)})`);
    }
  }
} finally {
  client.close();
}
