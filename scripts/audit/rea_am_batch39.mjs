// rea_am_batch39.mjs — list the REA server's advertised tools. Batch 38 guessed
// `get_android_class` and the server refused it, so ask instead of guessing.
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
const ENV = {
  REA_JADX_MCP_JAR: `${process.env.USERPROFILE}\\.local\\share\\rea\\android\\jadx-headless-mcp-0.7.1-all.jar`,
  REA_JADX_OPERATION_TIMEOUT_MS: '900000',
  REA_JADX_HEAP_MIB: '8192',
};

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  const tools = await client.listTools();
  const list = Array.isArray(tools) ? tools : (tools?.tools ?? []);
  for (const t of list) {
    const name = t.name ?? t;
    const desc = (t.description ?? '').replace(/\s+/g, ' ').slice(0, 110);
    console.log(`${name}${desc ? `  — ${desc}` : ''}`);
  }
  writeFileSync(join(OUT, 'b39_tools.json'), JSON.stringify(list, null, 2), 'utf8');
} finally {
  client.close();
}
