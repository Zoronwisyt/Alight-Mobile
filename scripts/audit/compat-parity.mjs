// APK <-> web parity audit for effect definitions and effect presets.
//
// Read-only. Loads the 5.0.280 APK's assets/effects/*.xml and assets/effects/presets/*.xml,
// compares them field by field against public/am/effects.json and public/am/presets.json,
// prints a summary, and writes the full diff to scripts/audit/out/compat-parity.json.
//
// Usage:  node scripts/audit/compat-parity.mjs [--apk <path>] [--web <path>] [--verbose]
//
// Exit code is 0 even when drift is found — this is a report, not a gate. Wire it into CI by
// asserting on the counters it prints.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const REPO = path.resolve(HERE, '..', '..');
const APK = argOf(
  '--apk',
  'C:/Users/jeduc/Downloads/AM Web 2/Alight_Motion_5.0.280_1789568706_latestmodapks.com'
);
const WEB = argOf('--web', REPO);
const VERBOSE = args.includes('--verbose');

const OUT_DIR = path.join(HERE, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------- helpers ----
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

const decodeEntities = (v) =>
  v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** Attribute reader for the machine-generated subset of XML used by AM. */
function attrsOf(s) {
  const a = {};
  const re = /([a-zA-Z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) a[m[1]] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
  return a;
}

const squash = (s) =>
  (s || '')
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

const numOf = (v) => (v === null || v === undefined || v === '' ? null : String(Number(v)));

/** Numeric compare for scalars and comma lists, string compare otherwise. */
function valEq(key, a, b) {
  const as = a === undefined || a === null ? '' : String(a).trim();
  const bs = b === undefined || b === null ? '' : String(b).trim();
  const numeric = ['default', 'min', 'max', 'step', 'ticks', 'snap', 'multiplier'];
  if (numeric.includes(key)) {
    if (as.includes(',') || bs.includes(',')) {
      const pa = as.split(',').map((x) => Number(x.trim()));
      const pb = bs.split(',').map((x) => Number(x.trim()));
      if (pa.length !== pb.length) return false;
      return pa.every((v, i) =>
        Number.isFinite(v) && Number.isFinite(pb[i]) ? v === pb[i] : as === bs
      );
    }
    const na = Number(as);
    const nb = Number(bs);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  return as.toLowerCase() === bs.toLowerCase();
}

// ------------------------------------------------------------ effect parse ---
function parseEffectFile(file) {
  const xml = stripComments(fs.readFileSync(file, 'utf8'));
  const rootM = /<effect\b([^>]*)>/.exec(xml);
  const root = attrsOf(rootM ? rootM[1] : '');

  const block = /<params\b[^>]*>([\s\S]*?)<\/params>/.exec(xml);
  const params = [];
  if (block) {
    const re = /<([a-zA-Z0-9:_-]+)\b([^>]*?)(\/?)>/g;
    let m;
    while ((m = re.exec(block[1]))) {
      if (m[1] === 'choice') continue;
      params.push({ tag: m[1], attrs: attrsOf(m[2]) });
    }
  }

  const iterM = /<iterations\b([^>]*?)\/?>/.exec(xml);
  const shaders = [...xml.matchAll(/<shader\b([^>]*)>([\s\S]*?)<\/shader>/g)].map((x) => ({
    attrs: attrsOf(x[1]),
    code: x[2],
  }));

  return { root, params, iterations: iterM ? attrsOf(iterM[1]) : null, shaders };
}

function selectorChoices(xmlRaw, id) {
  const m = new RegExp(`<selector id="${id}"[\\s\\S]*?</selector>`).exec(stripComments(xmlRaw));
  return m ? [...m[0].matchAll(/<choice\b[^>]*value="([^"]*)"/g)].map((x) => x[1]) : [];
}

// ------------------------------------------------------------- effect pass ---
function auditEffects() {
  const effectsJson = JSON.parse(fs.readFileSync(path.join(WEB, 'public/am/effects.json'), 'utf8'));
  const byFile = new Map(effectsJson.map((e) => [e.file, e]));
  const dir = path.join(APK, 'assets/effects');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xml'));

  const R = {
    counts: { xml: files.length, json: effectsJson.length },
    missingInJson: [],
    missingInApk: [],
    paramMembership: [],
    paramOrder: [],
    paramValue: [],
    selectorChoiceCount: [],
    iterationsDiff: [],
    shaderCount: [],
    shaderSource: [],
    shaderAttrDefaults: [],
    rootAttr: [],
    nonParamEntries: [],
  };

  for (const f of files) if (!byFile.has(f)) R.missingInJson.push(f);
  for (const e of effectsJson) if (!files.includes(e.file)) R.missingInApk.push(e.file);

  for (const f of files) {
    const j = byFile.get(f);
    if (!j) continue;
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const a = parseEffectFile(path.join(dir, f));
    const jp = j.params || [];

    // `<section>` / `<tip>` carry no id — they are UI separators, not parameters.
    for (const p of jp) if (!p.id) R.nonParamEntries.push({ file: f, tag: p.tag });

    const apkIds = a.params.map((p) => p.attrs.id).filter(Boolean);
    const jsonIds = jp.map((p) => p.id).filter(Boolean);
    const onlyApk = apkIds.filter((x) => !jsonIds.includes(x));
    const onlyJson = jsonIds.filter((x) => !apkIds.includes(x));
    if (onlyApk.length || onlyJson.length) R.paramMembership.push({ file: f, onlyApk, onlyJson });
    else if (apkIds.join(',') !== jsonIds.join(',')) R.paramOrder.push({ file: f, apk: apkIds, json: jsonIds });

    for (const p of a.params) {
      const id = p.attrs.id;
      if (!id) continue;
      const q = jp.find((x) => x.id === id);
      if (!q) continue;
      const checks = [];
      if (p.tag !== q.tag) checks.push({ k: 'tag', apk: p.tag, json: q.tag });
      for (const k of ['default', 'min', 'max', 'step', 'type', 'style', 'srcType', 'invert', 'multiplier', 'ticks', 'snap'])
        if (!valEq(k, p.attrs[k], q[k])) checks.push({ k, apk: p.attrs[k] ?? null, json: q[k] ?? null });
      if (checks.length) R.paramValue.push({ file: f, id, checks });

      if (p.tag === 'selector') {
        const n = selectorChoices(raw, id).length;
        const jn = (q.choices || []).length;
        if (n !== jn) R.selectorChoiceCount.push({ file: f, id, apk: n, json: jn });
      }
    }

    const aIter = a.iterations?.param ?? null;
    if ((aIter || null) !== ((j.iterations ?? null) || null))
      R.iterationsDiff.push({ file: f, apk: aIter, json: j.iterations ?? null });

    if (a.shaders.length !== (j.shaders || []).length)
      R.shaderCount.push({ file: f, apk: a.shaders.length, json: (j.shaders || []).length });

    a.shaders.forEach((s, i) => {
      const js = (j.shaders || [])[i];
      if (!js) return;
      if (squash(s.code) !== squash(js.code)) R.shaderSource.push({ file: f, index: i });
      for (const k of ['type', 'precision', 'fastMath', 'group']) {
        const av = s.attrs[k] === undefined ? null : String(s.attrs[k]);
        const jv = js[k] === undefined || js[k] === null ? null : String(js[k]);
        const norm = (v) => (v === 'false' ? null : v);
        if (norm(av) !== norm(jv)) R.shaderAttrDefaults.push({ file: f, index: i, k, apk: av, json: jv });
      }
    });

    // root attributes that can change how an effect is composited
    for (const k of ['deprecated', 'experimental', 'internal', 'overdraw', 'max-overdraw', 'compat', 'afxver', 'affinity', 'type', 'category']) {
      const av = a.root[k] === undefined ? null : String(a.root[k]);
      const jv =
        k === 'max-overdraw'
          ? j.maxOverdraw == null ? null : String(j.maxOverdraw)
          : j[k] === undefined || j[k] === null ? null : String(j[k]);
      const norm = (v) => (v === null || v === '' || v === 'false' || v === '0' ? null : v);
      if (norm(av) !== norm(jv)) R.rootAttr.push({ file: f, k, apk: av, json: jv });
    }
  }

  return R;
}

// ------------------------------------------------------------- preset pass ---
function auditPresets() {
  const presetsJson = JSON.parse(fs.readFileSync(path.join(WEB, 'public/am/presets.json'), 'utf8'));
  const dir = path.join(APK, 'assets/effects/presets');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xml'));

  const apk = [];
  const packAlias = new Map();
  for (const f of files) {
    const xml = stripComments(fs.readFileSync(path.join(dir, f), 'utf8'));
    const filePack = f.replace(/\.xml$/, '');
    const sceneM = /<scene\b([^>]*)>/.exec(xml);
    const sceneTitle = (sceneM ? attrsOf(sceneM[1]).title : null) ?? filePack;
    // the extractor keys packs by scene title for some files and by file name for others
    packAlias.set(sceneTitle, filePack);

    const shapeRe = /<shape\b([^>]*)>([\s\S]*?)<\/shape>/g;
    let sm;
    while ((sm = shapeRe.exec(xml))) {
      const sa = attrsOf(sm[1]);
      const effRe = /<effect\b([^>]*)>([\s\S]*?)<\/effect>/g;
      let em;
      while ((em = effRe.exec(sm[2]))) {
        const ea = attrsOf(em[1]);
        const props = [];
        const pRe = /<property\b([^>]*?)(\/>|>([\s\S]*?)<\/property>)/g;
        let pm;
        while ((pm = pRe.exec(em[2]))) {
          const a = attrsOf(pm[1]);
          if (!a.name) continue;
          const kfs = pm[3]
            ? [...pm[3].matchAll(/<kf\b([^>]*?)\/?>/g)].map((k) => attrsOf(k[1]))
            : [];
          props.push({ name: a.name, type: a.type ?? null, value: a.value ?? null, kfs });
        }
        apk.push({
          pack: sceneTitle,
          name: sa.label ?? null,
          effectId: ea.id,
          locallyApplied: ea.locallyApplied === 'true',
          props,
        });
      }
    }
  }

  const jsonFlat = [];
  for (const [effectId, arr] of Object.entries(presetsJson)) for (const p of arr) jsonFlat.push({ effectId, ...p });

  const keyOf = (x) => `${packAlias.get(x.pack) ?? x.pack}|${x.name}|${x.effectId}`;
  const apkByKey = new Map(apk.map((x) => [keyOf(x), x]));
  const jsonByKey = new Map(jsonFlat.map((x) => [keyOf(x), x]));

  const R = {
    counts: { apkPresets: apk.length, jsonPresets: jsonFlat.length, packs: files.length },
    missingInJson: [],
    missingInApk: [],
    locallyAppliedDiff: [],
    propDiff: [],
    kfDiff: [],
    effectIdDrift: [],
  };

  for (const [k] of apkByKey) if (!jsonByKey.has(k)) R.missingInJson.push(k);
  for (const [k] of jsonByKey) if (!apkByKey.has(k)) R.missingInApk.push(k);

  for (const [k, a] of apkByKey) {
    const j = jsonByKey.get(k);
    if (!j) continue;
    if (a.locallyApplied !== Boolean(j.locallyApplied))
      R.locallyAppliedDiff.push({ k, apk: a.locallyApplied, json: j.locallyApplied });

    const ap = new Map(a.props.map((p) => [p.name, p]));
    const jp = new Map((j.props || []).map((p) => [p.name, p]));

    for (const [n, p] of ap) {
      const q = jp.get(n);
      if (!q) {
        R.propDiff.push({ k, prop: n, kind: 'missing-in-json' });
        continue;
      }
      if (numOf(p.value) !== numOf(q.value))
        R.propDiff.push({ k, prop: n, kind: 'value', apk: p.value, json: q.value });
      const jk = q.kfs || [];
      if (p.kfs.length !== jk.length) {
        R.kfDiff.push({ k, prop: n, kind: 'count', apk: p.kfs.length, json: jk.length });
        continue;
      }
      p.kfs.forEach((f, i) => {
        const g = jk[i];
        if (numOf(f.t) !== numOf(g.t) || numOf(f.v) !== numOf(g.v))
          R.kfDiff.push({ k, prop: n, kind: 'kf', i, apk: [f.t, f.v], json: [g.t, g.v] });
        if ((f.e ?? '') !== (g.e ?? ''))
          R.kfDiff.push({ k, prop: n, kind: 'easing', i, apk: f.e ?? '', json: g.e ?? '' });
      });
    }
    for (const [n] of jp) if (!ap.has(n)) R.propDiff.push({ k, prop: n, kind: 'extra-in-json' });
  }

  const apkIds = new Set(apk.map((x) => x.effectId));
  const jsonIds = new Set(Object.keys(presetsJson));
  R.effectIdDrift = [
    ...[...apkIds].filter((x) => !jsonIds.has(x)).map((id) => ({ id, side: 'apk-only' })),
    ...[...jsonIds].filter((x) => !apkIds.has(x)).map((id) => ({ id, side: 'json-only' })),
  ];

  return R;
}

// ------------------------------------------------- reachability of presets ---
function auditPresetReachability() {
  const effects = JSON.parse(fs.readFileSync(path.join(WEB, 'public/am/effects.json'), 'utf8'));
  const presets = JSON.parse(fs.readFileSync(path.join(WEB, 'public/am/presets.json'), 'utf8'));
  const byId = new Map(effects.map((e) => [e.id, e]));

  const dropped = new Map();
  let total = 0;
  let locallyAppliedFalse = 0;
  let locallyAppliedFalseWithComp = 0;

  for (const [effId, arr] of Object.entries(presets)) {
    const def = byId.get(effId);
    for (const p of arr) {
      total++;
      if (p.locallyApplied === false) {
        locallyAppliedFalse++;
        if ((def?.params || []).some((x) => x.srcType === 'comp')) locallyAppliedFalseWithComp++;
      }
      for (const pr of p.props || []) {
        const declared = (def?.params || []).some((x) => x.id === pr.name);
        if (!declared) dropped.set(pr.name, (dropped.get(pr.name) || 0) + 1);
      }
    }
  }

  return {
    totalPresets: total,
    presetsWithLocallyAppliedFalse: locallyAppliedFalse,
    ofThoseDeclaringCompTexture: locallyAppliedFalseWithComp,
    effectsDeclaringCompTexture: effects.filter((e) => e.params.some((p) => p.srcType === 'comp')).length,
    // a preset property with no matching <params> entry is silently ignored by the renderer
    presetPropsDroppedByRenderer: [...dropped.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// -------------------------------------------------------------------- run ----
const effects = auditEffects();
const presets = auditPresets();
const reach = auditPresetReachability();

const report = { generatedAt: new Date().toISOString(), apk: APK, web: WEB, effects, presets, reachability: reach };
fs.writeFileSync(path.join(OUT_DIR, 'compat-parity.json'), JSON.stringify(report, null, 1));

const counter = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));

console.log('EFFECTS', JSON.stringify(effects.counts));
console.log('EFFECT DRIFT', JSON.stringify(counter(effects)));
console.log('PRESETS', JSON.stringify(presets.counts));
console.log('PRESET DRIFT', JSON.stringify(counter(presets)));
console.log('REACHABILITY', JSON.stringify(reach, null, 1));
if (VERBOSE) {
  console.log('--- paramValue ---');
  console.log(JSON.stringify(effects.paramValue.slice(0, 40), null, 1));
  console.log('--- rootAttr ---');
  console.log(JSON.stringify(effects.rootAttr.slice(0, 40), null, 1));
  console.log('--- propDiff ---');
  console.log(JSON.stringify(presets.propDiff.slice(0, 40), null, 1));
}
console.log('full report ->', path.join(OUT_DIR, 'compat-parity.json'));
