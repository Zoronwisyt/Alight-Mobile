// rea_am_packages.mjs — map the app's own package tree, then persist the member
// inventory of every class in the scene-rendering package.
//
// `com.alightcreative.app.motion` is the release package root; the R8 build keeps
// package paths intact while renaming members, so packages are the reliable index.
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

function project(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return { text: payload }; }
  }
  return payload.normalized_result ?? payload;
}

const save = (name, value) => {
  writeFileSync(join(OUT, name), JSON.stringify(value, null, 2), 'utf8');
};

// Packages worth mapping. Each query is a case-sensitive substring on the class
// name, so a package query returns that package plus every subpackage.
const PACKAGES = [
  'com.alightcreative.app.motion.',
  'com.alightcreative.app.motion.scene.rendering',
  'com.alightcreative.app.motion.activities',
  'com.alightcreative.app.motion.scene',
  'com.alightcreative.app.motion.player',
  'com.alightcreative.app.motion.preview',
  'com.alightcreative.app.motion.gl',
  'com.alightcreative.app.motion.video',
  'com.alightcreative.app.motion.ui',
  'com.alightcreative.app.motion.editor',
];

// Classes whose member inventory is the evidence we came for.
const CLASS_TARGETS = [
  'com.alightcreative.app.motion.scene.rendering.RenderEnvironment',
  'com.alightcreative.app.motion.scene.rendering.RenderEnvironmentImpl',
  'com.alightcreative.app.motion.scene.rendering.RenderEnvironmentAdj',
  'com.alightcreative.app.motion.scene.rendering.RenderEnvironmentAltMode',
  'com.alightcreative.app.motion.scene.rendering.RenderEnvironmentForElement',
  'com.alightcreative.app.motion.scene.rendering.RenderEnvironmentTimeOffset',
  'com.alightcreative.app.motion.scene.rendering.RenderEnvironmentTimeQuant',
  'com.alightcreative.app.motion.scene.rendering.RenderEnvironmentKt',
  'com.alightcreative.app.motion.scene.rendering.RenderMode',
  'com.alightcreative.app.motion.scene.rendering.GlobalSceneRenderLock',
  'com.alightcreative.app.motion.scene.rendering.TextureCropMode',
  'com.alightcreative.app.motion.scene.rendering.TextureCropModeKt',
  'com.alightcreative.app.motion.scene.rendering.SceneRenderingKt',
  'com.alightcreative.app.motion.scene.rendering.SceneElementRenderingKt',
  'com.alightcreative.app.motion.scene.FrameStats',
];

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

try {
  await client.initialize();
  console.log(`${stamp()} session up`);

  const tree = {};
  for (const pkg of PACKAGES) {
    process.stdout.write(`${stamp()} ${pkg} ... `);
    try {
      const res = await client.call('search_android_classes', { path: APK, query: pkg });
      const data = project(res.structured ?? res.text);
      const matches = data?.matches ?? [];
      tree[pkg] = matches;
      console.log(`${matches.length}`);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 120)}`);
      tree[pkg] = { error: err.message };
    }
  }
  save('package_tree.json', tree);

  // Subpackage census: collapse the app tree into directory buckets so the
  // document can cite "9 classes in .scene.rendering" instead of a raw list.
  const appClasses = tree['com.alightcreative.app.motion.'] ?? [];
  const buckets = new Map();
  for (const name of appClasses) {
    const parts = name.split('.');
    const sub = parts.slice(4, -1).join('.') || '(root)';
    buckets.set(sub, (buckets.get(sub) ?? 0) + 1);
  }
  const census = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
  save('package_census.json', { total: appClasses.length, buckets: census });
  console.log(`${stamp()} app classes: ${appClasses.length}, subpackages: ${buckets.size}`);

  for (const cls of CLASS_TARGETS) {
    process.stdout.write(`${stamp()} inspect ${cls.split('.').pop()} ... `);
    try {
      const res = await client.call('inspect_android_class', { path: APK, class_name: cls });
      const data = project(res.structured ?? res.text);
      const short = cls.split('.').pop();
      save(`class_${short}.json`, data);
      const fields = data?.fields?.length ?? 0;
      const methods = data?.methods?.length ?? 0;
      console.log(`fields=${fields} methods=${methods}`);
    } catch (err) {
      console.log(`FAILED ${err.message.slice(0, 140)}`);
      save(`class_${cls.split('.').pop()}.error.json`, { error: err.message });
    }
  }
} finally {
  client.close();
  console.log(`${stamp()} done`);
}
