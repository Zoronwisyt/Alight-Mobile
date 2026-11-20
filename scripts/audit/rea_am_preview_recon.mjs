// rea_am_preview_recon.mjs — class-family recon for the playback preview surface.
//
// One APK session, six questions. Everything lands in scripts/audit/out/rea/.
import { mkdirSync, writeFileSync } from 'node:fs';
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

const save = (name, value) => {
  const path = join(OUT, name);
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
  console.log(`  wrote ${name}`);
};

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

try {
  await client.initialize();
  console.log(`${stamp()} session up`);

  // 1. Package identity. Complete detail: the decoded manifest is the only place
  //    the preview activity's launch and surface type are declared.
  process.stdout.write(`${stamp()} inspect_android_package ... `);
  const pkg = await client.call('inspect_android_package', { path: APK, detail: 'complete' });
  console.log(`${pkg.text.length} B`);
  save('package.json', pkg.structured ?? pkg.text);

  // 2-6. Class families. Names are the only thing a release build leaves intact
  //      beyond method bodies, so the families are searched before any inspection.
  const families = [
    ['preview', 'preview'],
    ['playback', 'playback'],
    ['player', 'Player'],
    ['play', 'Play'],
    ['render', 'Render'],
    ['frame', 'Frame'],
    ['engine', 'com.alightcreative.engine'],
    ['scene', 'com.alightcreative.scene'],
  ];
  let cursorHints = {};
  for (const [tag, query] of families) {
    process.stdout.write(`${stamp()} search_android_classes "${query}" ... `);
    try {
      const res = await client.call('search_android_classes', { path: APK, query });
      const data = res.structured ?? res.text;
      const matches = data?.matches ?? data?.results ?? [];
      console.log(`${Array.isArray(matches) ? matches.length : '?'} matches`);
      save(`classes_${tag}.json`, { query, raw: data });
    } catch (err) {
      console.log(`FAILED: ${err.message.slice(0, 200)}`);
      save(`classes_${tag}.error.json`, { query, error: err.message });
    }
  }
} finally {
  client.close();
  console.log(`${stamp()} done`);
}
