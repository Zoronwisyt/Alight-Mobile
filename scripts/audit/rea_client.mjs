// rea_client.mjs — minimal stdio JSON-RPC client for the REA MCP server.
//
// Why not the CLI: every `rea <command>` one-shot pays a cold JADX load of the
// 194 MB multidex APK. The MCP server keeps one immutable APK session alive, so
// a batch of twenty questions costs one load instead of twenty.
//
// Transport: newline-delimited JSON-RPC 2.0 on stdio (no Content-Length framing).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class ReaClient {
  constructor({ nodePath, scriptPath, env }) {
    this.child = spawn(nodePath, [scriptPath, 'mcp'], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.nextId = 1;
    this.pending = new Map();
    this.stderrTail = '';
    this.closed = false;

    this.child.stderr.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-8000);
    });
    this.child.on('exit', (code) => {
      this.closed = true;
      for (const [, entry] of this.pending) {
        entry.reject(new Error(`rea mcp exited (code ${code}): ${this.stderrTail}`));
      }
      this.pending.clear();
    });

    const rl = createInterface({ input: this.child.stdout });
    rl.on('line', (line) => {
      const text = line.trim();
      if (!text) return;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return; // server may log non-JSON progress lines to stdout
      }
      if (msg.id === undefined || msg.id === null) return; // notification
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message ?? 'mcp error');
        err.data = msg.error.data;
        err.code = msg.error.code;
        entry.reject(err);
      } else {
        entry.resolve(msg.result);
      }
    });
  }

  request(method, params, timeoutMs = 900_000) {
    if (this.closed) return Promise.reject(new Error('rea mcp already exited'));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.child.stdin.write(payload);
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async initialize() {
    const protocols = ['2025-06-18', '2025-03-26', '2024-11-05'];
    let lastErr;
    for (const protocolVersion of protocols) {
      try {
        const res = await this.request('initialize', {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: 'am-web-audit', version: '1.0.0' },
        });
        this.notify('notifications/initialized', {});
        return res;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  async listTools() {
    const out = [];
    let cursor;
    do {
      const res = await this.request('tools/list', cursor ? { cursor } : {});
      out.push(...(res.tools ?? []));
      cursor = res.nextCursor;
    } while (cursor);
    return out;
  }

  async call(name, args) {
    const res = await this.request('tools/call', { name, arguments: args });
    const text = (res.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    if (res.isError) {
      const err = new Error(`tool ${name} failed: ${text.slice(0, 2000)}`);
      err.text = text;
      throw err;
    }
    return { text, structured: res.structuredContent ?? null };
  }

  close() {
    try { this.child.stdin.end(); } catch { /* already gone */ }
    try { this.child.kill(); } catch { /* already gone */ }
  }
}
