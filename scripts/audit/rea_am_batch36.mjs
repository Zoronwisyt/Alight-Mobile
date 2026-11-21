// rea_am_batch36.mjs — the GL state wrappers, where a native blend (Screen) would live.
//
// There is no `com.alightcreative.blend.screen` anywhere in the APK: 24 blend effect ids in
// the dex, 24 blend*.xml assets, and the enum constructs SCREEN with effectId = null. So
// Screen, Mask, Clipping Mask and Exclude are composited by the renderer itself. beginLayer
// already shows glEnable(GL_STENCIL_TEST) + glClearStencil(0), so the mask pair is the
// stencil. Screen must be a blend-factor call, and the factor constants live in the gl
// package.
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
  for (const q of ['GLUtil', 'GLState', 'GLCanvas', 'RenderPass', 'Framebuffer', 'Stencil', 'Aabb', 'gl']) {
    process.stdout.write(`search ${q} ... `);
    try {
      const res = await client.call('search_android_classes', { path: APK, query: q });
      const p = project(res.structured ?? res.text);
      const hits = (p?.matches ?? []).map((h) => h.name ?? h.qualified_name ?? h).filter(Boolean);
      console.log(`${hits.length}`);
      for (const h of hits.slice(0, 20)) console.log(`   ${h}`);
      save(`search_gl_${q.replace(/[^A-Za-z0-9]/g, '_')}.json`, JSON.stringify(p, null, 2));
    } catch (err) {
      console.log(`FAIL ${err.message.slice(0, 60)}`);
    }
  }
} finally {
  client.close();
}
