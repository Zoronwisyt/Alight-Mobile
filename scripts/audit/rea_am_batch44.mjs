// rea_am_batch44.mjs — O1: locate the text element's writer.
//
// Batch 43 proved the shared attributes and the stroke tag, but `serialize(SceneElement…)`
// is a 322-char dispatcher and the text-specific attributes are written by the per-type
// serializer. This searches for the classes that would own it, then traces TextElementKt's
// callers so the writer is found rather than guessed.
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
const save = (n, t) => writeFileSync(join(OUT, n), t, 'utf8');

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  for (const q of ['Text', 'StyledText', 'ElementTypeImpl', 'Properties']) {
    process.stdout.write(`search ${q} ... `);
    try {
      const res = await client.call('search_android_classes', { path: APK, query: q });
      const p = project(res.structured ?? res.text);
      const hits = (p?.matches ?? []).map((h) => h.qualified_name ?? h.name ?? h).filter(Boolean);
      const am = hits.filter((h) => String(h).includes('alightcreative'));
      console.log(`${hits.length} total, ${am.length} am`);
      for (const h of am.slice(0, 40)) console.log(`   ${h}`);
      save(`b44_search_${q}.json`, JSON.stringify(p, null, 2));
    } catch (err) {
      console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  process.stdout.write('trace TextElementKt ... ');
  try {
    const res = await client.call('trace_android_references', {
      path: APK,
      class_name: 'com.alightcreative.app.motion.scene.TextElementKt',
    });
    console.log(`${(res.text ?? '').length} chars`);
    save('b44_trace_textelementkt.txt', res.text ?? '');
  } catch (err) {
    console.log(`FAIL ${err.message.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
} finally {
  client.close();
}
