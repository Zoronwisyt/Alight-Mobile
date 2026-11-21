// Emit `dist/blend-probe.html`: a WebGL2 page that runs the *actual* Screen shader pair from
// `src/engine/renderer.ts` against two flat layers and reads back a pixel.
//
// The GLSL is extracted from the source file rather than copied, so the probe cannot drift away
// from what the renderer ships. Open the page and read the JSON it writes into #out.
//
// Expected (top rgba(0.25,0.50,0.75,1) over bot rgba(0.40,0.40,0.40,1), alpha 1):
//   normal = (0.25, 0.50, 0.75)                 -- plain over
//   screen = (0.55, 0.70, 0.85)                 -- top + bot*(1-a_t) - top*bot*(1-a_t)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = 'src/engine/renderer.ts';
const OUT = 'dist/blend-probe.html';

const text = readFileSync(SRC, 'utf8');

/** Pull `const NAME = \`...\`;` out of the renderer source. */
function extractShader(name) {
  const re = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`);
  const m = text.match(re);
  if (!m) throw new Error(`shader ${name} not found in ${SRC}`);
  return m[1];
}

const shaders = {
  BLIT_VERT: extractShader('BLIT_VERT'),
  BLIT_FRAG: extractShader('BLIT_FRAG'),
  SCREEN_FRAG: extractShader('SCREEN_FRAG'),
  COMPOSITE_BLEND_FRAG: extractShader('COMPOSITE_BLEND_FRAG'),
};

const html = `<!doctype html>
<meta charset="utf-8">
<title>blend-probe</title>
<pre id="out">running…</pre>
<script>
const S = ${JSON.stringify(shaders)};

const canvas = document.createElement('canvas');
canvas.width = 2; canvas.height = 2;
document.body.appendChild(canvas);
const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
const out = document.getElementById('out');

function fail(msg) { out.textContent = JSON.stringify({ ok: false, error: String(msg) }); }

if (!gl) fail('no webgl2');
else try {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, S.BLIT_VERT); gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error('vert: ' + gl.getShaderInfoLog(vs));

  function program(fragSrc, label) {
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fragSrc); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error(label + ': ' + gl.getShaderInfoLog(fs));
    }
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(label + ' link: ' + gl.getProgramInfoLog(p));
    return p;
  }

  // 1x1 solid-colour texture.
  function solid(r, g, b, a) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(a * 255)]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  const TOP = solid(0.25, 0.50, 0.75, 1.0);
  const BOT = solid(0.40, 0.40, 0.40, 1.0);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // two triangles covering clip space; vUv from position
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1, 0,0,  1,-1, 1,0,  -1,1, 0,1,
    -1, 1, 0,1,  1,-1, 1,0,   1,1, 1,1,
  ]), gl.STATIC_DRAW);
  const locPos = 0, locUv = 1;
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(locUv);
  gl.vertexAttribPointer(locUv, 2, gl.FLOAT, false, 16, 8);

  function readPixel() {
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0] / 255, px[1] / 255, px[2] / 255, px[3] / 255];
  }
  const round = (v) => v.map((x) => Math.round(x * 1000) / 1000);

  // --- Normal: BLIT_FRAG(top, alpha 1) drawn over bot with premultiplied over.
  gl.disable(gl.BLEND);
  const pBlit = program(S.BLIT_FRAG, 'blit');
  gl.useProgram(pBlit);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, 2, 2);
  gl.clearColor(0.40, 0.40, 0.40, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, TOP);
  gl.uniform1i(gl.getUniformLocation(pBlit, 'uTex'), 0);
  gl.uniform1f(gl.getUniformLocation(pBlit, 'uAlpha'), 1.0);
  gl.uniform2f(gl.getUniformLocation(pBlit, 'uUvXform'), 1.0, 0.0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.disable(gl.BLEND);
  const normal = round(readPixel());

  // --- Screen: SCREEN_FRAG into an FBO, then COMPOSITE_BLEND_FRAG over bot, exactly as the
  // renderer's native branch does it.
  const fboTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo incomplete');

  gl.viewport(0, 0, 2, 2);
  const pScreen = program(S.SCREEN_FRAG, 'screen');
  gl.useProgram(pScreen);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, TOP);
  gl.uniform1i(gl.getUniformLocation(pScreen, 'uTop'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, BOT);
  gl.uniform1i(gl.getUniformLocation(pScreen, 'uBot'), 1);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // composite pass, reading the screen result as uTop over bot
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, 2, 2);
  gl.clearColor(0.40, 0.40, 0.40, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const pComp = program(S.COMPOSITE_BLEND_FRAG, 'composite');
  gl.useProgram(pComp);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, BOT);
  gl.uniform1i(gl.getUniformLocation(pComp, 'uBot'), 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.uniform1i(gl.getUniformLocation(pComp, 'uTop'), 1);
  gl.uniform1f(gl.getUniformLocation(pComp, 'uAlpha'), 1.0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  const screen = round(readPixel());

  const differs = Math.abs(screen[0] - normal[0]) > 0.02 || Math.abs(screen[1] - normal[1]) > 0.02;
  out.textContent = JSON.stringify({
    ok: true,
    glVersion: gl.getParameter(gl.VERSION),
    top: [0.25, 0.5, 0.75, 1],
    bot: [0.4, 0.4, 0.4, 1],
    normal,
    screen,
    differsFromNormal: differs,
  }, null, 2);
} catch (e) { fail(e && e.message ? e.message : e); }
</script>
`;

mkdirSync('dist', { recursive: true });
writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT} (${html.length} B)`);
for (const [k, v] of Object.entries(shaders)) console.log(`  ${k}: ${v.length} B`);
