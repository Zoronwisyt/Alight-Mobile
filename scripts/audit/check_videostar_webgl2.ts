import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildVertexSource, buildFragmentSource } from '../../src/engine/shaderCompiler';
import type { EffectDef } from '../../src/types/project';

const chromePath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));

if (!chromePath) {
  console.error('Chrome/Edge not found');
  process.exit(1);
}

const jsonPath = resolve(process.cwd(), 'public/am/videostar_effects.json');
const effects = JSON.parse(readFileSync(jsonPath, 'utf8')) as EffectDef[];

const compiledPayloads = effects.map((eff) => {
  const frag = eff.shaders.find((s) => s.type === 'fragment')!;
  return {
    id: eff.id,
    file: eff.file,
    vsrc: buildVertexSource(eff, null),
    fsrc: buildFragmentSource(eff, frag),
  };
});

const html = `<!DOCTYPE html>
<html><body><canvas id="c" width="16" height="16"></canvas>
<script>
(async () => {
  const payloads = ${JSON.stringify(compiledPayloads)};
  const canvas = document.getElementById('c');
  const gl = canvas.getContext('webgl2');
  const failures = [];
  let ok = 0;
  let report;
  if (!gl) {
    report = { error: 'No WebGL2', total: payloads.length, ok: 0, failed: payloads.length, failures: [] };
  } else {
    for (const item of payloads) {
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, item.vsrc);
      gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, item.fsrc);
      gl.compileShader(fs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        failures.push({ id: item.id, file: item.file, stage: 'VS', err: gl.getShaderInfoLog(vs) });
      } else if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        failures.push({ id: item.id, file: item.file, stage: 'FS', err: gl.getShaderInfoLog(fs) });
      } else {
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          failures.push({ id: item.id, file: item.file, stage: 'LINK', err: gl.getProgramInfoLog(prog) });
        } else {
          ok++;
        }
        gl.deleteProgram(prog);
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    }
    report = { total: payloads.length, ok, failed: failures.length, failures };
  }
  await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
})();
</script></body></html>`;

const userDir = mkdtempSync(join(tmpdir(), 'vs-webgl2-'));
let child: ReturnType<typeof spawn> | null = null;
let settled = false;

const finish = (code: number) => {
  if (settled) return;
  settled = true;
  try { child?.kill(); } catch {}
  try { server.close(); } catch {}
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(code);
};

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200);
      res.end('ok');
      const report = JSON.parse(body);
      if (report.error) console.error('WebGL2 error:', report.error);
      console.log(`WebGL2 compile test: ${report.ok}/${report.total} passed, ${report.failed} failed`);
      for (const f of report.failures ?? []) {
        console.log(`  FAIL [${f.stage}] ${f.id}: ${String(f.err).trim()}`);
      }
      finish(report.failed > 0 || report.ok !== report.total ? 1 : 0);
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address() as { port: number };
  const url = `http://127.0.0.1:${addr.port}/`;
  child = spawn(
    chromePath,
    [
      '--headless=new',
      `--user-data-dir=${userDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--disable-gpu-sandbox',
      url,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  let errLog = '';
  child.stderr?.on('data', (d) => (errLog += String(d)));
  setTimeout(() => {
    console.error('Timed out waiting for headless browser WebGL2 result.', errLog.slice(0, 500));
    finish(1);
  }, 20000);
});
