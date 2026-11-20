// Bulk font import from a .zip archive.
//
// A foundry pack or a Google Fonts download arrives as one archive holding dozens of
// faces. Doing that one file at a time is the thing this module removes: the archive is
// opened once, every font entry is run through the same `saveAndRegisterFontBytes` path
// a single-file import uses, and the caller gets one report instead of one toast per
// file.
//
// Bounds, because the archive is untrusted input:
//   - entry count            <= MAX_ENTRIES
//   - declared uncompressed  <= MAX_ENTRY_BYTES per font (16 MB, same as the store)
//   - running total          <= MAX_TOTAL_UNCOMPRESSED (the store's 64 MB quota)
//   - extension allowlist    ttf / otf / woff / woff2 / ttc
// An archive that blows a bound stops and reports; it never half-registers a thousand
// faces before the tab dies.

import JSZip from 'jszip';
import { saveAndRegisterFontBytes } from '../store/fontStore';

const FONT_EXT_RE = /\.(ttf|otf|woff2?|ttc)$/i;
const MAX_ENTRIES = 2000;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED = 64 * 1024 * 1024;

export interface FontZipEntryResult {
  fileName: string;
  ok: boolean;
  family?: string;
  duplicate?: boolean;
  error?: string;
  warning?: string;
}

export interface FontZipImportResult {
  ok: boolean;
  /** Fatal reason the archive itself was rejected. Entry failures live in `entries`. */
  error?: string;
  imported: number;
  duplicates: number;
  failed: number;
  skipped: number;
  families: string[];
  entries: FontZipEntryResult[];
  /** True when the sweep stopped early on a size bound rather than finishing. */
  truncated: boolean;
}

export function isFontArchive(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip';
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Archive junk that carries no font: macOS resource forks, editor backups, lockfiles. */
function isIgnoredPath(path: string): boolean {
  return (
    path.startsWith('__MACOSX/') ||
    path.includes('/.git/') ||
    path.includes('/._') ||
    baseName(path).startsWith('._') ||
    baseName(path).startsWith('.')
  );
}

/**
 * Declared uncompressed size of a zip entry, when JSZip kept it.
 *
 * JSZip exposes this only as an internal field on the compressed payload. It is a
 * cheap pre-check, not a guarantee — the post-decompress length is enforced as well,
 * so a lying header still cannot exceed MAX_ENTRY_BYTES.
 */
function declaredSize(entry: JSZip.JSZipObject): number | null {
  const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
  const n = data?.uncompressedSize;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Decide which archive entries are worth extracting, without touching any bytes.
 *
 * Pure, so it can be asserted in Node against a real archive instead of only being
 * exercised through the browser import path. Entries come back sorted for a
 * deterministic import order and therefore deterministic family de-duplication.
 */
export function planFontArchive(paths: string[]): { fontPaths: string[]; skipped: number } {
  const usable = paths.filter((p) => !isIgnoredPath(p)).sort((a, b) => a.localeCompare(b));
  const fontPaths = usable.filter((p) => FONT_EXT_RE.test(p));
  return { fontPaths, skipped: usable.length - fontPaths.length };
}

export async function importFontsFromZip(
  file: File,
  onProgress?: (done: number, total: number, current: string) => void
): Promise<FontZipImportResult> {
  const empty = (error: string): FontZipImportResult => ({
    ok: false,
    error,
    imported: 0,
    duplicates: 0,
    failed: 0,
    skipped: 0,
    families: [],
    entries: [],
    truncated: false,
  });

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return empty(
      /encrypt|password/i.test(msg)
        ? 'That archive is password protected — decrypt it first.'
        : `Not a readable ZIP archive (${msg}).`
    );
  }

  const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
  const { fontPaths, skipped } = planFontArchive(paths);

  if (fontPaths.length === 0) {
    return { ...empty(''), ok: false, error: 'No .ttf/.otf/.woff/.woff2/.ttc files found in the archive.', skipped };
  }

  const total = Math.min(fontPaths.length, MAX_ENTRIES);
  const entries: FontZipEntryResult[] = [];
  const families: string[] = [];
  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  let runningBytes = 0;
  let truncated = false;

  for (let i = 0; i < fontPaths.length; i++) {
    const path = fontPaths[i];
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    onProgress?.(i, total, baseName(path));

    const entry = zip.files[path];
    const declared = declaredSize(entry);
    if (declared !== null && declared > MAX_ENTRY_BYTES) {
      failed++;
      entries.push({
        fileName: baseName(path),
        ok: false,
        error: `Declared size ${(declared / 1048576).toFixed(1)} MB exceeds the 16 MB per-font limit.`,
      });
      continue;
    }
    if (runningBytes >= MAX_TOTAL_UNCOMPRESSED) {
      truncated = true;
      break;
    }

    let data: ArrayBuffer;
    try {
      data = await entry.async('arraybuffer');
    } catch (err) {
      failed++;
      entries.push({
        fileName: baseName(path),
        ok: false,
        error: err instanceof Error ? err.message : 'Could not extract this entry.',
      });
      continue;
    }

    if (data.byteLength === 0) {
      failed++;
      entries.push({ fileName: baseName(path), ok: false, error: 'Entry is 0 bytes.' });
      continue;
    }
    if (data.byteLength > MAX_ENTRY_BYTES) {
      failed++;
      entries.push({
        fileName: baseName(path),
        ok: false,
        error: `Font is ${(data.byteLength / 1048576).toFixed(1)} MB, over the 16 MB per-font limit.`,
      });
      continue;
    }
    runningBytes += data.byteLength;
    if (runningBytes > MAX_TOTAL_UNCOMPRESSED) {
      truncated = true;
      entries.push({
        fileName: baseName(path),
        ok: false,
        error: 'Archive exceeds the 64 MB total font quota — stopped here.',
      });
      break;
    }

    const res = await saveAndRegisterFontBytes({
      data,
      fileName: baseName(path),
      source: 'user',
    });

    if (!res.ok) {
      failed++;
      entries.push({ fileName: baseName(path), ok: false, error: res.error || 'Import failed.' });
      continue;
    }
    if (res.duplicate) {
      duplicates++;
      entries.push({
        fileName: baseName(path),
        ok: true,
        duplicate: true,
        family: res.meta?.family,
        warning: 'Already in the font library — kept the existing copy.',
      });
      continue;
    }
    imported++;
    const family = res.meta?.family;
    if (family && !families.includes(family)) families.push(family);
    entries.push({ fileName: baseName(path), ok: true, family, warning: res.warning });
  }

  onProgress?.(entries.length, total, '');

  return {
    ok: imported > 0 || duplicates > 0,
    imported,
    duplicates,
    failed,
    skipped,
    families,
    entries,
    truncated,
  };
}

/** One-line summary for the toast. Failing faces are listed by the caller. */
export function summariseZipImport(res: FontZipImportResult): string {
  if (!res.ok && res.error) return res.error;
  const parts: string[] = [];
  if (res.imported) parts.push(`${res.imported} font${res.imported === 1 ? '' : 's'}`);
  if (res.duplicates) parts.push(`${res.duplicates} already present`);
  if (res.failed) parts.push(`${res.failed} failed`);
  if (res.skipped) parts.push(`${res.skipped} non-font skipped`);
  const head = parts.length ? parts.join(', ') : 'nothing imported';
  return res.truncated ? `${head} — stopped at the size limit` : head;
}
