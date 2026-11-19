// Downloads Google Fonts on demand via CSS2 API (display=block), fetches the woff2/ttf
// bytes directly from fonts.gstatic.com, registers them via FontFace, and caches them in IndexedDB.

import { saveAndRegisterFontBytes } from '../store/fontStore';
import type { FaceStyle } from './fontRegistry';

const GF_BASE = 'https://fonts.googleapis.com/css2';

interface ParsedCssFace {
  weight: number;
  style: FaceStyle;
  url: string;
}

function parseGoogleCssFaces(css: string): ParsedCssFace[] {
  const blocks = css.match(/@font-face\s*\{[^}]+\}/g) || [];
  const faces: ParsedCssFace[] = [];
  for (const block of blocks) {
    // Prefer latin subset when multiple unicode-range blocks exist for same weight/style
    const styleMatch = block.match(/font-style:\s*(normal|italic)/i);
    const weightMatch = block.match(/font-weight:\s*(\d+)/i);
    const urlMatch = block.match(/src:\s*url\((['"]?)(https:\/\/[^)'"]+)\1\)/i);
    if (!urlMatch) continue;
    const style: FaceStyle = styleMatch?.[1]?.toLowerCase() === 'italic' ? 'italic' : 'normal';
    const weight = weightMatch ? parseInt(weightMatch[1], 10) : 400;
    const url = urlMatch[2];
    // Keep the last block per (weight, style) — Google CSS2 lists latin last
    const idx = faces.findIndex((f) => f.weight === weight && f.style === style);
    if (idx >= 0) faces[idx] = { weight, style, url };
    else faces.push({ weight, style, url });
  }
  return faces;
}

export async function downloadGoogleFamily(
  family: string,
  weights: number[] = [400],
  styles: FaceStyle[] = ['normal']
): Promise<{ ok: boolean; loadedCount: number; error?: string }> {
  const cleanWeights = Array.from(new Set(weights.length ? weights : [400])).sort((a, b) => a - b);
  const cleanStyles: FaceStyle[] = styles.length ? styles : ['normal'];
  const hasItalic = cleanStyles.includes('italic');

  const famParam = family.trim().replace(/\s+/g, '+');
  const axis = hasItalic ? 'ital,wght@' : 'wght@';
  const tuples: string[] = [];
  if (hasItalic) {
    for (const s of ['normal', 'italic'] as FaceStyle[]) {
      if (!cleanStyles.includes(s)) continue;
      for (const w of cleanWeights) {
        tuples.push(`${s === 'italic' ? 1 : 0},${w}`);
      }
    }
  } else {
    for (const w of cleanWeights) tuples.push(String(w));
  }

  const url = `${GF_BASE}?family=${encodeURIComponent(famParam).replace(/%2B/g, '+')}:${axis}${tuples.join(';')}&display=block`;

  let css = '';
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, loadedCount: 0, error: `Google Fonts returned HTTP ${res.status}` };
    }
    css = await res.text();
  } catch (err) {
    return {
      ok: false,
      loadedCount: 0,
      error: err instanceof Error ? err.message : 'Network error downloading font',
    };
  }

  const faces = parseGoogleCssFaces(css);
  if (faces.length === 0) {
    return { ok: false, loadedCount: 0, error: 'No font faces returned by Google Fonts' };
  }

  let loadedCount = 0;
  let lastErr: string | undefined;
  for (const f of faces) {
    try {
      const fontRes = await fetch(f.url);
      if (!fontRes.ok) {
        lastErr = `HTTP ${fontRes.status} fetching font file`;
        continue;
      }
      const data = await fontRes.arrayBuffer();
      const saved = await saveAndRegisterFontBytes({
        data,
        fileName: `${family}-${f.weight}${f.style === 'italic' ? 'Italic' : ''}.woff2`,
        family,
        weight: f.weight,
        style: f.style,
        source: 'google',
      });
      if (saved.ok) loadedCount++;
      else lastErr = saved.error;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  return loadedCount > 0
    ? { ok: true, loadedCount }
    : { ok: false, loadedCount: 0, error: lastErr || 'Failed to register downloaded font' };
}
