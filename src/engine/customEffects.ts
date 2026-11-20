import type {
  CustomEffectRecord,
  EffectDef,
  EffectParamDef,
  EffectPassDef,
  EffectShaderDef,
} from '../types/project';
import { ShaderRegistry } from './shaderCompiler';

const ALLOWED_PARAM_TAGS = new Set([
  'spinner',
  'slider',
  'float',
  'point',
  'xyz',
  'orient',
  'color',
  'hue-disc',
  'hue-ring',
  'selector',
  'switch',
  'section',
  'tip',
  'texture',
]);

// Matches UserParamParserKt.readTextureParam: content | buffer | comp | image | user.
// 'user' is AM's default when <texture> carries no src; the port still defaults to
// 'content' because a bare <texture id="inputImg" /> in this engine means "the layer".
const ALLOWED_TEX_SRC_TYPES = new Set(['content', 'buffer', 'comp', 'image', 'user']);
const ALLOWED_PASS_ATTRS = new Set(['target', 'effect', 'src', 'blend']);
const FORBIDDEN_SHADER_RE =
  /(#include|#extension|\bsampler3D\b|\bsamplerCube\b|\bimageLoad\b|https?:\/\/)/i;
const FORBIDDEN_SCRIPT_RE =
  /\b(fetch|XMLHttpRequest|eval|Function|document|window|localStorage|sessionStorage|indexedDB|postMessage|importScripts)\b|\bimport\s*\(|\brequire\s*\(|while\s*\(\s*true\s*\)/;

export interface CustomEffectValidationError {
  rule: number;
  message: string;
  hint: string;
}

export interface CustomEffectValidationResult {
  ok: boolean;
  error?: CustomEffectValidationError;
  def?: EffectDef;
  hash?: string;
  summary?: {
    name: string;
    id: string;
    paramCount: number;
    shaderCount: number;
    hasScript: boolean;
  };
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Rule 14: Execute effect script inside an isolated Web Worker with a hard wall-clock budget.
 * Terminates immediately on infinite loops so the UI thread can never lock up.
 */
async function testScriptInWorkerSandbox(script: string, budgetMs = 16): Promise<string | null> {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;

  const workerCode = `
    self.fetch = undefined;
    self.XMLHttpRequest = undefined;
    self.importScripts = undefined;
    const AM = {
      log: () => {},
      simplexNoise: (x, y) => Math.sin(x * 12.9898 + y * 78.233) * 0.5,
      triangle: (x) => Math.abs((((x + 0.75) % 1) + 1) % 1 - 0.5) * 4 - 1,
    };
    self.onmessage = (ev) => {
      try {
        const fn = new Function('AM', ev.data.script + '\\nreturn typeof animate === "function" ? animate : null;')(AM);
        if (!fn) { self.postMessage({ ok: true }); return; }
        for (let i = 0; i < 3; i++) {
          const env = { time: i * 0.5, absTime: i * 0.5, duration: 1, inTime: 0, fps: 30, frame: i * 15, editMode: 'none', selected: false, velocity: { x: 0, y: 0 }, angularVelocity: 0, scaleVelocity: 0 };
          const el = { alpha: 1, shaderGroups: null, text: 'Test', transform: { location: { x: 540, y: 540, z: 0 }, angle: 0, scale: { x: 1, y: 1 } } };
          fn(env, el, {}, {});
        }
        self.postMessage({ ok: true });
      } catch (err) {
        self.postMessage({ ok: false, error: String(err) });
      }
    };
  `;

  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);

  return new Promise<string | null>((resolve) => {
    const worker = new Worker(url);
    let settled = false;
    const finish = (err: string | null) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(err);
    };
    // Allow brief worker startup overhead + 3 × budgetMs execution cap
    const timer = window.setTimeout(() => {
      finish(`Script exceeded ${budgetMs}ms execution budget (possible infinite loop).`);
    }, Math.max(120, budgetMs * 6));

    worker.onmessage = (e) => {
      window.clearTimeout(timer);
      if (e.data?.ok) finish(null);
      else finish(e.data?.error || 'Script threw an error during sandbox test.');
    };
    worker.onerror = (e) => {
      window.clearTimeout(timer);
      finish(e.message || 'Worker script error.');
    };
    worker.postMessage({ script });
  });
}

function testGlslCompile(def: EffectDef): string | null {
  if (def.shaders.length === 0) return null;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  const registry = new ShaderRegistry(gl);
  try {
    const res = registry.verifyAllEffects([def]);
    if (res.failed.length > 0) {
      return res.failed.map((f) => f.error).join(' | ');
    }
    return null;
  } finally {
    registry.dispose();
  }
}

export async function validateCustomEffectXml(
  rawInput: string,
  existingBuiltInIds: Set<string>
): Promise<CustomEffectValidationResult> {
  // Rule 1 & 2: Size <= 64KB & BOM strip
  const normalized = rawInput.replace(/^\uFEFF/, '').trim();
  const byteSize = new TextEncoder().encode(normalized).length;
  if (byteSize === 0) {
    return { ok: false, error: { rule: 1, message: 'Empty input.', hint: 'Paste or drop a valid <effect> XML file.' } };
  }
  if (byteSize > 64 * 1024) {
    return {
      ok: false,
      error: { rule: 1, message: `Effect XML exceeds 64 KB limit (${Math.round(byteSize / 1024)} KB).`, hint: 'Trim unused code or split into a smaller effect.' },
    };
  }

  // Rule 3: No DOCTYPE / external entities
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(normalized)) {
    return {
      ok: false,
      error: { rule: 3, message: 'DOCTYPE is not allowed.', hint: 'Remove any <!DOCTYPE> or <!ENTITY> declaration.' },
    };
  }

  // Rule 4: Parse XML and verify single <effect> root
  const parser = new DOMParser();
  const doc = parser.parseFromString(normalized, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return {
      ok: false,
      error: { rule: 4, message: 'Not XML.', hint: 'Ensure input is well-formed XML with a single <effect> root.' },
    };
  }
  const root = doc.documentElement;
  const tag = root?.tagName?.toLowerCase();
  if (tag === 'scene') {
    return { ok: false, error: { rule: 4, message: 'This is a project file, not an effect.', hint: 'Use Import XML on the Home screen for <scene> projects.' } };
  }
  if (tag === 'presets' || tag === 'preset') {
    return { ok: false, error: { rule: 4, message: 'Preset packs are not supported here.', hint: 'Paste a single <effect> XML definition.' } };
  }
  if (tag === 'shapes' || tag === 'shape') {
    return { ok: false, error: { rule: 4, message: 'Shape XML is not supported here.', hint: 'Only <effect> XML can be imported.' } };
  }
  if (tag !== 'effect' || root.parentNode !== doc) {
    return { ok: false, error: { rule: 4, message: 'Only effect XML can be imported.', hint: 'Root tag must be a single <effect id="..." name="..."> element.' } };
  }

  // Rule 5 & 6: Required id & name, safe namespacing (never impersonate built-ins)
  const rawId = (root.getAttribute('id') || '').trim();
  const rawName = (root.getAttribute('name') || '').trim();
  if (!rawId || !rawName) {
    return {
      ok: false,
      error: { rule: 5, message: 'Missing required id or name attribute on <effect>.', hint: 'Add non-empty id="..." and name="..." attributes.' },
    };
  }
  if (!/^[a-z0-9._-]{3,80}$/i.test(rawId)) {
    return {
      ok: false,
      error: { rule: 6, message: `Invalid effect id "${rawId}".`, hint: 'Use 3–80 alphanumeric, dot, underscore, or hyphen characters.' },
    };
  }
  const slug = rawId.replace(/^com\.alightcreative\.effects?\./i, '').replace(/^custom\./i, '');
  const safeId = existingBuiltInIds.has(rawId) || /^com\.alightcreative\./i.test(rawId) ? `custom.${slug}` : rawId.startsWith('custom.') ? rawId : `custom.${slug}`;

  // Rule 7 & 8: Params allowlist & texture srcType safety
  const params: EffectParamDef[] = [];
  const paramsNode = root.querySelector('params');
  if (paramsNode) {
    for (const child of Array.from(paramsNode.children)) {
      const pTag = child.tagName.toLowerCase();
      if (!ALLOWED_PARAM_TAGS.has(pTag)) {
        return {
          ok: false,
          error: { rule: 7, message: `Disallowed param tag <${pTag}>.`, hint: 'Use only standard Alight Motion param tags (spinner, slider, color, point, switch, texture, etc.).' },
        };
      }
      const pDef: EffectParamDef = {
        tag: pTag as EffectParamDef['tag'],
        id: child.getAttribute('id') || undefined,
        label: child.getAttribute('label') || child.getAttribute('id') || undefined,
        text: child.getAttribute('text') || undefined,
        default: child.getAttribute('default') || undefined,
        value: child.getAttribute('value') || undefined,
        min: child.getAttribute('min') || undefined,
        max: child.getAttribute('max') || undefined,
        step: child.getAttribute('step') || undefined,
        type: child.getAttribute('type') || undefined,
        srcType: child.getAttribute('srcType') || undefined,
        downsample: child.getAttribute('downsample') || undefined,
        src: child.getAttribute('src') || undefined,
      };
      if (pTag === 'texture') {
        const st = pDef.srcType || 'content';
        if (!ALLOWED_TEX_SRC_TYPES.has(st)) {
          return {
            ok: false,
            error: { rule: 8, message: `Invalid texture srcType "${st}".`, hint: 'Use content, buffer, comp, image, or user.' },
          };
        }
        if (st === 'image' && pDef.src && /https?:\/\/|\.\./i.test(pDef.src)) {
          return {
            ok: false,
            error: { rule: 8, message: 'Remote or traversal image URLs are forbidden in custom effects.', hint: 'Reference only bundled resource texture paths.' },
          };
        }
      }
      if (pTag === 'selector') {
        pDef.choices = Array.from(child.querySelectorAll('choice')).map((ch, idx) => ({
          label: ch.getAttribute('label') || `Option ${idx + 1}`,
          value: ch.getAttribute('value') ?? String(idx),
          enableTargets: ch.getAttribute('enableTargets') || '',
        }));
      }
      params.push(pDef);
    }
  }

  // Rule 9: Passes <= 8 & attribute allowlist
  const passes: EffectPassDef[] = [];
  const passesNode = root.querySelector('passes');
  // AM carries the quality knob as <iterations param="iter" />, a sibling of
  // <passes>; the old attr form is still honoured for files authored against it.
  const iterationsNode = Array.from(root.children).find((c) => c.tagName.toLowerCase() === 'iterations');
  const iterations =
    iterationsNode?.getAttribute('param') || passesNode?.getAttribute('iterations') || null;
  if (passesNode) {
    const passEls = Array.from(passesNode.children).filter((c) => c.tagName.toLowerCase() === 'pass');
    // VisualEffectParserKt.readPasses: a present-but-empty <passes> is a hard error in AM.
    if (passEls.length === 0) {
      return {
        ok: false,
        error: {
          rule: 9,
          message: 'If <passes> is present, at least one <pass> must be specified.',
          hint: 'Add a <pass /> child, or remove the <passes> block entirely.',
        },
      };
    }
    if (passEls.length > 8) {
      return { ok: false, error: { rule: 9, message: `Too many passes (${passEls.length} > 8).`, hint: 'Limit custom effects to at most 8 passes.' } };
    }
    for (const pe of passEls) {
      for (const attr of Array.from(pe.attributes)) {
        if (!ALLOWED_PASS_ATTRS.has(attr.name)) {
          return { ok: false, error: { rule: 9, message: `Disallowed pass attribute "${attr.name}".`, hint: 'Allowed pass attributes: target, effect, src, blend.' } };
        }
      }
      passes.push({
        target: pe.getAttribute('target') || undefined,
        effect: pe.getAttribute('effect') || undefined,
        src: pe.getAttribute('src') || undefined,
        blend: pe.getAttribute('blend') || undefined,
      });
    }
  }

  // Rule 10 & 11: Shaders <= 8 & forbidden directives
  const shaderEls = Array.from(root.children).filter((c) => c.tagName.toLowerCase() === 'shader');
  if (shaderEls.length > 8) {
    return { ok: false, error: { rule: 10, message: `Too many shaders (${shaderEls.length} > 8).`, hint: 'Limit custom effects to at most 8 shader blocks.' } };
  }
  const shaders: EffectShaderDef[] = [];
  for (const se of shaderEls) {
    const sType = (se.getAttribute('type') || 'fragment').toLowerCase();
    if (sType !== 'fragment' && sType !== 'vertex') {
      return { ok: false, error: { rule: 10, message: `Invalid shader type "${sType}".`, hint: 'Use type="fragment" or type="vertex".' } };
    }
    const code = se.textContent || '';
    const badShader = code.match(FORBIDDEN_SHADER_RE);
    if (badShader) {
      return {
        ok: false,
        error: { rule: 11, message: `Forbidden GLSL construct "${badShader[0]}".`, hint: 'Remove #include, #extension, 3D/cube samplers, imageLoad, and URLs.' },
      };
    }
    shaders.push({
      type: sType,
      precision: se.getAttribute('precision') || 'high',
      group: se.getAttribute('group') || null,
      fastMath: se.getAttribute('fastMath') === 'true',
      code,
    });
  }

  // Rule 13 & 14: Optional script <= 16 KB, static allowlist, Worker sandbox
  const scriptEl = Array.from(root.children).find((c) => c.tagName.toLowerCase() === 'script');
  const script = scriptEl?.textContent?.trim() || null;
  if (script) {
    if (new TextEncoder().encode(script).length > 16 * 1024) {
      return { ok: false, error: { rule: 13, message: 'Effect script exceeds 16 KB limit.', hint: 'Shorten the animate() script.' } };
    }
    const badJs = script.match(FORBIDDEN_SCRIPT_RE);
    if (badJs) {
      return {
        ok: false,
        error: { rule: 13, message: `Disallowed API "${badJs[0]}" in effect script.`, hint: 'Scripts may only mutate el/transform/text/alpha using AM.* helpers.' },
      };
    }
    const sandboxErr = await testScriptInWorkerSandbox(script, 16);
    if (sandboxErr) {
      return {
        ok: false,
        error: { rule: 14, message: sandboxErr, hint: 'Ensure animate(env, el, p) finishes cleanly without infinite loops.' },
      };
    }
  }

  const def: EffectDef = {
    id: safeId,
    file: `${safeId}.xml`,
    name: rawName,
    desc: root.getAttribute('desc') || 'Custom imported XML effect.',
    category: 'custom',
    tags: (root.getAttribute('tags') || 'custom')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    thumb: '',
    deprecated: false,
    experimental: false,
    internal: false,
    overdraw: root.getAttribute('overdraw') === 'true',
    maxOverdraw: parseFloat(root.getAttribute('max-overdraw') || root.getAttribute('maxOverdraw') || '0') || 0,
    autoTransform: root.getAttribute('auto-transform') === 'true',
    compat: root.getAttribute('compat') || null,
    afxver: root.getAttribute('afxver') || null,
    affinity: root.getAttribute('affinity') || '',
    type: root.getAttribute('type') || '',
    params,
    passes,
    iterations,
    shaders,
    script,
    isCustom: true,
  };

  // Rule 12: Real WebGL2 ShaderRegistry compile verification
  const glslErr = testGlslCompile(def);
  if (glslErr) {
    return {
      ok: false,
      error: { rule: 12, message: `GLSL compile failed: ${glslErr}`, hint: 'Fix shader syntax or uniform names so it compiles in WebGL2.' },
    };
  }

  const hash = await sha256Hex(normalized);
  return {
    ok: true,
    def,
    hash,
    summary: {
      name: def.name,
      id: def.id,
      paramCount: def.params.length,
      shaderCount: def.shaders.length,
      hasScript: Boolean(def.script),
    },
  };
}

export function buildCustomEffectRecord(
  def: EffectDef,
  xml: string,
  hash: string,
  source: 'paste' | 'file'
): CustomEffectRecord {
  return {
    uid: `ceff_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    id: def.id,
    name: def.name,
    xml,
    source,
    created: Date.now(),
    hash,
    enabled: true,
    def,
  };
}
