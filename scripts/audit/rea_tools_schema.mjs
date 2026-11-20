// rea_tools_schema.mjs — dump the input schema for the Android-lane tools.
import { ReaClient } from './rea_client.mjs';

const NODE = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node.exe';
const SCRIPT =
  'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node_modules\\rea-agents\\scripts\\rea.mjs';
const ENV = {
  REA_JADX_MCP_JAR: `${process.env.USERPROFILE}\\.local\\share\\rea\\android\\jadx-headless-mcp-0.7.1-all.jar`,
  REA_JADX_OPERATION_TIMEOUT_MS: '600000',
  REA_JADX_HEAP_MIB: '8192',
};
const WANT = process.argv.slice(2);

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  await client.initialize();
  const tools = await client.listTools();
  for (const t of tools) {
    if (WANT.length && !WANT.includes(t.name)) continue;
    console.log(`\n### ${t.name}`);
    console.log(JSON.stringify(t.inputSchema ?? t.input_schema ?? {}, null, 2));
  }
} finally {
  client.close();
}
