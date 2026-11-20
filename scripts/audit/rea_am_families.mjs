// rea_am_families.mjs — inventory the class families that make up the editor and
// the playback preview, then persist the member inventory of the key classes.
//
// The release APK is R8-shrunk: package paths survive, member names mostly do not.
// So the recon order is package -> class -> method body, never name guessing.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReaClient } from './rea_client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out', 'rea');
mkdirSync(OUT, { recursive: true });

const NODE = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node.exe';
const SCRIPT = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node_modules\\rea-agents\\scripts\\rea.mjs';
const APK = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\opencode\\AlightMotion-5.0.280-raw.apk';
const ENV = {
  REA_JADX_MCP_JAR: `${process.env.USERPROFILE}\\.local\\share\\rea\\android\\jadx-headless-mcp-0.7.1-all.jar`,
  REA_JADX_OPERATION_TIMEOUT_MS: '900000',
  REA_JADX_HEAP_MIB: '8192',
};

/** Tool results arrive as Evidence: the useful projection is normalized_result. */
function project(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return { text: payload }; }
  }
  return payload.normalized_result ?? payload;
}

const save = (name, value) => {
  const path = join(OUT, name);
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
  return path;
};

const QUERIES = [
  ['maineditor', 'com.alightcreative.maineditor'],
  ['editor', 'com.alightcreative.editor'],
  ['engine', 'com.alightcreative.engine'],
  ['render', 'render'],
  ['surface', 'Surface'],
  ['player', 'Player'],
  ['composition', 'Composition'],
  ['frame', 'Frame'],
  ['gl', 'Gl'],
  ['play', 'play'],
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

const summary = {};

try {
  await client.initialize();
  console.log(`${stamp()} session up`);

  for (const [tag, query] of QUERIES) {
    process.stdout.write(`${stamp()} "${query}" ... `);
    try {
      const res = await client.call('search_android_classes', { path: APK, query });
      const data = project(res.structured ?? res.text);
      const matches = data?.matches ?? [];
      summary[tag] = { query, total_classes: data?.total_classes, count: matches.length, matches };
      console.log(`${matches.length} matches`);
      save(`fam_${tag}.json`, summary[tag]);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 160)}`);
      summary[tag] = { query, error: err.message };
    }
  }

  // Collapse every family into one sorted inventory so the next run can pick
  // targets without re-searching.
  const all = new Map();
  for (const [tag, v] of Object.entries(summary)) {
    for (const name of v.matches ?? []) {
      if (!all.has(name)) all.set(name, []);
      all.get(name).push(tag);
    }
  }
  const inventory = [...all.entries()]
    .map(([name, tags]) => ({ name, tags }))
    .sort((a, b) => a.name.localeCompare(b.name));
  save('class_inventory.json', { generated: new Date().toISOString(), classes: inventory });
  console.log(`${stamp()} inventory: ${inventory.length} unique classes`);

  // Anything that reads like the preview/playback surface, for eyeballing.
  const hot = inventory.filter((c) =>
    /preview|playback|player|render|compositor|surface|egl|frame|display|composition|gl/i.test(c.name)
  );
  save('class_inventory_hot.json', { count: hot.length, classes: hot });
  console.log(`${stamp()} hot candidates: ${hot.length}`);
  for (const c of hot.slice(0, 80)) console.log('   ', c.name);
} finally {
  client.close();
  console.log(`${stamp()} done`);
}
