// rea_am_batch28.mjs — where BlendingMode is actually consumed.
//
// The enum's own <clinit> shows SCREEN, MASK, CLIPPING_MASK and EXCLUDE are constructed
// with effectId = null (the 5-arg ctor falls back through the 7-arg default with mask 6),
// while MULTIPLY, DIFF, EXCLUSION carry a `com.alightcreative.blend.*` id and
// usesBackingStore = true. So the modes without an effect id must be composited by hand
// somewhere — that dispatch is the thing the web port got wrong for Screen.
//
// This batch finds the consumers and the blend-factor mapping.
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

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();

  // 1. Who names BlendingMode at all?
  for (const q of ['BlendingMode', 'PorterDuff', 'BlendMode', 'blendFunc', 'Blending']) {
    process.stdout.write(`search ${q} ... `);
    try {
      const res = await client.call('search_android_classes', { path: APK, query: q });
      const p = project(res.structured ?? res.text);
      const hits = (p?.matches ?? []).map((h) => h.name ?? h.qualified_name ?? h).filter(Boolean);
      console.log(`${hits.length}`);
      for (const h of hits.slice(0, 30)) console.log(`   ${h}`);
      save(`search_${safe(q)}.json`, JSON.stringify(p, null, 2));
    } catch (err) {
      console.log(`FAIL ${err.message.slice(0, 60)}`);
    }
  }

  // 2. The enum's own methods: every accessor that hides a decision.
  const ENUM = 'com.alightcreative.app.motion.scene.BlendingMode';
  process.stdout.write(`inspect ${ENUM} ... `);
  try {
    const res = await client.call('inspect_android_class', { path: APK, class_name: ENUM });
    const p = project(res.structured ?? res.text);
    save('class_BlendingMode.json', JSON.stringify(p, null, 2));
    const methods = (p?.reported_signature?.methods ?? p?.methods ?? []).map((m) => m.name ?? m).filter(Boolean);
    console.log(`${methods.length} methods: ${methods.join(' ')}`);
    for (const m of methods) {
      if (/equals|hashCode|toString|values|valueOf|component|copy/i.test(m)) continue;
      for (let ov = 0; ov < 2; ov++) {
        process.stdout.write(`  ${m}#${ov} ... `);
        try {
          const r2 = await client.call('inspect_android_method', {
            path: APK,
            class_name: ENUM,
            method_name: m,
            overload_index: ov,
          });
          const text = bodyText(project(r2.structured ?? r2.text));
          if (!text || text.length > 40000) {
            console.log(`${text ? text.length : 0} B (skip)`);
            if (!text) break;
            continue;
          }
          save(join('methods', `blendmode.${safe(m)}#${ov}.txt`), text);
          console.log(`${text.length} B`);
        } catch {
          console.log('skip');
          break;
        }
      }
    }
  } catch (err) {
    console.log(`FAIL ${err.message.slice(0, 70)}`);
  }
} finally {
  client.close();
}
