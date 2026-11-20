// rea_probe.mjs — smoke test: initialize the REA MCP server and list its tools.
import { ReaClient } from './rea_client.mjs';

const NODE = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node.exe';
const SCRIPT = 'C:\\Users\\jeduc\\AppData\\Local\\Temp\\rea-node\\node-v24.22.3-win-x64\\node_modules\\rea-agents\\scripts\\rea.mjs';
const ENV = {
  REA_JADX_MCP_JAR: `${process.env.USERPROFILE}\\.local\\share\\rea\\android\\jadx-headless-mcp-0.7.1-all.jar`,
  REA_JADX_OPERATION_TIMEOUT_MS: '600000',
  REA_JADX_HEAP_MIB: '8192',
};

const client = new ReaClient({ nodePath: NODE, scriptPath: SCRIPT, env: ENV });
try {
  const init = await client.initialize();
  console.log('server:', JSON.stringify(init.serverInfo ?? init));
  const tools = await client.listTools();
  console.log('tool count:', tools.length);
  const android = tools.filter((t) => /android|apk/i.test(t.name));
  for (const t of android) console.log(' -', t.name);
} finally {
  client.close();
}
