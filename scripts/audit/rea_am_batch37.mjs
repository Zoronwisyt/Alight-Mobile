// rea_am_batch37.mjs — O1/O2 spike: find the classes that WRITE the text and stroke
// elements, so the XML spelling is read out of the serializer instead of guessed.
// The APK's string pool gave three attribute-shaped names (lineCap, lineJoin, lineHeight)
// and two effect-param names (letterspacing, linespacing — those belong to text-spacing.xml,
// not to the <text> element). This batch locates the writer that owns them.
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
  for (const q of ['TextElement', 'Stroke', 'Xml', 'Serializer', 'ElementType']) {
    process.stdout.write(`search ${q} ... `);
    try {
      const res = await client.call('search_android_classes', { path: APK, query: q });
      const p = project(res.structured ?? res.text);
      const hits = (p?.matches ?? []).map((h) => h.name ?? h.qualified_name ?? h).filter(Boolean);
      console.log(`${hits.length}`);
      for (const h of hits.slice(0, 40)) console.log(`   ${h}`);
      save(`b37_search_${q}.json`, JSON.stringify(p, null, 2));
    } catch (err) {
      console.log(`FAIL ${err.message.slice(0, 90)}`);
    }
  }
} finally {
  client.close();
}
