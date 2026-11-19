import type {
  BlendModeId,
  EffectDef,
  Layer,
  LayerEffectInstance,
  Project,
  ShapeDef,
  VectorPoint,
} from '../types/project';
import {
  clamp01,
  evalAnimatable,
  evalLayerVelocities,
  evalRemappedTime,
  integrateAnimatable,
  parseColorArgb,
} from './animation';
import { getEffectById, getEffects, getShapeById, parseDefaultParamValue } from './catalog';
import { evaluateShapePath, runEffectScript, type EffectScriptElement, type EffectScriptEnv } from './scriptRuntime';
import { sanitizeGlslUniformName, ShaderRegistry } from './shaderCompiler';
import { loadMediaUrl } from '../store/storage';

interface FboSlot {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
  inUse: boolean;
}

interface ImageMediaEntry {
  img: HTMLImageElement;
  tex: WebGLTexture;
  w: number;
  h: number;
  hasFrame: boolean;
  mediaId?: string;
  rehydrated?: boolean;
}

interface VideoMediaEntry {
  video: HTMLVideoElement;
  tex: WebGLTexture;
  w: number;
  h: number;
  hasFrame: boolean;
  lastUploadedTime: number;
  pendingSeekTarget: number | null;
  mediaId?: string;
  rehydrated?: boolean;
}

const BLIT_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec4 ac_internal_position;
layout(location = 1) in vec2 ac_internal_texcoord;
out vec2 vUv;
void main() {
  gl_Position = ac_internal_position;
  vUv = ac_internal_texcoord;
}`;

const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform float uAlpha;
void main() {
  fragColor = texture(uTex, vUv) * uAlpha;
}`;

const MASK_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uBase;
uniform sampler2D uMask;
uniform int uExclude;
void main() {
  vec4 base = texture(uBase, vUv);
  vec4 mask = texture(uMask, vUv);
  float m = clamp(mask.a, 0.0, 1.0);
  if (uExclude == 1) m = 1.0 - m;
  fragColor = base * m;
}`;

const COMPOSITE_BLEND_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uBot;
uniform sampler2D uTop;
uniform float uAlpha;
void main() {
  vec4 bot = texture(uBot, vUv);
  vec4 top = texture(uTop, vUv) * uAlpha;
  fragColor = top + bot * (1.0 - top.a);
}`;

function mulberry32(seed: number) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build 4x4 row-major matrix passed with transpose=false for row-vector `vec4(v,0,1) * M` */
function mat4RowMajorToGl(m: number[]): Float32Array {
  // For `vec4 * M` where GLSL reads column-major `m[col][row]`,
  // passing row-major array with transpose=false makes GLSL columns equal rows,
  // wait: in GLSL `v * M` computes row(v) dot col_j(M).
  // If we want `(v * M)[j] = sum_i v[i] * A[i][j]`, then col_j(M) must be `[A[0][j], A[1][j], A[2][j], A[3][j]]`,
  // which in column-major order IS `A` stored column-major, i.e., `[col0, col1, col2, col3]`!
  // Let's write explicit helper storing column-major so `(v * M)` multiplies `M` from right cleanly:
  // Actually: `A_ij` stored at `col*4 + row` means `M[col][row] = A[col][row]`?
  // NO: In GLSL `mat4(c0, c1, c2, c3)`, column j has elements `[m[j*4+0], m[j*4+1], m[j*4+2], m[j*4+3]]`.
  // `vec4 * mat4` computes result[j] = dot(vec4, column j) = sum_i v[i] * m[j*4 + i].
  // So if `result[j] = a0*x + a1*y + a2*z + a3*w`, then `m[j*4 + 0] = a0, m[j*4 + 1] = a1, m[j*4 + 2] = a2, m[j*4 + 3] = a3`!
  // That means `m` is organized as `[col0(coeffs for out.x), col1(coeffs for out.y), col2(coeffs for out.z), col3(coeffs for out.w)]`!
  return new Float32Array(m);
}

function makeTransformMatrices(
  screenW: number,
  screenH: number,
  cx: number,
  cy: number,
  lw: number,
  lh: number,
  rotDeg: number,
  sx: number,
  sy: number,
  pivotX: number,
  pivotY: number,
  skewXDeg: number,
  skewYDeg: number
): { screenToLayer: Float32Array; layerToScreen: Float32Array } {
  // Map layerNorm (lx in [0,1] left->right, ly in [0,1] bottom->top) -> screenNorm (ux in [0,1] left->right, vy in [0,1] bottom->top)
  const rad = (rotDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const skX = Math.tan((skewXDeg * Math.PI) / 180);
  const skY = Math.tan((skewYDeg * Math.PI) / 180);

  // Layer norm (u, v) -> local pixels relative to pivot (top-down y):
  // px0 = (u - 0.5) * lw - pivotX
  // py0 = (0.5 - v) * lh - pivotY
  // After scale + skew + rotate + translate to (cx + pivotX, cy + pivotY):
  // Let's apply: p1 = scale(p0), p2 = skew(p1), p3 = rot(p2), screenPx = p3 + (cx + pivotX, cy + pivotY)
  // Actually in Alight Motion, pivot shifts the rotation/scale center; location is layer center!
  const applyLayerToScreenNorm = (u: number, v: number): [number, number] => {
    const x0 = (u - 0.5) * lw - pivotX;
    const y0 = (0.5 - v) * lh - pivotY;
    const xs = x0 * sx;
    const ys = y0 * sy;
    const xk = xs + ys * skX;
    const yk = ys + xs * skY;
    const xr = xk * c - yk * s + cx + pivotX;
    const yr = xk * s + yk * c + cy + pivotY;
    return [xr / screenW, 1.0 - yr / screenH];
  };

  // Compute exact affine 2D coefficients by sampling (0,0), (1,0), (0,1)
  const [oX, oY] = applyLayerToScreenNorm(0, 0);
  const [xX, xY] = applyLayerToScreenNorm(1, 0);
  const [yX, yY] = applyLayerToScreenNorm(0, 1);

  const ax = xX - oX;
  const bx = yX - oX;
  const ay = xY - oY;
  const by = yY - oY;

  // vec4(u, v, 0, 1) * layerToScreen:
  // out.x = ax*u + bx*v + oX
  // out.y = ay*u + by*v + oY
  const layerToScreen = mat4RowMajorToGl([
    ax, bx, 0, oX,
    ay, by, 0, oY,
    0,  0,  1, 0,
    0,  0,  0, 1,
  ]);

  // Invert 2D affine [ax, bx, oX; ay, by, oY]
  const det = ax * by - bx * ay;
  const invDet = Math.abs(det) > 1e-9 ? 1.0 / det : 1.0;
  const iax = by * invDet;
  const ibx = -bx * invDet;
  const iox = (bx * oY - by * oX) * invDet;
  const iay = -ay * invDet;
  const iby = ax * invDet;
  const ioy = (ay * oX - ax * oY) * invDet;

  const screenToLayer = mat4RowMajorToGl([
    iax, ibx, 0, iox,
    iay, iby, 0, ioy,
    0,   0,   1, 0,
    0,   0,   0, 1,
  ]);

  return { screenToLayer, layerToScreen };
}

function quatToMat4(q: [number, number, number, number], invert = false): Float32Array {
  let x = Number(q[0]) || 0;
  let y = Number(q[1]) || 0;
  let z = Number(q[2]) || 0;
  let w = Number(q[3]);
  if (!Number.isFinite(w)) w = 1;
  const len = Math.hypot(x, y, z, w);
  if (len > 1e-8) {
    x /= len;
    y /= len;
    z /= len;
    w /= len;
  } else {
    x = 0; y = 0; z = 0; w = 1;
  }

  // Row-vector rotation matrix matching Alight Motion's `vec4(p, 1.0) * orient`
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;

  const m00 = 1 - 2 * (yy + zz);
  const m01 = 2 * (xy - wz);
  const m02 = 2 * (xz + wy);

  const m10 = 2 * (xy + wz);
  const m11 = 1 - 2 * (xx + zz);
  const m12 = 2 * (yz - wx);

  const m20 = 2 * (xz - wy);
  const m21 = 2 * (yz + wx);
  const m22 = 1 - 2 * (xx + yy);

  if (invert) {
    return new Float32Array([
      m00, m10, m20, 0,
      m01, m11, m21, 0,
      m02, m12, m22, 0,
      0,   0,   0,   1,
    ]);
  }
  return new Float32Array([
    m00, m01, m02, 0,
    m10, m11, m12, 0,
    m20, m21, m22, 0,
    0,   0,   0,   1,
  ]);
}

function measureSvgPathBounds(d: string): { w: number; h: number } {
  const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  let maxX = 120;
  let maxY = 120;
  if (nums) {
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Math.abs(parseFloat(nums[i]));
      const y = Math.abs(parseFloat(nums[i + 1]));
      if (Number.isFinite(x)) maxX = Math.max(maxX, x * 2);
      if (Number.isFinite(y)) maxY = Math.max(maxY, y * 2);
    }
  }
  return { w: Math.min(4096, Math.max(64, maxX)), h: Math.min(4096, Math.max(64, maxY)) };
}

function orientEulerToMat4(eulerDeg: [number, number, number], invert = false): Float32Array {
  const rx = (eulerDeg[0] * Math.PI) / 180;
  const ry = (eulerDeg[1] * Math.PI) / 180;
  const rz = (eulerDeg[2] * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // R = Rz * Rx * Ry
  const m00 = cz * cy - sz * sx * sy;
  const m01 = -sz * cx;
  const m02 = cz * sy + sz * sx * cy;

  const m10 = sz * cy + cz * sx * sy;
  const m11 = cz * cx;
  const m12 = sz * sy - cz * sx * cy;

  const m20 = -cx * sy;
  const m21 = sx;
  const m22 = cx * cy;

  if (invert) {
    return new Float32Array([
      m00, m10, m20, 0,
      m01, m11, m21, 0,
      m02, m12, m22, 0,
      0,   0,   0,   1,
    ]);
  }
  return new Float32Array([
    m00, m01, m02, 0,
    m10, m11, m12, 0,
    m20, m21, m22, 0,
    0,   0,   0,   1,
  ]);
}

function buildCanvasPath(ctx: CanvasRenderingContext2D, pts: any[]) {
  if (!pts || pts.length === 0) return;
  let closed = false;
  const nodes: { p: [number, number]; in?: [number, number]; out?: [number, number] }[] = [];
  for (const item of pts) {
    if (Array.isArray(item)) {
      nodes.push({ p: [item[0], item[1]] });
    } else if (item && typeof item === 'object') {
      if ('closed' in item) {
        closed = Boolean(item.closed);
      } else if (item.p) {
        nodes.push({
          p: [item.p[0], item.p[1]],
          in: item.in ? [item.in[0], item.in[1]] : undefined,
          out: item.out ? [item.out[0], item.out[1]] : undefined,
        });
      }
    }
  }
  if (nodes.length === 0) return;

  ctx.beginPath();
  ctx.moveTo(nodes[0].p[0], nodes[0].p[1]);
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    if (a.out || b.in) {
      const cp1 = a.out ?? a.p;
      const cp2 = b.in ?? b.p;
      ctx.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], b.p[0], b.p[1]);
    } else {
      ctx.lineTo(b.p[0], b.p[1]);
    }
  }
  if (closed && nodes.length > 1) {
    const a = nodes[nodes.length - 1];
    const b = nodes[0];
    if (a.out || b.in) {
      const cp1 = a.out ?? a.p;
      const cp2 = b.in ?? b.p;
      ctx.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], b.p[0], b.p[1]);
    }
    ctx.closePath();
  }
}

function buildVectorPath(ctx: CanvasRenderingContext2D, points: VectorPoint[], closed: boolean) {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    ctx.bezierCurveTo(a.x + a.outX, a.y + a.outY, b.x + b.inX, b.y + b.inY, b.x, b.y);
  }
  if (closed && points.length > 1) {
    const a = points[points.length - 1];
    const b = points[0];
    ctx.bezierCurveTo(a.x + a.outX, a.y + a.outY, b.x + b.inX, b.y + b.inY, b.x, b.y);
    ctx.closePath();
  }
}

function measureShapeBounds(pts: any[]): { w: number; h: number } {
  let maxX = 120;
  let maxY = 120;
  for (const item of pts) {
    const p = Array.isArray(item) ? item : item?.p;
    if (p) {
      maxX = Math.max(maxX, Math.abs(p[0]) * 2);
      maxY = Math.max(maxY, Math.abs(p[1]) * 2);
    }
  }
  return { w: Math.min(4096, Math.max(64, maxX)), h: Math.min(4096, Math.max(64, maxY)) };
}

export class AlightRenderer {
  public canvas: HTMLCanvasElement;
  public gl: WebGL2RenderingContext;
  public registry: ShaderRegistry;

  private quadVao: WebGLVertexArrayObject;
  private quadVbo: WebGLBuffer;
  private blitProg: ReturnType<ShaderRegistry['compileRaw']>;
  private maskProg: ReturnType<ShaderRegistry['compileRaw']>;
  private compositeBlendProg: ReturnType<ShaderRegistry['compileRaw']>;

  private fboPool: FboSlot[] = [];
  private canvas2d: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;

  private resourceTextures = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
  private mediaImages = new Map<string, ImageMediaEntry>();
  private mediaVideos = new Map<string, VideoMediaEntry>();
  private svgPathCache = new Map<string, { path: Path2D; w: number; h: number }>();
  private tempUploadTex: WebGLTexture;
  private dummyBlackTex: WebGLTexture;
  private isPlaybackActive = false;
  private disposed = false;
  public onMediaReady?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: true,
    });
    if (!gl) throw new Error('WebGL2 is required for Alight Motion Web Studio.');
    this.gl = gl;
    this.registry = new ShaderRegistry(gl);

    this.canvas2d = document.createElement('canvas');
    this.canvas2d.width = 1080;
    this.canvas2d.height = 1080;
    this.ctx2d = this.canvas2d.getContext('2d')!;

    // Fullscreen quad VAO: position (x,y) + texcoord (u,v)
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const verts = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
      -1,  1, 0, 1,
       1, -1, 1, 0,
       1,  1, 1, 1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
    this.quadVao = vao;
    this.quadVbo = vbo;

    this.blitProg = this.registry.compileRaw('__internal_blit', BLIT_VERT, BLIT_FRAG);
    this.maskProg = this.registry.compileRaw('__internal_mask', BLIT_VERT, MASK_FRAG);
    this.compositeBlendProg = this.registry.compileRaw('__internal_comp_blend', BLIT_VERT, COMPOSITE_BLEND_FRAG);

    this.tempUploadTex = this.createEmptyTex();
    this.dummyBlackTex = this.createEmptyTex();
    gl.bindTexture(gl.TEXTURE_2D, this.dummyBlackTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

    this.preloadBuiltinTextures();
  }

  private createEmptyTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private preloadBuiltinTextures() {
    const base = import.meta.env.BASE_URL;
    const imgs = [
      ['resource/bumpmap_a.webp', `${base}am/resource/bumpmap_a.webp`],
      ['resource/bumpmap_b.webp', `${base}am/resource/bumpmap_b.webp`],
      ['resource/grunge_a.webp', `${base}am/resource/grunge_a.webp`],
      ['resource/grunge_b.webp', `${base}am/resource/grunge_b.webp`],
      ['textures/rgbanoise.webp', `${base}am/textures/rgbanoise.webp`],
    ];
    for (const [key, url] of imgs) {
      const img = new Image();
      img.onload = () => {
        if (this.disposed) return;
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        const tex = this.createEmptyTex();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        this.resourceTextures.set(key, { tex, w: img.naturalWidth, h: img.naturalHeight });
        this.onMediaReady?.();
      };
      img.src = url;
    }
  }

  private acquireFbo(width: number, height: number): FboSlot {
    const gl = this.gl;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const found = this.fboPool.find((s) => !s.inUse && s.width === w && s.height === h);
    if (found) {
      found.inUse = true;
      return found;
    }
    const fbo = gl.createFramebuffer()!;
    const tex = this.createEmptyTex();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const slot: FboSlot = { fbo, tex, width: w, height: h, inUse: true };
    this.fboPool.push(slot);
    return slot;
  }

  private releaseFbo(slot: FboSlot) {
    slot.inUse = false;
  }

  private clearFbo(slot: FboSlot | null, w: number, h: number, r = 0, g = 0, b = 0, a = 0) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, slot ? slot.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private unbindTextureUnits(count = 8) {
    const gl = this.gl;
    for (let i = 0; i < count; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  private drawQuad(program: WebGLProgram) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private blitTexture(tex: WebGLTexture, dst: FboSlot | null, w: number, h: number, alpha = 1, blend = false) {
    if (dst && tex === dst.tex) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fbo : null);
    gl.viewport(0, 0, w, h);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.useProgram(this.blitProg.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.blitProg.uniforms.uTex, 0);
    gl.uniform1f(this.blitProg.uniforms.uAlpha, alpha);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.unbindTextureUnits(2);
    gl.disable(gl.BLEND);
  }

  private uploadVideoTex(entry: VideoMediaEntry): boolean {
    if (this.disposed) return false;
    const v = entry.video;
    if (v.readyState < 2 || v.seeking || v.videoWidth === 0 || v.videoHeight === 0) {
      return false;
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    // Zero-copy ANGLE/D3D11 video upload fast path (no CPU flipY/premultiply readback; flipped in shader)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    if (entry.hasFrame && entry.w === v.videoWidth && entry.h === v.videoHeight) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, v);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
    }
    entry.w = v.videoWidth;
    entry.h = v.videoHeight;
    entry.hasFrame = true;
    entry.lastUploadedTime = v.currentTime;
    return true;
  }

  private getOrCreateVideoEntry(src: string, mediaId?: string): VideoMediaEntry {
    let entry = this.mediaVideos.get(src);
    if (!entry) {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      const tex = this.createEmptyTex();
      entry = {
        video,
        tex,
        w: 0,
        h: 0,
        hasFrame: false,
        lastUploadedTime: -1,
        pendingSeekTarget: null,
        mediaId,
        rehydrated: false,
      };
      const cur = entry;

      const handleFrameReady = () => {
        if (this.disposed) return;
        if (this.uploadVideoTex(cur)) {
          this.onMediaReady?.();
        }
      };

      video.addEventListener('loadeddata', handleFrameReady);
      video.addEventListener('seeked', () => {
        if (this.disposed) return;
        if (cur.pendingSeekTarget !== null && Math.abs(video.currentTime - cur.pendingSeekTarget) > 0.02) {
          const next = cur.pendingSeekTarget;
          cur.pendingSeekTarget = null;
          try {
            video.currentTime = next;
            return;
          } catch {
            // ignore out-of-range seek
          }
        }
        cur.pendingSeekTarget = null;
        handleFrameReady();
      });

      video.addEventListener('error', () => {
        if (this.disposed) return;
        if (cur.mediaId && !cur.rehydrated) {
          cur.rehydrated = true;
          loadMediaUrl(cur.mediaId)
            .then((freshUrl) => {
              if (!this.disposed && freshUrl) {
                video.src = freshUrl;
                video.load();
              }
            })
            .catch(() => {});
        }
      });

      video.src = src;
      video.load();
      this.mediaVideos.set(src, entry);
    } else if (mediaId && !entry.mediaId) {
      entry.mediaId = mediaId;
    }
    return entry;
  }

  public getVideoElement(src: string): HTMLVideoElement {
    return this.getOrCreateVideoEntry(src).video;
  }

  private getOrCreateImageEntry(src: string, mediaId?: string): ImageMediaEntry {
    let entry = this.mediaImages.get(src);
    if (!entry) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const tex = this.createEmptyTex();
      entry = { img, tex, w: 0, h: 0, hasFrame: false, mediaId, rehydrated: false };
      const cur = entry;

      img.onload = () => {
        if (this.disposed) return;
        cur.w = img.naturalWidth;
        cur.h = img.naturalHeight;
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        cur.hasFrame = true;
        this.onMediaReady?.();
      };

      img.onerror = () => {
        if (this.disposed) return;
        if (cur.mediaId && !cur.rehydrated) {
          cur.rehydrated = true;
          loadMediaUrl(cur.mediaId)
            .then((freshUrl) => {
              if (!this.disposed && freshUrl) img.src = freshUrl;
            })
            .catch(() => {});
        }
      };

      img.src = src;
      this.mediaImages.set(src, entry);
    } else if (mediaId && !entry.mediaId) {
      entry.mediaId = mediaId;
    }
    return entry;
  }

  private collectActiveMediaLayers(
    layers: Layer[],
    sceneTimeMs: number,
    out: { layer: Layer; localTimeMs: number }[]
  ): void {
    for (const layer of layers) {
      if (!layer.visible) continue;
      if (layer.type === 'group' && layer.groupLayers?.length) {
        if (sceneTimeMs >= layer.startTime && sceneTimeMs <= layer.endTime) {
          const { localTimeMs } = evalRemappedTime(layer, sceneTimeMs);
          this.collectActiveMediaLayers(layer.groupLayers, localTimeMs, out);
        }
      } else if ((layer.type === 'video' || layer.type === 'image') && layer.mediaData?.src) {
        const { localTimeMs } = evalRemappedTime(layer, sceneTimeMs);
        out.push({ layer, localTimeMs });
      }
    }
  }

  public syncVideosForPlayback(project: Project, sceneTimeMs: number, isPlaying: boolean): void {
    this.isPlaybackActive = isPlaying;
    const activeSrcs = new Set<string>();
    const items: { layer: Layer; localTimeMs: number }[] = [];
    this.collectActiveMediaLayers(project.layers, sceneTimeMs, items);

    for (const { layer, localTimeMs } of items) {
      if (layer.type !== 'video' || !layer.mediaData?.src) continue;
      const md = layer.mediaData;
      const entry = this.getOrCreateVideoEntry(md.src, md.mediaId);
      const v = entry.video;
      activeSrcs.add(md.src);

      const inRange = sceneTimeMs >= layer.startTime && sceneTimeMs <= layer.endTime;
      const speed = Math.max(0.1, Math.min(4, md.playbackSpeed || 1));
      const rawSec = Math.max(0, ((localTimeMs * speed) + (md.trimStartMs ?? 0)) / 1000);
      const maxSec = Number.isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - 0.02) : rawSec;
      const targetSec = Math.min(rawSec, maxSec);

      if (isPlaying && inRange) {
        if (Math.abs(v.playbackRate - speed) > 0.01) {
          v.playbackRate = speed;
        }
        v.muted = Boolean(md.muted);
        v.volume = Math.max(0, Math.min(1, md.volume ?? 1));

        if (v.paused) {
          if (v.readyState >= 1 && !v.seeking && Math.abs(v.currentTime - targetSec) > 0.08) {
            try {
              v.currentTime = targetSec;
            } catch {
              // ignore seek error before metadata
            }
          }
          if (targetSec < maxSec - 0.02) {
            const p = v.play();
            if (p && typeof p.catch === 'function') {
              p.catch(() => {
                // Autoplay policy fallback for unmuted video
                v.muted = true;
                v.play().catch(() => {});
              });
            }
          }
        } else if (!v.seeking && Math.abs(v.currentTime - targetSec) > 0.28) {
          try {
            v.currentTime = targetSec;
          } catch {
            // ignore
          }
        }
      } else {
        if (!v.paused) v.pause();
        // Pre-park video at trimStart shortly before its in-point so entry has zero hitch
        if (isPlaying && sceneTimeMs < layer.startTime && layer.startTime - sceneTimeMs < 500 && v.readyState >= 1 && !v.seeking) {
          const startSec = Math.max(0, (md.trimStartMs ?? 0) / 1000);
          if (Math.abs(v.currentTime - startSec) > 0.05) {
            try {
              v.currentTime = startSec;
            } catch {
              // ignore
            }
          }
        }
      }
    }

    for (const [src, entry] of this.mediaVideos.entries()) {
      if (!activeSrcs.has(src) && !entry.video.paused) {
        entry.video.pause();
      }
    }
  }

  public pauseAllVideos(): void {
    this.isPlaybackActive = false;
    for (const entry of this.mediaVideos.values()) {
      if (!entry.video.paused) {
        entry.video.pause();
      }
    }
  }

  /**
   * Deterministically waits for images to load and active video layers to seek to exact timestamp
   * before rendering an offline export frame (prevents video flicker or skipped frames in export).
   */
  public async prepareMediaAtTime(project: Project, sceneTimeMs: number): Promise<void> {
    this.pauseAllVideos();
    const items: { layer: Layer; localTimeMs: number }[] = [];
    this.collectActiveMediaLayers(project.layers, sceneTimeMs, items);

    const tasks: Promise<void>[] = [];
    for (const { layer, localTimeMs } of items) {
      if (sceneTimeMs < layer.startTime || sceneTimeMs > layer.endTime) continue;
      const md = layer.mediaData;
      if (!md?.src) continue;

      if (layer.type === 'image') {
        const entry = this.getOrCreateImageEntry(md.src, md.mediaId);
        if (!entry.hasFrame && !entry.img.complete) {
          tasks.push(
            new Promise<void>((resolve) => {
              const done = () => resolve();
              entry.img.addEventListener('load', done, { once: true });
              entry.img.addEventListener('error', done, { once: true });
              window.setTimeout(done, 1500);
            })
          );
        }
      } else if (layer.type === 'video') {
        const entry = this.getOrCreateVideoEntry(md.src, md.mediaId);
        const v = entry.video;
        const speed = Math.max(0.1, Math.min(4, md.playbackSpeed || 1));
        tasks.push(
          (async () => {
            if (v.readyState < 1) {
              await new Promise<void>((resolve) => {
                const done = () => resolve();
                v.addEventListener('loadedmetadata', done, { once: true });
                v.addEventListener('error', done, { once: true });
                window.setTimeout(done, 1500);
              });
            }
            const rawSec = Math.max(0, ((localTimeMs * speed) + (md.trimStartMs ?? 0)) / 1000);
            const maxSec = Number.isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - 0.01) : rawSec;
            const targetSec = Math.min(rawSec, maxSec);

            if (Math.abs(v.currentTime - targetSec) > 0.002 || v.readyState < 2) {
              await new Promise<void>((resolve) => {
                let settled = false;
                const finish = () => {
                  if (settled) return;
                  settled = true;
                  v.removeEventListener('seeked', onSeeked);
                  v.removeEventListener('loadeddata', onSeeked);
                  resolve();
                };
                const onSeeked = () => finish();
                v.addEventListener('seeked', onSeeked, { once: true });
                if (v.readyState < 2) v.addEventListener('loadeddata', onSeeked, { once: true });
                try {
                  v.currentTime = targetSec;
                } catch {
                  finish();
                }
                window.setTimeout(finish, 300);
              });
            }
            this.uploadVideoTex(entry);
          })()
        );
      }
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }

  private uploadImageOrVideo(
    src: string,
    localTimeMs: number,
    trimStart = 0,
    isVideo = false,
    mediaId?: string,
    playbackSpeed = 1
  ): { tex: WebGLTexture; w: number; h: number } | null {
    if (isVideo) {
      const entry = this.getOrCreateVideoEntry(src, mediaId);
      const v = entry.video;
      const speed = Math.max(0.1, Math.min(4, playbackSpeed || 1));
      const rawSec = Math.max(0, ((localTimeMs * speed) + trimStart) / 1000);
      const maxSec = Number.isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - 0.02) : rawSec;
      const targetSec = Math.min(rawSec, maxSec);

      // Only issue manual seeks when paused/scrubbing (never thrash currentTime while playing)
      if (!this.isPlaybackActive && v.readyState >= 1) {
        if (Math.abs(v.currentTime - targetSec) > 0.03) {
          if (v.seeking) {
            entry.pendingSeekTarget = targetSec;
          } else {
            try {
              v.currentTime = targetSec;
            } catch {
              // ignore
            }
          }
        }
      }

      // Upload new GPU texture only when decoder holds a fresh decoded frame (never blank during seek)
      if (v.readyState >= 2 && !v.seeking && v.videoWidth > 0) {
        if (!entry.hasFrame || Math.abs(v.currentTime - entry.lastUploadedTime) > 0.0005) {
          this.uploadVideoTex(entry);
        }
      }

      if (entry.hasFrame) {
        return { tex: entry.tex, w: entry.w || 512, h: entry.h || 512 };
      }
      return null;
    } else {
      const entry = this.getOrCreateImageEntry(src, mediaId);
      if (entry.hasFrame && entry.w > 0) {
        return { tex: entry.tex, w: entry.w, h: entry.h };
      }
      return null;
    }
  }

  /**
   * Renders full project at `sceneTimeMs` to the WebGL2 canvas.
   */
  public renderProject(
    project: Project,
    sceneTimeMs: number,
    options: {
      previewScale?: number;
      renderWidth?: number;
      renderHeight?: number;
      selectedIds?: string[];
      activeGroupStack?: string[];
    } = {}
  ): void {
    let renderW: number;
    let renderH: number;
    let scale: number;
    if (options.renderWidth && options.renderHeight) {
      renderW = Math.max(16, Math.round(options.renderWidth));
      renderH = Math.max(16, Math.round(options.renderHeight));
      scale = renderW / Math.max(1, project.width);
    } else {
      scale = options.previewScale ?? 1;
      renderW = Math.max(16, Math.round(project.width * scale));
      renderH = Math.max(16, Math.round(project.height * scale));
    }
    if (this.canvas.width !== renderW || this.canvas.height !== renderH) {
      this.canvas.width = renderW;
      this.canvas.height = renderH;
    }

    const sceneFbo = this.acquireFbo(renderW, renderH);
    const [br, bg, bb, ba] =
      project.bgColor === 'transparent' ? [0, 0, 0, 0] : parseColorArgb(project.bgColor);
    this.clearFbo(sceneFbo, renderW, renderH, br * ba, bg * ba, bb * ba, ba);

    this.renderLayerList(
      project,
      project.layers,
      sceneTimeMs,
      sceneFbo,
      renderW,
      renderH,
      scale,
      options.selectedIds ?? []
    );

    this.blitTexture(sceneFbo.tex, null, renderW, renderH, 1.0, false);
    this.releaseFbo(sceneFbo);
  }

  private resolveWorldTransform(
    layer: Layer,
    layersMap: Map<string, Layer>,
    sceneTimeMs: number,
    fps: number,
    visited = new Set<string>()
  ): {
    x: number;
    y: number;
    z: number;
    rotation: number;
    sx: number;
    sy: number;
    px: number;
    py: number;
    skewX: number;
    skewY: number;
    alphaMul: number;
  } {
    if (visited.has(layer.id)) {
      return { x: 0, y: 0, z: 0, rotation: 0, sx: 1, sy: 1, px: 0, py: 0, skewX: 0, skewY: 0, alphaMul: 1 };
    }
    visited.add(layer.id);

    const { localTimeMs, remappedNormT } = evalRemappedTime(layer, sceneTimeMs);
    const loc = evalAnimatable(layer.transform.location, remappedNormT, [0, 0, 0]);
    let x = loc[0], y = loc[1], z = loc[2] ?? 0;
    let rotation = evalAnimatable(layer.transform.rotation, remappedNormT, 0);
    const sc = evalAnimatable(layer.transform.scale, remappedNormT, [1, 1]);
    let sx = sc[0], sy = sc[1];
    const piv = evalAnimatable(layer.transform.pivot, remappedNormT, [0, 0]);
    const skew = evalAnimatable(layer.transform.skew, remappedNormT, [0, 0]);
    let alphaMul = 1;

    // Run auto-transform script effects (Oscillate, Swing, Spin, Pulse, Jitter, Shake, etc.)
    const vels = evalLayerVelocities(layer, sceneTimeMs, fps);
    const durSec = Math.max(0.001, (layer.endTime - layer.startTime) / 1000);
    const env: EffectScriptEnv = {
      time: remappedNormT,
      absTime: sceneTimeMs / 1000,
      duration: durSec,
      inTime: layer.startTime / 1000,
      fps,
      frame: Math.floor((sceneTimeMs / 1000) * fps),
      editMode: 'none',
      selected: false,
      velocity: { x: vels.velocity[0], y: vels.velocity[1] },
      angularVelocity: vels.angularVelocity,
      scaleVelocity: vels.scaleVelocity,
    };

    for (const effInst of layer.effects) {
      if (!effInst.enabled) continue;
      const def = getEffectById(effInst.effectId);
      if (!def || !def.script || !def.autoTransform) continue;
      const paramsEval = this.evalEffectParams(def, effInst, remappedNormT, durSec);
      const el: EffectScriptElement = {
        alpha: alphaMul,
        shaderGroups: null,
        text: layer.textData?.content ?? '',
        transform: {
          location: { x, y, z },
          angle: rotation,
          scale: { x: sx, y: sy },
        },
      };
      const out = runEffectScript(def, env, el, paramsEval);
      x = out.transform.location.x;
      y = out.transform.location.y;
      z = out.transform.location.z;
      rotation = out.transform.angle;
      sx = out.transform.scale.x;
      sy = out.transform.scale.y;
      alphaMul = out.alpha;
    }

    if (layer.parentId) {
      const parent = layersMap.get(layer.parentId);
      if (parent) {
        const pt = this.resolveWorldTransform(parent, layersMap, sceneTimeMs, fps, visited);
        const rad = (pt.rotation * Math.PI) / 180;
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        const rx = x * pt.sx * c - y * pt.sy * s;
        const ry = x * pt.sx * s + y * pt.sy * c;
        x = pt.x + rx;
        y = pt.y + ry;
        z += pt.z;
        rotation += pt.rotation;
        sx *= pt.sx;
        sy *= pt.sy;
      }
    }

    return { x, y, z, rotation, sx, sy, px: piv[0], py: piv[1], skewX: skew[0], skewY: skew[1], alphaMul };
  }

  private renderLayerList(
    project: Project,
    layers: Layer[],
    sceneTimeMs: number,
    targetFbo: FboSlot,
    renderW: number,
    renderH: number,
    scale: number,
    selectedIds: string[]
  ): void {
    const layersMap = new Map(layers.map((l) => [l.id, l]));
    const activeCam = project.cameraEnabled
      ? layers.find((l) => l.type === 'camera' && l.visible && sceneTimeMs >= l.startTime && sceneTimeMs <= l.endTime)
      : undefined;
    let camState: { x: number; y: number; z: number; fov: number } | null = null;
    if (activeCam) {
      const { remappedNormT } = evalRemappedTime(activeCam, sceneTimeMs);
      const cloc = evalAnimatable(activeCam.transform.location, remappedNormT, [project.width / 2, project.height / 2, 0]);
      const fov = activeCam.cameraData ? evalAnimatable(activeCam.cameraData.fov, remappedNormT, 60) : 60;
      camState = { x: cloc[0] - project.width / 2, y: cloc[1] - project.height / 2, z: cloc[2] ?? 0, fov };
    }

    for (const layer of layers) {
      if (!layer.visible || layer.type === 'audio' || layer.type === 'null' || layer.type === 'camera') continue;
      if (sceneTimeMs < layer.startTime || sceneTimeMs > layer.endTime) continue;

      // Echo Keyframes effect check
      const echoFx = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.repeat.echokf');
      if (echoFx) {
        const { remappedNormT } = evalRemappedTime(layer, sceneTimeMs);
        const count = Math.min(12, Math.max(1, Math.round(Number(evalAnimatable(echoFx.params.count, remappedNormT, 3)) || 3)));
        const seconds = Number(evalAnimatable(echoFx.params.seconds, remappedNormT, 0.5)) || 0.5;
        const alphaDecay = Number(evalAnimatable(echoFx.params.alpha, remappedNormT, 0.7)) || 0.7;
        for (let i = count; i >= 1; i--) {
          const echoT = sceneTimeMs - (seconds * 1000 * i) / count;
          if (echoT >= layer.startTime && echoT <= layer.endTime) {
            this.renderSingleLayer(project, layer, layersMap, camState, echoT, targetFbo, renderW, renderH, scale, selectedIds, Math.pow(alphaDecay, i));
          }
        }
      }

      this.renderSingleLayer(project, layer, layersMap, camState, sceneTimeMs, targetFbo, renderW, renderH, scale, selectedIds, 1);
    }
  }

  private renderSingleLayer(
    project: Project,
    layer: Layer,
    layersMap: Map<string, Layer>,
    camState: { x: number; y: number; z: number; fov: number } | null,
    sceneTimeMs: number,
    sceneFbo: FboSlot,
    renderW: number,
    renderH: number,
    scale: number,
    selectedIds: string[],
    extraAlpha = 1
  ): void {
    const { localTimeMs, remappedNormT } = evalRemappedTime(layer, sceneTimeMs);
    const tf = this.resolveWorldTransform(layer, layersMap, sceneTimeMs, project.fps);

    // Apply Camera 3D parallax / Z depth perspective if active
    let wx = tf.x;
    let wy = tf.y;
    let wsx = tf.sx;
    let wsy = tf.sy;
    if (camState) {
      const focal = (project.width * 0.5) / Math.tan(((camState.fov || 60) * Math.PI) / 360);
      const dz = Math.max(80, focal + tf.z - camState.z);
      const pScale = focal / dz;
      wx = project.width * 0.5 + (wx - camState.x - project.width * 0.5) * pScale;
      wy = project.height * 0.5 + (wy - camState.y - project.height * 0.5) * pScale;
      wsx *= pScale;
      wsy *= pScale;
    }

    const layerOpacity = clamp01(evalAnimatable(layer.opacity, remappedNormT, 1)) * tf.alphaMul * extraAlpha;
    if (layerOpacity <= 0.001) return;

    // Step 1: Rasterize layer base content into an FBO at screen size
    const contentFbo = this.acquireFbo(renderW, renderH);
    this.clearFbo(contentFbo, renderW, renderH, 0, 0, 0, 0);

    let logicalW = 300;
    let logicalH = 300;

    if (layer.type === 'group') {
      // Render group children in the nested embedScene's own coordinate space, then transform
      const grpW = layer.groupWidth || project.width;
      const grpH = layer.groupHeight || project.height;
      const grpRenderW = Math.max(16, Math.round(grpW * scale));
      const grpRenderH = Math.max(16, Math.round(grpH * scale));
      const grpFbo = this.acquireFbo(grpRenderW, grpRenderH);
      this.clearFbo(grpFbo, grpRenderW, grpRenderH, 0, 0, 0, 0);
      if (layer.groupLayers && layer.groupLayers.length > 0) {
        const subProj = grpW === project.width && grpH === project.height
          ? project
          : { ...project, width: grpW, height: grpH };
        this.renderLayerList(subProj, layer.groupLayers, localTimeMs, grpFbo, grpRenderW, grpRenderH, scale, []);
      }
      this.blitTransformedFbo(
        grpFbo.tex,
        contentFbo,
        renderW,
        renderH,
        wx * scale,
        wy * scale,
        grpW * scale,
        grpH * scale,
        tf.rotation,
        wsx,
        wsy,
        false,
        tf.px * scale,
        tf.py * scale,
        tf.skewX,
        tf.skewY
      );
      this.releaseFbo(grpFbo);
      logicalW = grpW;
      logicalH = grpH;
    } else if (layer.type === 'image' || layer.type === 'video') {
      const md = layer.mediaData;
      if (md?.src) {
        const uploaded = this.uploadImageOrVideo(
          md.src,
          localTimeMs,
          md.trimStartMs ?? 0,
          layer.type === 'video',
          md.mediaId,
          md.playbackSpeed ?? 1
        );
        if (uploaded) {
          const srcW = uploaded.w || md.naturalWidth || 512;
          const srcH = uploaded.h || md.naturalHeight || 512;
          logicalW = md.displayWidth || srcW;
          logicalH = md.displayHeight || srcH;
          // Aspect-fill (cover) UV scale matching Alight Motion's <shape fillType="media">
          const srcAspect = srcW / Math.max(1, srcH);
          const boxAspect = logicalW / Math.max(1, logicalH);
          let coverScaleX = 1;
          let coverScaleY = 1;
          if (Math.abs(srcAspect - boxAspect) > 0.002) {
            if (srcAspect > boxAspect) {
              coverScaleX = boxAspect / srcAspect;
            } else {
              coverScaleY = srcAspect / boxAspect;
            }
          }
          this.blitTransformedFbo(
            uploaded.tex,
            contentFbo,
            renderW,
            renderH,
            wx * scale,
            wy * scale,
            logicalW * scale,
            logicalH * scale,
            tf.rotation,
            wsx,
            wsy,
            layer.type === 'video',
            tf.px * scale,
            tf.py * scale,
            tf.skewX,
            tf.skewY,
            coverScaleX,
            coverScaleY
          );
        }
      }
    } else {
      // Shape / Vector / Freehand / Text -> Canvas2D rasterization in world coordinates (with Repeat effects!)
      const repeatInstances = this.computeRepeatInstances(layer, remappedNormT);
      const dims = this.rasterizeLayerToCanvas2D(project, layer, remappedNormT, wx, wy, tf.rotation, wsx, wsy, tf.px, tf.py, tf.skewX, tf.skewY, scale, renderW, renderH, repeatInstances);
      logicalW = dims.w;
      logicalH = dims.h;

      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tempUploadTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas2d);
      this.blitTexture(this.tempUploadTex, contentFbo, renderW, renderH, 1.0, false);
    }

    // Step 2: Run GPU Shader / Script Effect Stack
    let currentSlot = contentFbo;
    const dtMs = 1000 / Math.max(1, project.fps);
    const tfPrev = this.resolveWorldTransform(layer, layersMap, sceneTimeMs - dtMs * 0.5, project.fps);
    const tfNext = this.resolveWorldTransform(layer, layersMap, sceneTimeMs + dtMs * 0.5, project.fps);
    const vels = {
      velocity: [tfNext.x - tfPrev.x, tfNext.y - tfPrev.y] as [number, number],
      angularVelocity: tfNext.rotation - tfPrev.rotation,
      scaleVelocity: Math.hypot((tfNext.sx - tfPrev.sx) * logicalW, (tfNext.sy - tfPrev.sy) * logicalH),
    };
    const durSec = Math.max(0.001, (layer.endTime - layer.startTime) / 1000);
    const envBase: EffectScriptEnv = {
      time: remappedNormT,
      absTime: sceneTimeMs / 1000,
      duration: durSec,
      inTime: layer.startTime / 1000,
      fps: project.fps,
      frame: Math.floor((sceneTimeMs / 1000) * project.fps),
      editMode: 'none',
      selected: selectedIds.includes(layer.id),
      velocity: { x: vels.velocity[0], y: vels.velocity[1] },
      angularVelocity: vels.angularVelocity,
      scaleVelocity: vels.scaleVelocity,
    };

    const { screenToLayer, layerToScreen } = makeTransformMatrices(
      renderW,
      renderH,
      wx * scale,
      wy * scale,
      logicalW * scale,
      logicalH * scale,
      tf.rotation,
      wsx,
      wsy,
      tf.px * scale,
      tf.py * scale,
      tf.skewX,
      tf.skewY
    );

    let scriptAlpha = 1;

    for (const effInst of layer.effects) {
      if (!effInst.enabled) continue;
      const def = getEffectById(effInst.effectId);
      if (!def || def.autoTransform || def.shaders.length === 0) {
        // Check non-autoTransform script-only opacity effects (like fade)
        if (def?.script && def.shaders.length === 0) {
          const paramsEval = this.evalEffectParams(def, effInst, remappedNormT, durSec);
          const out = runEffectScript(
            def,
            envBase,
            {
              alpha: scriptAlpha,
              shaderGroups: null,
              text: '',
              transform: { location: { x: wx, y: wy, z: tf.z }, angle: tf.rotation, scale: { x: wsx, y: wsy } },
            },
            paramsEval
          );
          scriptAlpha = out.alpha;
        }
        continue;
      }

      const paramsEval = this.evalEffectParams(def, effInst, remappedNormT, durSec);
      let groupsToRun: (string | null)[] = [null];
      if (def.script) {
        const out = runEffectScript(
          def,
          envBase,
          {
            alpha: scriptAlpha,
            shaderGroups: null,
            text: '',
            transform: { location: { x: wx, y: wy, z: tf.z }, angle: tf.rotation, scale: { x: wsx, y: wsy } },
          },
          paramsEval
        );
        scriptAlpha = out.alpha;
        if (Array.isArray(out.shaderGroups)) {
          if (out.shaderGroups.length === 0) continue; // bypassed
          groupsToRun = out.shaderGroups.map((g) => String(g));
        }
      }

      for (const grp of groupsToRun) {
        const nextSlot = this.runEffectPasses(
          def,
          grp,
          paramsEval,
          currentSlot,
          sceneFbo,
          renderW,
          renderH,
          scale,
          project,
          layer,
          wx,
          wy,
          logicalW,
          logicalH,
          wsx,
          wsy,
          tf.px,
          tf.py,
          vels,
          localTimeMs,
          screenToLayer,
          layerToScreen
        );
        if (nextSlot && nextSlot !== currentSlot) {
          this.releaseFbo(currentSlot);
          currentSlot = nextSlot;
        }
      }
    }

    const finalAlpha = clamp01(layerOpacity * scriptAlpha);

    // Step 3: Composite onto Scene FBO (Mask / Exclude / 26 APK Blend Modes / Normal)
    if (layer.blendMode === 'mask' || layer.blendMode === 'exclude') {
      const outFbo = this.acquireFbo(renderW, renderH);
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo.fbo);
      gl.viewport(0, 0, renderW, renderH);
      gl.disable(gl.BLEND);
      gl.useProgram(this.maskProg.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneFbo.tex);
      gl.uniform1i(this.maskProg.uniforms.uBase, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, currentSlot.tex);
      gl.uniform1i(this.maskProg.uniforms.uMask, 1);
      gl.uniform1i(this.maskProg.uniforms.uExclude, layer.blendMode === 'exclude' ? 1 : 0);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.unbindTextureUnits(2);
      this.blitTexture(outFbo.tex, sceneFbo, renderW, renderH, 1, false);
      this.releaseFbo(outFbo);
    } else if (layer.blendMode !== 'normal') {
      const blendDef = getEffectById(layer.blendMode);
      const blendProg = blendDef ? this.registry.getEffectProgram(blendDef, null) : null;
      if (blendDef && blendProg) {
        const blendedFbo = this.acquireFbo(renderW, renderH);
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, blendedFbo.fbo);
        gl.viewport(0, 0, renderW, renderH);
        gl.disable(gl.BLEND);
        gl.useProgram(blendProg.program);
        this.bindBuiltinUniforms(
          blendProg.uniforms,
          project,
          renderW,
          renderH,
          wx,
          wy,
          logicalW,
          logicalH,
          wsx,
          wsy,
          tf.px,
          tf.py,
          vels,
          localTimeMs,
          layer,
          0,
          0,
          screenToLayer,
          layerToScreen
        );
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, currentSlot.tex);
        if (blendProg.uniforms['inputImg_texture']) gl.uniform1i(blendProg.uniforms['inputImg_texture'], 0);
        if (blendProg.uniforms['inputImg_size']) gl.uniform2f(blendProg.uniforms['inputImg_size'], renderW, renderH);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, sceneFbo.tex);
        if (blendProg.uniforms['comp_texture']) gl.uniform1i(blendProg.uniforms['comp_texture'], 1);
        if (blendProg.uniforms['comp_size']) gl.uniform2f(blendProg.uniforms['comp_size'], renderW, renderH);

        gl.bindVertexArray(this.quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.unbindTextureUnits(2);

        // Composite blended top onto sceneFbo by layerOpacity
        const compFbo = this.acquireFbo(renderW, renderH);
        gl.bindFramebuffer(gl.FRAMEBUFFER, compFbo.fbo);
        gl.viewport(0, 0, renderW, renderH);
        gl.useProgram(this.compositeBlendProg.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sceneFbo.tex);
        gl.uniform1i(this.compositeBlendProg.uniforms.uBot, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, blendedFbo.tex);
        gl.uniform1i(this.compositeBlendProg.uniforms.uTop, 1);
        gl.uniform1f(this.compositeBlendProg.uniforms.uAlpha, finalAlpha);
        gl.bindVertexArray(this.quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.unbindTextureUnits(2);

        this.blitTexture(compFbo.tex, sceneFbo, renderW, renderH, 1, false);
        this.releaseFbo(compFbo);
        this.releaseFbo(blendedFbo);
      } else {
        this.blitTexture(currentSlot.tex, sceneFbo, renderW, renderH, finalAlpha, true);
      }
    } else {
      this.blitTexture(currentSlot.tex, sceneFbo, renderW, renderH, finalAlpha, true);
    }

    this.releaseFbo(currentSlot);
  }

  private evalEffectParams(def: EffectDef, inst: LayerEffectInstance, normT: number, durSec = 1): Record<string, any> {
    const out: Record<string, any> = {};
    for (const pd of def.params) {
      if (!pd.id) continue;
      if (pd.tag === 'float' && pd.value !== undefined) {
        out[pd.id] = parseFloat(pd.value) || 0;
      } else if (pd.tag !== 'texture' && pd.tag !== 'section' && pd.tag !== 'tip') {
        const defVal = parseDefaultParamValue(pd);
        if (pd.type === 'hz') {
          out[pd.id] = integrateAnimatable(inst.params[pd.id], normT, durSec, Number(defVal) || 0, 1);
        } else if (pd.type === 'rpm') {
          out[pd.id] = integrateAnimatable(inst.params[pd.id], normT, durSec, Number(defVal) || 0, 6);
        } else {
          out[pd.id] = evalAnimatable(inst.params[pd.id], normT, defVal);
        }
      }
    }
    return out;
  }

  private runEffectPasses(
    def: EffectDef,
    group: string | null,
    params: Record<string, any>,
    inputSlot: FboSlot,
    sceneFbo: FboSlot,
    renderW: number,
    renderH: number,
    scale: number,
    project: Project,
    layer: Layer,
    wx: number,
    wy: number,
    lw: number,
    lh: number,
    wsx: number,
    wsy: number,
    px: number,
    py: number,
    vels: { velocity: [number, number]; angularVelocity: number; scaleVelocity: number },
    localTimeMs: number,
    screenToLayer: Float32Array,
    layerToScreen: Float32Array
  ): FboSlot | null {
    const prog = this.registry.getEffectProgram(def, group);
    if (!prog) return null;

    const bufferMap = new Map<string, FboSlot>();
    for (const pd of def.params) {
      if (pd.tag === 'texture' && pd.srcType === 'buffer' && pd.id) {
        const ds = Math.max(1, parseInt(pd.downsample || '1', 10) || 1);
        const bw = Math.max(8, Math.round(renderW / ds));
        const bh = Math.max(8, Math.round(renderH / ds));
        const bSlot = this.acquireFbo(bw, bh);
        this.clearFbo(bSlot, bw, bh, 0, 0, 0, 0);
        bufferMap.set(pd.id, bSlot);
      }
    }

    const passes = def.passes.length > 0 ? def.passes : [{}];
    const iterCount = def.iterations ? Math.min(10, Math.max(1, Math.round(Number(params[def.iterations]) || 1))) : 1;

    let iterInput = inputSlot;
    let iterOutput: FboSlot | null = null;
    const gl = this.gl;

    for (let it = 0; it < iterCount; it++) {
      iterOutput = this.acquireFbo(renderW, renderH);
      this.clearFbo(iterOutput, renderW, renderH, 0, 0, 0, 0);

      for (let pIdx = 0; pIdx < passes.length; pIdx++) {
        const pass = passes[pIdx];
        const targetSlot = pass.target ? bufferMap.get(pass.target) ?? iterOutput : iterOutput;

        if (pass.effect) {
          const subDef = getEffectById(pass.effect);
          if (subDef) {
            const srcSlot = pass.src ? bufferMap.get(pass.src) ?? iterInput : iterInput;
            const subParams = { ...params };
            const subRes = this.runEffectPasses(
              subDef,
              null,
              subParams,
              srcSlot,
              sceneFbo,
              targetSlot.width,
              targetSlot.height,
              scale,
              project,
              layer,
              wx,
              wy,
              lw,
              lh,
              wsx,
              wsy,
              px,
              py,
              vels,
              localTimeMs,
              screenToLayer,
              layerToScreen
            );
            if (subRes) {
              this.blitTexture(subRes.tex, targetSlot, targetSlot.width, targetSlot.height, 1, false);
              if (subRes !== srcSlot) this.releaseFbo(subRes);
            }
          }
          continue;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, targetSlot.fbo);
        gl.viewport(0, 0, targetSlot.width, targetSlot.height);
        gl.disable(gl.BLEND);
        gl.useProgram(prog.program);

        this.bindBuiltinUniforms(
          prog.uniforms,
          project,
          renderW,
          renderH,
          wx,
          wy,
          lw,
          lh,
          wsx,
          wsy,
          px,
          py,
          vels,
          localTimeMs,
          layer,
          pIdx,
          it,
          screenToLayer,
          layerToScreen
        );

        let texUnit = 0;
        for (const pd of def.params) {
          if (!pd.id) continue;
          if (pd.tag === 'texture') {
            let tex = this.dummyBlackTex;
            let tw = renderW;
            let th = renderH;
            if (pd.srcType === 'content') {
              tex = iterInput.tex;
              tw = iterInput.width;
              th = iterInput.height;
            } else if (pd.srcType === 'comp') {
              tex = sceneFbo.tex;
              tw = sceneFbo.width;
              th = sceneFbo.height;
            } else if (pd.srcType === 'buffer') {
              const b = bufferMap.get(pd.id);
              if (b) {
                tex = b.tex;
                tw = b.width;
                th = b.height;
              }
            } else if (pd.srcType === 'image' && pd.src) {
              const resTex = this.resourceTextures.get(pd.src);
              if (resTex) {
                tex = resTex.tex;
                tw = resTex.w;
                th = resTex.h;
              }
            }
            const uTex = prog.uniforms[`${pd.id}_texture`];
            const uSize = prog.uniforms[`${pd.id}_size`];
            if (tex === targetSlot.tex) {
              tex = this.dummyBlackTex;
            }
            if (uTex) {
              gl.activeTexture(gl.TEXTURE0 + texUnit);
              gl.bindTexture(gl.TEXTURE_2D, tex);
              gl.uniform1i(uTex, texUnit);
              texUnit++;
            }
            if (uSize) gl.uniform2f(uSize, tw, th);
          } else {
            const loc = prog.uniforms[sanitizeGlslUniformName(pd.id)];
            if (!loc) continue;
            const val = params[pd.id];
            if (pd.tag === 'spinner' || pd.tag === 'slider' || pd.tag === 'float') {
              gl.uniform1f(loc, Number(val) || 0);
            } else if (pd.tag === 'point') {
              const v = Array.isArray(val) ? val : [0, 0];
              gl.uniform2f(loc, Number(v[0]) || 0, Number(v[1]) || 0);
            } else if (pd.tag === 'xyz' || pd.tag === 'hue-disc') {
              const v = Array.isArray(val) ? val : [0, 0, 0];
              gl.uniform3f(loc, Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0);
            } else if (pd.tag === 'color') {
              const [r, g, b, a] = parseColorArgb(String(val || '#FFFFFFFF'));
              gl.uniform4f(loc, r, g, b, a);
            } else if (pd.tag === 'orient') {
              const inv = pd.invert === 'true';
              if (Array.isArray(val) && val.length === 4) {
                gl.uniformMatrix4fv(loc, false, quatToMat4(val as [number, number, number, number], inv));
              } else if (Array.isArray(val) && val.length === 3) {
                gl.uniformMatrix4fv(loc, false, orientEulerToMat4(val as [number, number, number], inv));
              } else {
                gl.uniformMatrix4fv(loc, false, quatToMat4([0, 0, 0, 1], inv));
              }
            } else if (pd.tag === 'selector') {
              gl.uniform1i(loc, Math.round(Number(val) || 0));
            } else if (pd.tag === 'switch') {
              gl.uniform1i(loc, val ? 1 : 0);
            }
          }
        }

        for (let u = texUnit; u < 8; u++) {
          gl.activeTexture(gl.TEXTURE0 + u);
          gl.bindTexture(gl.TEXTURE_2D, null);
        }
        this.drawQuad(prog.program);
        this.unbindTextureUnits(Math.max(texUnit, 2));
      }

      if (iterInput !== inputSlot) this.releaseFbo(iterInput);
      iterInput = iterOutput;
    }

    for (const b of bufferMap.values()) this.releaseFbo(b);
    return iterOutput;
  }

  private bindBuiltinUniforms(
    u: Record<string, WebGLUniformLocation | null>,
    project: Project,
    renderW: number,
    renderH: number,
    wx: number,
    wy: number,
    lw: number,
    lh: number,
    wsx: number,
    wsy: number,
    px: number,
    py: number,
    vels: { velocity: [number, number]; angularVelocity: number; scaleVelocity: number },
    localTimeMs: number,
    layer: Layer,
    passIdx: number,
    iterIdx: number,
    screenToLayer: Float32Array,
    layerToScreen: Float32Array
  ) {
    const gl = this.gl;
    const id4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const id3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    if (u.acProjectSize) gl.uniform2f(u.acProjectSize, project.width, project.height);
    if (u.acScreenSize) gl.uniform2f(u.acScreenSize, project.width, project.height);
    if (u.acPreviewSize) gl.uniform2f(u.acPreviewSize, renderW, renderH);
    if (u.acLayerScale) gl.uniform2f(u.acLayerScale, wsx, wsy);
    if (u.acLayerCenter) gl.uniform2f(u.acLayerCenter, wx, wy);
    if (u.acLayerCenterNorm) gl.uniform2f(u.acLayerCenterNorm, wx / project.width, 1.0 - wy / project.height);
    if (u.acLayerPivot) gl.uniform2f(u.acLayerPivot, px, py);
    if (u.acLayerSize) gl.uniform2f(u.acLayerSize, lw, lh);
    if (u.acLayerSizeNorm) gl.uniform2f(u.acLayerSizeNorm, lw / project.width, lh / project.height);
    if (u.acVelocity) gl.uniform2f(u.acVelocity, vels.velocity[0], vels.velocity[1]);
    if (u.acAngularVelocity) gl.uniform1f(u.acAngularVelocity, vels.angularVelocity);
    if (u.acScaleVelocity) gl.uniform1f(u.acScaleVelocity, vels.scaleVelocity);
    if (u.acTime) gl.uniform1f(u.acTime, localTimeMs / 1000);
    if (u.acStartTime) gl.uniform1f(u.acStartTime, layer.startTime / 1000);
    if (u.acEndTime) gl.uniform1f(u.acEndTime, layer.endTime / 1000);
    if (u.acPass) gl.uniform1i(u.acPass, passIdx);
    if (u.acIter) gl.uniform1i(u.acIter, iterIdx);
    if (u.acLayerTransform) gl.uniformMatrix3fv(u.acLayerTransform, false, id3);
    if (u.acTransform) gl.uniformMatrix4fv(u.acTransform, false, id4);
    if (u.acScreenToLayer) gl.uniformMatrix4fv(u.acScreenToLayer, false, screenToLayer);
    if (u.acLayerToScreen) gl.uniformMatrix4fv(u.acLayerToScreen, false, layerToScreen);
    if (u.acVtoRSpace) gl.uniformMatrix4fv(u.acVtoRSpace, false, id4);
    if (u.acShowGuides) gl.uniform1i(u.acShowGuides, 0);
  }

  private blitTransformedFbo(
    srcTex: WebGLTexture,
    dst: FboSlot,
    renderW: number,
    renderH: number,
    cx: number,
    cy: number,
    w: number,
    h: number,
    rotDeg: number,
    sx: number,
    sy: number,
    flipY = false,
    pivotX = 0,
    pivotY = 0,
    skewX = 0,
    skewY = 0,
    coverScaleX = 1,
    coverScaleY = 1
  ) {
    const key = '__internal_tf_blit';
    let prog = (this as any)._tfBlitProg as ReturnType<ShaderRegistry['compileRaw']> | undefined;
    if (!prog) {
      prog = this.registry.compileRaw(
        key,
        `#version 300 es
        precision highp float;
        layout(location = 0) in vec4 ac_internal_position;
        layout(location = 1) in vec2 ac_internal_texcoord;
        out vec2 vUv;
        void main() {
          gl_Position = ac_internal_position;
          vUv = ac_internal_texcoord;
        }`,
        `#version 300 es
        precision highp float;
        in vec2 vUv;
        out vec4 fragColor;
        uniform sampler2D uTex;
        uniform mat4 uScreenToLayer;
        uniform int uFlipY;
        uniform vec2 uCoverScale;
        void main() {
          vec2 luv = (vec4(vUv, 0.0, 1.0) * uScreenToLayer).xy;
          if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) {
            fragColor = vec4(0.0);
          } else {
            vec2 cuv = (luv - 0.5) * uCoverScale + 0.5;
            vec2 sampleUv = uFlipY == 1 ? vec2(cuv.x, 1.0 - cuv.y) : cuv;
            fragColor = texture(uTex, sampleUv);
          }
        }`
      );
      (this as any)._tfBlitProg = prog;
    }
    const { screenToLayer } = makeTransformMatrices(renderW, renderH, cx, cy, w, h, rotDeg, sx, sy, pivotX, pivotY, skewX, skewY);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, renderW, renderH);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(prog.uniforms.uTex, 0);
    gl.uniformMatrix4fv(prog.uniforms.uScreenToLayer, false, screenToLayer);
    if (prog.uniforms.uFlipY) gl.uniform1i(prog.uniforms.uFlipY, flipY ? 1 : 0);
    if (prog.uniforms.uCoverScale) gl.uniform2f(prog.uniforms.uCoverScale, coverScaleX, coverScaleY);
    this.drawQuad(prog.program);
    this.unbindTextureUnits(2);
  }

  private computeRepeatInstances(
    layer: Layer,
    normT: number
  ): { dx: number; dy: number; rot: number; scale: number; alpha: number }[] {
    let instances = [{ dx: 0, dy: 0, rot: 0, scale: 1, alpha: 1 }];
    for (const eff of layer.effects) {
      if (!eff.enabled) continue;
      if (eff.effectId === 'com.alightcreative.effects.repeat.line' || eff.effectId === 'com.alightcreative.effects.repeat') {
        const cnt = Math.min(80, Math.max(1, Math.round(Number(evalAnimatable(eff.params.count, normT, 5)) || 5)));
        const pos = evalAnimatable(eff.params.position, normT, [250, 0]) as [number, number];
        const offs = evalAnimatable(eff.params.offset, normT, [0, 0]) as [number, number];
        const ang = Number(evalAnimatable(eff.params.angle, normT, 0)) || 0;
        const sc = Number(evalAnimatable(eff.params.scale, normT, 1)) || 1;
        const al = Number(evalAnimatable(eff.params.alpha, normT, 1)) || 1;
        const next: typeof instances = [];
        for (const base of instances) {
          for (let i = 0; i < cnt; i++) {
            const f = cnt > 1 ? i / (cnt - 1) : 0;
            next.push({
              dx: base.dx + pos[0] * f + offs[0],
              dy: base.dy + pos[1] * f + offs[1],
              rot: base.rot + ang * f,
              scale: base.scale * Math.pow(sc, f),
              alpha: base.alpha * (1 - (1 - al) * f),
            });
          }
        }
        instances = next;
      } else if (eff.effectId === 'com.alightcreative.effects.repeat.radial') {
        const cnt = Math.min(80, Math.max(1, Math.round(Number(evalAnimatable(eff.params.count, normT, 6)) || 6)));
        const rad = Number(evalAnimatable(eff.params.radius, normT, 180)) || 180;
        const orient = Number(evalAnimatable(eff.params.orientation, normT, 0)) || 0;
        const startA = Number(evalAnimatable(eff.params.startAngle, normT, 0)) || 0;
        const sweepA = Number(evalAnimatable(eff.params.sweepAngle, normT, 360)) || 360;
        const next: typeof instances = [];
        for (const base of instances) {
          for (let i = 0; i < cnt; i++) {
            const deg = startA + (sweepA * i) / Math.max(1, cnt);
            const r = (deg * Math.PI) / 180;
            next.push({
              dx: base.dx + Math.cos(r) * rad,
              dy: base.dy + Math.sin(r) * rad,
              rot: base.rot + orient + deg,
              scale: base.scale,
              alpha: base.alpha,
            });
          }
        }
        instances = next;
      } else if (eff.effectId === 'com.alightcreative.effects.repeat.grid') {
        const cols = Math.min(12, Math.max(1, Math.round(Number(evalAnimatable(eff.params.columns, normT, 3)) || 3)));
        const rows = Math.min(12, Math.max(1, Math.round(Number(evalAnimatable(eff.params.rows, normT, 3)) || 3)));
        const sx = Number(evalAnimatable(eff.params.spacingX, normT, 150)) || 150;
        const sy = Number(evalAnimatable(eff.params.spacingY, normT, 150)) || 150;
        const next: typeof instances = [];
        for (const base of instances) {
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              next.push({
                dx: base.dx + (c - (cols - 1) / 2) * sx,
                dy: base.dy + (r - (rows - 1) / 2) * sy,
                rot: base.rot,
                scale: base.scale,
                alpha: base.alpha,
              });
            }
          }
        }
        instances = next;
      } else if (eff.effectId === 'com.alightcreative.effects.repeat.scatter') {
        const cnt = Math.min(80, Math.max(1, Math.round(Number(evalAnimatable(eff.params.count, normT, 8)) || 8)));
        const rad = Number(evalAnimatable(eff.params.radius, normT, 250)) || 250;
        const seed = Math.round(Number(evalAnimatable(eff.params.seed, normT, 1)) || 1) * 997 + 13;
        const rng = mulberry32(seed);
        const next: typeof instances = [];
        for (const base of instances) {
          for (let i = 0; i < cnt; i++) {
            const ang = rng() * Math.PI * 2;
            const dist = Math.sqrt(rng()) * rad;
            next.push({
              dx: base.dx + Math.cos(ang) * dist,
              dy: base.dy + Math.sin(ang) * dist,
              rot: base.rot + (rng() - 0.5) * 90,
              scale: base.scale * (0.5 + rng() * 0.8),
              alpha: base.alpha,
            });
          }
        }
        instances = next;
      }
    }
    return instances;
  }

  private rasterizeLayerToCanvas2D(
    project: Project,
    layer: Layer,
    normT: number,
    wx: number,
    wy: number,
    rotDeg: number,
    sx: number,
    sy: number,
    px: number,
    py: number,
    skewXDeg: number,
    skewYDeg: number,
    scale: number,
    renderW: number,
    renderH: number,
    instances: { dx: number; dy: number; rot: number; scale: number; alpha: number }[]
  ): { w: number; h: number } {
    if (this.canvas2d.width !== renderW || this.canvas2d.height !== renderH) {
      this.canvas2d.width = renderW;
      this.canvas2d.height = renderH;
    }
    const ctx = this.ctx2d;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, renderW, renderH);

    // Precompute shape path or bounds
    let shapePts: any[] | null = null;
    let svgPathEntry: { path: Path2D; w: number; h: number } | null = null;
    let logicalW = 300;
    let logicalH = 300;

    if (layer.type === 'shape' && layer.svgPathD) {
      let cached = this.svgPathCache.get(layer.svgPathD);
      if (!cached) {
        const b = measureSvgPathBounds(layer.svgPathD);
        cached = { path: new Path2D(layer.svgPathD), w: b.w, h: b.h };
        this.svgPathCache.set(layer.svgPathD, cached);
      }
      svgPathEntry = cached;
      logicalW = cached.w;
      logicalH = cached.h;
    } else if (layer.type === 'shape' && layer.shapeId) {
      const shapeDef: ShapeDef | undefined = getShapeById(layer.shapeId);
      if (shapeDef) {
        const sp: Record<string, any> = {};
        for (const pd of shapeDef.params) {
          if (!pd.id) continue;
          sp[pd.id] = evalAnimatable(layer.shapeParams?.[pd.id], normT, parseDefaultParamValue(pd));
        }
        shapePts = evaluateShapePath(shapeDef, sp);
        const b = measureShapeBounds(shapePts);
        logicalW = b.w;
        logicalH = b.h;
      }
    } else if (layer.type === 'freehand' && layer.freehandStrokes) {
      let maxX = 120;
      let maxY = 120;
      for (const st of layer.freehandStrokes) {
        const pad = st.width * 0.5;
        for (const pt of st.points) {
          maxX = Math.max(maxX, (Math.abs(pt.x) + pad) * 2);
          maxY = Math.max(maxY, (Math.abs(pt.y) + pad) * 2);
        }
      }
      logicalW = Math.min(4096, Math.max(64, maxX));
      logicalH = Math.min(4096, Math.max(64, maxY));
    } else if (layer.type === 'text' && layer.textData) {
      logicalW = Math.max(200, layer.textData.wrapWidth || 800);
      logicalH = Math.max(120, layer.textData.fontSize * 3);
    } else if (layer.type === 'vector' && layer.vectorPath) {
      logicalW = 500;
      logicalH = 500;
    }

    const skX = Math.tan((skewXDeg * Math.PI) / 180);
    const skY = Math.tan((skewYDeg * Math.PI) / 180);

    for (const inst of instances) {
      ctx.save();
      ctx.globalAlpha = clamp01(inst.alpha);
      ctx.translate((wx + inst.dx + px) * scale, (wy + inst.dy + py) * scale);
      ctx.rotate(((rotDeg + inst.rot) * Math.PI) / 180);
      if (Math.abs(skX) > 1e-4 || Math.abs(skY) > 1e-4) {
        ctx.transform(1, skY, skX, 1, 0, 0);
      }
      ctx.scale(sx * inst.scale * scale, sy * inst.scale * scale);
      ctx.translate(-px, -py);

      // Apply Drop Shadow if enabled
      if (layer.shadow.enabled) {
        const [sr, sg, sb, sa] = parseColorArgb(evalAnimatable(layer.shadow.color, normT, '#AA000000'));
        const shAlpha = clamp01(evalAnimatable(layer.shadow.alpha, normT, 0.7)) * sa;
        ctx.shadowColor = `rgba(${Math.round(sr * 255)}, ${Math.round(sg * 255)}, ${Math.round(sb * 255)}, ${shAlpha.toFixed(3)})`;
        ctx.shadowBlur = evalAnimatable(layer.shadow.size, normT, 12) * scale;
        ctx.shadowOffsetX = evalAnimatable(layer.shadow.offsetX, normT, 0) * scale;
        ctx.shadowOffsetY = evalAnimatable(layer.shadow.offsetY, normT, 8) * scale;
      }

      if (layer.type === 'shape' && svgPathEntry) {
        this.fillAndStrokeCurrentPath(ctx, layer, normT, logicalW, logicalH, svgPathEntry.path);
      } else if (layer.type === 'shape' && shapePts) {
        buildCanvasPath(ctx, shapePts);
        this.fillAndStrokeCurrentPath(ctx, layer, normT, logicalW, logicalH);
      } else if (layer.type === 'vector' && layer.vectorPath) {
        buildVectorPath(ctx, layer.vectorPath.points, layer.vectorPath.closed);
        this.fillAndStrokeCurrentPath(ctx, layer, normT, logicalW, logicalH);
      } else if (layer.type === 'freehand' && layer.freehandStrokes) {
        const progFx = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.drawing.progress');
        const pStart = progFx ? clamp01((Number(evalAnimatable(progFx.params.start, normT, 0)) || 0) / 100) : 0;
        const pEnd = progFx ? clamp01((Number(evalAnimatable(progFx.params.end, normT, 100)) || 100) / 100) : 1;
        const strokeColFx = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.drawing.strokecolor');
        const taperFx = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.drawing.stroketaper');

        for (const st of layer.freehandStrokes) {
          if (st.points.length < 2) continue;
          const i0 = Math.floor(pStart * (st.points.length - 1));
          const i1 = Math.max(i0 + 1, Math.ceil(pEnd * (st.points.length - 1)));
          const overrideCol = strokeColFx ? String(evalAnimatable(strokeColFx.params.color, normT, st.color)) : st.color;
          const [r, g, b, a] = parseColorArgb(overrideCol);
          ctx.strokeStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${(a * st.opacity).toFixed(3)})`;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          if (taperFx) {
            for (let i = i0 + 1; i <= i1 && i < st.points.length; i++) {
              const frac = (i - i0) / Math.max(1, i1 - i0);
              const taper = Math.sin(frac * Math.PI);
              ctx.lineWidth = Math.max(1, st.width * (0.2 + 0.9 * taper));
              ctx.beginPath();
              ctx.moveTo(st.points[i - 1].x, st.points[i - 1].y);
              ctx.lineTo(st.points[i].x, st.points[i].y);
              ctx.stroke();
            }
          } else {
            ctx.lineWidth = st.width;
            ctx.beginPath();
            ctx.moveTo(st.points[i0].x, st.points[i0].y);
            for (let i = i0 + 1; i <= i1 && i < st.points.length; i++) {
              ctx.lineTo(st.points[i].x, st.points[i].y);
            }
            ctx.stroke();
          }
        }
      } else if (layer.type === 'text' && layer.textData) {
        this.drawTextLayer(ctx, layer, normT);
      }

      ctx.restore();
    }

    return { w: logicalW, h: logicalH };
  }

  private fillAndStrokeCurrentPath(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    normT: number,
    w: number,
    h: number,
    path2d?: Path2D
  ) {
    if (layer.fill.type === 'solid') {
      const [r, g, b, a] = parseColorArgb(evalAnimatable(layer.fill.color, normT, '#FF00FFA8'));
      ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a.toFixed(3)})`;
      if (path2d) ctx.fill(path2d);
      else ctx.fill();
    } else if (layer.fill.type === 'gradient') {
      const [sx, sy] = layer.fill.gradientStart;
      const [ex, ey] = layer.fill.gradientEnd;
      let grad: CanvasGradient;
      if (layer.fill.gradientType === 'radial') {
        const rad = Math.max(10, Math.hypot((ex - sx) * w * 0.5, (ey - sy) * h * 0.5));
        grad = ctx.createRadialGradient(sx * w * 0.5, sy * h * 0.5, 0, sx * w * 0.5, sy * h * 0.5, rad);
      } else if (layer.fill.gradientType === 'sweep' && typeof ctx.createConicGradient === 'function') {
        grad = ctx.createConicGradient(0, sx * w * 0.5, sy * h * 0.5);
      } else {
        grad = ctx.createLinearGradient(sx * w * 0.5, sy * h * 0.5, ex * w * 0.5, ey * h * 0.5);
      }
      const stops = layer.fill.gradientStops.length > 0 ? layer.fill.gradientStops : [{ offset: 0, color: '#FF69FC97' }, { offset: 1, color: '#FF5CE5FF' }];
      for (const st of stops) {
        const [r, g, b, a] = parseColorArgb(st.color);
        grad.addColorStop(clamp01(st.offset), `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a.toFixed(3)})`);
      }
      ctx.fillStyle = grad;
      if (path2d) ctx.fill(path2d);
      else ctx.fill();
    }

    // Stroke (check Stroke Color + Drawing Progress effects!)
    const strokeColFx = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.drawing.strokecolor');
    const progFx = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.drawing.progress');
    if (layer.stroke.enabled || strokeColFx) {
      const colHex = strokeColFx
        ? String(evalAnimatable(strokeColFx.params.color, normT, '#FFFFFFFF'))
        : evalAnimatable(layer.stroke.color, normT, '#FFFFFFFF');
      const [r, g, b, a] = parseColorArgb(colHex);
      ctx.strokeStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.5, evalAnimatable(layer.stroke.width, normT, 6));
      ctx.lineCap = layer.stroke.cap;
      ctx.lineJoin = layer.stroke.join;
      if (progFx) {
        const pStart = clamp01((Number(evalAnimatable(progFx.params.start, normT, 0)) || 0) / 100);
        const pEnd = clamp01((Number(evalAnimatable(progFx.params.end, normT, 100)) || 100) / 100);
        const approxLen = (w + h) * 2.2;
        const visLen = Math.max(0, pEnd - pStart) * approxLen;
        ctx.setLineDash([visLen, approxLen * 4]);
        ctx.lineDashOffset = -pStart * approxLen;
      } else if (layer.stroke.dash) {
        ctx.setLineDash([layer.stroke.dashLength, layer.stroke.dashGap]);
        ctx.lineDashOffset = layer.stroke.dashOffset;
      } else {
        ctx.setLineDash([]);
      }
      if (path2d) ctx.stroke(path2d);
      else ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawTextLayer(ctx: CanvasRenderingContext2D, layer: Layer, normT: number) {
    const td = layer.textData!;
    let content = td.content || '';

    // Count Up / Down effect
    const counterFx = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.counter');
    if (counterFx) {
      const numVal = Number(evalAnimatable(counterFx.params.value, normT, 0)) || 0;
      const dec = Math.max(0, Math.min(6, Math.round(Number(evalAnimatable(counterFx.params.decimals, normT, 0)) || 0)));
      content = numVal.toFixed(dec);
    }

    // Text Progress effect
    const txtProgFx = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.textprogress');
    if (txtProgFx) {
      const start = clamp01(Number(evalAnimatable(txtProgFx.params.start, normT, 0)) || 0);
      const end = clamp01(Number(evalAnimatable(txtProgFx.params.end, normT, 1)) || 1);
      const i0 = Math.floor(start * content.length);
      const i1 = Math.ceil(end * content.length);
      content = content.slice(i0, i1);
    }

    // Text Spacing effect
    const spacingFx = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.textspacing');
    const extraLetterSpace = spacingFx ? (Number(evalAnimatable(spacingFx.params.letterspacing, normT, 0)) || 0) * td.fontSize * 0.5 : 0;
    const extraLineSpace = spacingFx ? (Number(evalAnimatable(spacingFx.params.linespacing, normT, 1)) || 1) : 1;

    // Text Transform effect
    const ttFx = layer.effects.find((e) => e.enabled && e.effectId === 'com.alightcreative.effects.texttransform');

    const fontSize = Math.max(8, td.fontSize);
    ctx.font = `700 ${fontSize}px "${td.fontFamily}", "Space Grotesk", "Roboto", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const [r, g, b, a] = parseColorArgb(td.color || '#FFFFFFFF');
    const baseFill = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a.toFixed(3)})`;
    const lines = content.split('\n');
    const lineH = fontSize * (td.lineHeight || 1.2) * extraLineSpace;
    const totalH = (lines.length - 1) * lineH;

    // Compute total character index for Text Transform
    const allChars = content.replace(/\n/g, '').length;
    let charGlobalIdx = 0;

    lines.forEach((line, li) => {
      const y = -totalH * 0.5 + li * lineH;
      const chars = Array.from(line);
      const letterSp = (td.letterSpacing || 0) + extraLetterSpace;
      const widths = chars.map((ch) => ctx.measureText(ch).width + letterSp);
      const lineW = widths.reduce((acc, v) => acc + v, 0);
      let cursorX = td.align === 'left' ? -td.wrapWidth * 0.45 : td.align === 'right' ? td.wrapWidth * 0.45 - lineW : -lineW * 0.5;

      chars.forEach((ch, ci) => {
        const cw = widths[ci];
        const cx = cursorX + cw * 0.5;
        cursorX += cw;

        let dx = 0, dy = 0, rot = 0, sc = 1, alpha = 1;
        let fillCol = baseFill;

        if (ttFx && allChars > 0) {
          const st = Number(evalAnimatable(ttFx.params.start, normT, 0)) || 0;
          const en = Number(evalAnimatable(ttFx.params.end, normT, 1)) || 1;
          const phase = Number(evalAnimatable(ttFx.params.phase, normT, 0)) || 0;
          const overlap = clamp01(Number(evalAnimatable(ttFx.params.overlap, normT, 0.4)) ?? 0.4);
          const easeIn = clamp01(Number(evalAnimatable(ttFx.params.easeIn, normT, 0.25)) ?? 0.25);
          const easeOut = clamp01(Number(evalAnimatable(ttFx.params.easeOut, normT, 0.75)) ?? 0.75);
          const shapeMode = Math.round(Number(evalAnimatable(ttFx.params.shape, normT, 0)) || 0);

          const posNorm = allChars > 1 ? charGlobalIdx / (allChars - 1) : 0;
          const shifted = ((posNorm + phase) % 1 + 1) % 1;
          const winStart = Math.min(st, en);
          const winEnd = Math.max(st + 0.001, en);
          const span = winEnd - winStart;
          const rampHalf = Math.max(0.02, span * (0.05 + overlap * 0.45));

          const smoothstep01 = (x: number) => {
            const c = clamp01(x);
            return c * c * (3 - 2 * c);
          };

          // Compute in-range weight (1 inside [winStart, winEnd], fading smoothly at edges)
          let inWeight = 0;
          if (shifted <= winStart - rampHalf || shifted >= winEnd + rampHalf) {
            inWeight = 0;
          } else if (shifted < winStart + rampHalf) {
            const u = (shifted - (winStart - rampHalf)) / (2 * rampHalf);
            inWeight = shapeMode === 0 ? (shifted >= winStart ? 1 : 0) : shapeMode === 1 ? clamp01(u) : smoothstep01(u);
          } else if (shifted > winEnd - rampHalf) {
            const u = (winEnd + rampHalf - shifted) / (2 * rampHalf);
            inWeight = shapeMode === 0 ? (shifted <= winEnd ? 1 : 0) : shapeMode === 1 ? clamp01(u) : smoothstep01(u);
          } else {
            inWeight = 1;
          }

          if (shapeMode === 3) {
            // Triangle wave across span
            const p = clamp01((shifted - winStart) / span);
            inWeight = 1 - Math.abs(p * 2 - 1);
          }

          const edgeBias = easeOut > easeIn ? (1 - inWeight) * clamp01(easeOut - easeIn + 0.5) : 1 - inWeight;
          const smoothInfl = clamp01(1 - inWeight + (1 - inWeight) * (edgeBias - (1 - inWeight)) * 0.25);
          const off = (evalAnimatable(ttFx.params.offset, normT, [0, 0]) as [number, number]) || [0, 0];
          const ang = Number(evalAnimatable(ttFx.params.angle, normT, 0)) || 0;
          const scP = Number(evalAnimatable(ttFx.params.scale, normT, 0)) || 0;
          const alP = Number(evalAnimatable(ttFx.params.alpha, normT, 0)) || 0;
          dx = off[0] * smoothInfl;
          dy = off[1] * smoothInfl;
          rot = ang * smoothInfl;
          sc = Math.max(0.01, 1 + scP * smoothInfl);
          alpha = clamp01(1 + alP * smoothInfl);
          if (evalAnimatable(ttFx.params.useFillColor, normT, false) && smoothInfl > 0.35) {
            const [fr, fg, fb, fa] = parseColorArgb(String(evalAnimatable(ttFx.params.fillColor, normT, '#FF00FF00')));
            fillCol = `rgba(${Math.round(fr * 255)}, ${Math.round(fg * 255)}, ${Math.round(fb * 255)}, ${fa.toFixed(3)})`;
          }
        }

        charGlobalIdx++;
        if (alpha <= 0.01) return;

        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.translate(cx + dx, y + dy);
        if (rot !== 0) ctx.rotate((rot * Math.PI) / 180);
        if (sc !== 1) ctx.scale(sc, sc);
        ctx.fillStyle = fillCol;
        ctx.fillText(ch, 0, 0);
        if (layer.stroke.enabled) {
          const [sr, sg, sb, sa] = parseColorArgb(evalAnimatable(layer.stroke.color, normT, '#FFFFFFFF'));
          ctx.strokeStyle = `rgba(${Math.round(sr * 255)}, ${Math.round(sg * 255)}, ${Math.round(sb * 255)}, ${sa.toFixed(3)})`;
          ctx.lineWidth = Math.max(1, evalAnimatable(layer.stroke.width, normT, 4));
          ctx.strokeText(ch, 0, 0);
        }
        ctx.restore();
      });
    });
  }

  public verifyAllShaders(): {
    totalShaders: number;
    compiled: number;
    failed: { id: string; file: string; group: string | null; error: string }[];
  } {
    return this.registry.verifyAllEffects(getEffects());
  }

  public dispose(): void {
    this.disposed = true;
    this.pauseAllVideos();
    this.registry.dispose();
    const gl = this.gl;
    for (const entry of this.mediaVideos.values()) {
      entry.video.src = '';
      gl.deleteTexture(entry.tex);
    }
    this.mediaVideos.clear();
    for (const entry of this.mediaImages.values()) {
      gl.deleteTexture(entry.tex);
    }
    this.mediaImages.clear();
    for (const slot of this.fboPool) {
      gl.deleteFramebuffer(slot.fbo);
      gl.deleteTexture(slot.tex);
    }
    this.fboPool = [];
    gl.deleteVertexArray(this.quadVao);
    gl.deleteBuffer(this.quadVbo);
    gl.deleteTexture(this.tempUploadTex);
    gl.deleteTexture(this.dummyBlackTex);
  }
}
