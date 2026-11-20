import type { EffectDef, EffectParamDef, EffectShaderDef } from '../types/project';

export interface CompiledShaderProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

const DEFAULT_VERTEX_BODY = `
void main() {
    vertShaderInit();
}
`;

function renameIdentifier(code: string, name: string, replacement: string): string {
  return code.replace(new RegExp(`\\b${name}\\b`, 'g'), replacement);
}

const RESERVED_GLSL300 = [
  'sample',
  'smooth',
  'filter',
  'input',
  'output',
  'patch',
  'common',
  'partition',
  'active',
  'resource',
  'superp',
];

export function sanitizeGlslUniformName(name: string): string {
  return RESERVED_GLSL300.includes(name) ? `ac_var_${name}` : name;
}

/**
 * Transpiles Alight Motion's GLSL ES 1.00 effect shader snippet into strict WebGL2 (#version 300 es)
 * while preserving exact math, row-vector matrix semantics, and built-in Alight Motion uniforms.
 */
function transpileShaderCode(
  raw: string,
  isVertex: boolean,
  effectParamIds: Set<string>,
  textureParamIds: string[]
): string {
  let code = raw;

  // Strip any stray #version directives
  code = code.replace(/^\s*#version\s+\d+.*$/gm, '');

  // Convert storage qualifiers
  if (isVertex) {
    code = code.replace(/\battribute\b/g, 'in');
    code = code.replace(/\bvarying\b/g, 'out');
  } else {
    code = code.replace(/\bvarying\b/g, 'in');
  }

  // Split AC_ImageInfo struct field accesses (`foo.texture` / `foo.size`) into independent
  // uniforms to avoid ANGLE/D3D11 struct-with-sampler dead-field uniform location aliasing.
  for (const tid of textureParamIds) {
    code = code.replace(new RegExp(`\\b${tid}\\s*\\.\\s*texture\\b`, 'g'), `${tid}_texture`);
    code = code.replace(new RegExp(`\\b${tid}\\s*\\.\\s*size\\b`, 'g'), `${tid}_size`);
  }

  // Handle GLSL ES 3.00 reserved/built-in identifier collisions found in APK shaders:
  // 1) `sampler2D texture` -> `sampler2D ac_tex_arg` (avoid shadowing built-in `texture()`)
  if (/\bsampler2D\s+texture\b/.test(code)) {
    code = code.replace(/\bsampler2D\s+texture\b/g, 'sampler2D ac_tex_arg');
    code = code.replace(/texture2DCv\s*\(\s*texture\b/g, 'texture2DCv(ac_tex_arg');
    code = code.replace(/texture2D\s*\(\s*texture\b/g, 'texture2D(ac_tex_arg');
  }

  // 2) `mat4 inverse(...)` / `mat3 inverse(...)` user helpers -> `ac_u_inverse`
  if (/\bmat[234]\s+inverse\s*\(/.test(code)) {
    code = renameIdentifier(code, 'inverse', 'ac_u_inverse');
  }

  // 3) GLSL ES 3.00 reserved keywords used as variable or uniform names in APK shaders:
  for (const kw of RESERVED_GLSL300) {
    const declRe = new RegExp(
      `\\b(?:float|int|bool|vec[234]|ivec[234]|mat[234])\\s+${kw}\\b`
    );
    if (effectParamIds.has(kw) || declRe.test(code)) {
      code = code.replace(new RegExp(`(?<!\\.)\\b${kw}\\b`, 'g'), `ac_var_${kw}`);
    }
  }

  // 4) Prevent 0/0 NaN in warp & 3D box raytrace shaders on ANGLE/D3D11 (pinchbulge*, circularripple*, flip3)
  code = code.replace(/\bfloat\s+dist\s*=\s*length\s*\(([^)]+)\)\s*;/g, 'float dist = max(length($1), 0.00001);');
  code = code.replace(/\bnormalize\s*\(\s*st\s*\)/g, '(length(st) > 0.00001 ? normalize(st) : vec2(0.0))');
  code = code.replace(/\bvec3\s+m\s*=\s*1\.0\s*\/\s*rdd\s*;/g, 'vec3 m = 1.0 / mix(rdd, vec3(1e-5), lessThan(abs(rdd), vec3(1e-5)));');
  code = code.replace(/max\(0\.00001,thickness\/10\.0\)\s*:\s*0\.00001/g, 'max(0.0005, thickness/10.0) : 0.0005');

  return code;
}

function paramUniformDecl(p: EffectParamDef): string {
  if (!p.id) return '';
  const uid = sanitizeGlslUniformName(p.id);
  switch (p.tag) {
    case 'texture':
      return `uniform sampler2D ${p.id}_texture;\nuniform vec2 ${p.id}_size;`;
    case 'spinner':
    case 'slider':
    case 'float':
      return `uniform float ${uid};`;
    case 'point':
      return `uniform vec2 ${uid};`;
    case 'hue-ring':
      // UserParamParserKt.readHueRingParam reads a single float, not a vec3.
      return `uniform float ${uid};`;
    case 'xyz':
    case 'hue-disc':
      return `uniform vec3 ${uid};`;
    case 'color':
      return `uniform vec4 ${uid};`;
    case 'orient':
      return `uniform mat4 ${uid};`;
    case 'selector':
      return `uniform int ${uid};`;
    case 'switch':
      return `uniform bool ${uid};`;
    default:
      return '';
  }
}

export function buildVertexSource(effect: EffectDef, customVert?: EffectShaderDef | null): string {
  if (effect.compat && effect.compat !== 'acScreenNorm-y') {
    console.warn(`[shaderCompiler] Unknown compat mode "${effect.compat}" on ${effect.id}`);
  }
  // Note: compat="acScreenNorm-y" (colorbalance, mattefringe, ominoglass, chromaticzoomblur)
  // already matches our bottom-up WebGL2 acScreenNorm / acVtoRSpace / acLayerToScreen pairing;
  // flipping acScreenNorm.y alone would invert texture2DCv() sampling upside-down.
  const paramIds = new Set(effect.params.map((p) => p.id).filter(Boolean) as string[]);
  const texIds = effect.params.filter((p) => p.tag === 'texture' && p.id).map((p) => p.id!);
  const paramUniforms = effect.params.map(paramUniformDecl).filter(Boolean).join('\n');
  const body = customVert ? transpileShaderCode(customVert.code, true, paramIds, texIds) : DEFAULT_VERTEX_BODY;

  return `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec4 ac_internal_position;
layout(location = 1) in vec2 ac_internal_texcoord;
out vec2 acScreenNorm;
out vec2 acLayerNorm;

uniform vec2 acProjectSize;
uniform vec2 acScreenSize;
uniform vec2 acPreviewSize;
uniform vec2 acLayerScale;
uniform vec2 acLayerCenter;
uniform vec2 acLayerCenterNorm;
uniform vec2 acLayerPivot;
uniform vec2 acLayerSize;
uniform vec2 acLayerSizeNorm;
uniform vec2 acVelocity;
uniform float acAngularVelocity;
uniform float acScaleVelocity;
uniform float acTime;
uniform float acStartTime;
uniform float acEndTime;
uniform int acPass;
uniform int acIter;
uniform mat3 acLayerTransform;
uniform mat4 acTransform;
uniform mat4 acScreenToLayer;
uniform mat4 acLayerToScreen;
uniform mat4 acVtoRSpace;
uniform bool acShowGuides;

struct AC_ImageInfo {
    sampler2D texture;
    vec2 size;
};

${paramUniforms}

void vertShaderInit() {
    gl_Position = ac_internal_position;
    acScreenNorm = (vec4(ac_internal_texcoord, 0.0, 1.0) * acTransform).xy;
    acLayerNorm = (vec4(acScreenNorm, 0.0, 1.0) * acScreenToLayer).xy;
}

${body}
`;
}

export function buildFragmentSource(effect: EffectDef, frag: EffectShaderDef): string {
  const paramIds = new Set(effect.params.map((p) => p.id).filter(Boolean) as string[]);
  const texIds = effect.params.filter((p) => p.tag === 'texture' && p.id).map((p) => p.id!);
  const paramUniforms = effect.params.map(paramUniformDecl).filter(Boolean).join('\n');
  const body = transpileShaderCode(frag.code, false, paramIds, texIds);

  return `#version 300 es
precision highp float;
precision highp int;

out vec4 ac_fragColor;
#define gl_FragColor ac_fragColor

uniform vec2 acProjectSize;
uniform vec2 acScreenSize;
uniform vec2 acPreviewSize;
uniform vec2 acLayerScale;
uniform vec2 acLayerCenter;
uniform vec2 acLayerCenterNorm;
uniform vec2 acLayerPivot;
uniform vec2 acLayerSize;
uniform vec2 acLayerSizeNorm;
uniform vec2 acVelocity;
uniform float acAngularVelocity;
uniform float acScaleVelocity;
uniform float acTime;
uniform float acStartTime;
uniform float acEndTime;
uniform int acPass;
uniform int acIter;
uniform mat3 acLayerTransform;
uniform mat4 acScreenToLayer;
uniform mat4 acLayerToScreen;
uniform mat4 acVtoRSpace;
uniform bool acShowGuides;

in vec2 acScreenNorm;
in vec2 acLayerNorm;

struct AC_ImageInfo {
    sampler2D texture;
    vec2 size;
};

vec4 texture2D(sampler2D s, vec2 uv) {
    return texture(s, uv);
}

vec4 texture2DCv(sampler2D ac_tex, vec2 position) {
    vec2 rSpace = (vec4(position.xy, 0.0, 1.0) * acVtoRSpace).xy;
    return texture(ac_tex, rSpace);
}

vec2 getTexSize(vec2 size) {
    vec2 rSpace = (vec4(size.xy, 0.0, 0.0) * acVtoRSpace).xy;
    return rSpace;
}

vec2 saturate(vec2 v) { return clamp(v, 0.0, 1.0); }
vec3 saturate(vec3 v) { return clamp(v, 0.0, 1.0); }
vec4 saturate(vec4 v) { return clamp(v, 0.0, 1.0); }
float saturate(float v) { return clamp(v, 0.0, 1.0); }

${paramUniforms}

${body}
`;
}

export class ShaderRegistry {
  private gl: WebGL2RenderingContext;
  private cache = new Map<string, CompiledShaderProgram>();
  private errors = new Map<string, string>();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  private compileStage(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create WebGLShader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || 'Unknown compile error';
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  public compileRaw(key: string, vertSrc: string, fragSrc: string): CompiledShaderProgram {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const gl = this.gl;
    const vs = this.compileStage(gl.VERTEX_SHADER, vertSrc);
    let fs: WebGLShader;
    try {
      fs = this.compileStage(gl.FRAGMENT_SHADER, fragSrc);
    } catch (e) {
      gl.deleteShader(vs);
      throw e;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error('Failed to create WebGLProgram');
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'ac_internal_position');
    gl.bindAttribLocation(program, 1, 'ac_internal_texcoord');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || 'Unknown link error';
      gl.deleteProgram(program);
      throw new Error(log);
    }

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) {
        uniforms[info.name] = gl.getUniformLocation(program, info.name);
      }
    }

    const entry = { program, uniforms };
    this.cache.set(key, entry);
    return entry;
  }

  public getEffectProgram(effect: EffectDef, group: string | null = null): CompiledShaderProgram | null {
    const fragShaders = effect.shaders.filter((s) => s.type === 'fragment');
    if (fragShaders.length === 0) return null;

    let frag = fragShaders.find((s) => (s.group ?? null) === group);
    if (!frag) frag = fragShaders.find((s) => (s.group ?? '0') === (group ?? '0')) ?? fragShaders[0];

    const vertShaders = effect.shaders.filter((s) => s.type === 'vertex');
    let vert: EffectShaderDef | null = null;
    if (vertShaders.length > 0) {
      vert = vertShaders.find((s) => (s.group ?? null) === (frag!.group ?? null)) ?? vertShaders[0];
    }

    const key = `${effect.id}::${frag.group ?? 'default'}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    if (this.errors.has(key)) return null;

    try {
      const vsrc = buildVertexSource(effect, vert);
      const fsrc = buildFragmentSource(effect, frag);
      return this.compileRaw(key, vsrc, fsrc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errors.set(key, msg);
      return null;
    }
  }

  public verifyAllEffects(effects: EffectDef[]): {
    totalShaders: number;
    compiled: number;
    failed: { id: string; file: string; group: string | null; error: string }[];
  } {
    let totalShaders = 0;
    let compiled = 0;
    const failed: { id: string; file: string; group: string | null; error: string }[] = [];

    for (const effect of effects) {
      const fragShaders = effect.shaders.filter((s) => s.type === 'fragment');
      for (const frag of fragShaders) {
        totalShaders++;
        const grp = frag.group ?? null;
        const key = `${effect.id}::${frag.group ?? 'default'}`;
        const vertShaders = effect.shaders.filter((s) => s.type === 'vertex');
        const vert =
          vertShaders.length > 0
            ? vertShaders.find((s) => (s.group ?? null) === grp) ?? vertShaders[0]
            : null;
        try {
          const vsrc = buildVertexSource(effect, vert);
          const fsrc = buildFragmentSource(effect, frag);
          this.compileRaw(key, vsrc, fsrc);
          compiled++;
        } catch (err) {
          failed.push({
            id: effect.id,
            file: effect.file,
            group: grp,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return { totalShaders, compiled, failed };
  }

  public dispose(): void {
    for (const entry of this.cache.values()) {
      this.gl.deleteProgram(entry.program);
    }
    this.cache.clear();
    this.errors.clear();
  }
}
