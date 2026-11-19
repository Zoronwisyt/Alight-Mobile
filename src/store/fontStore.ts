// IndexedDB-backed user & downloaded font store with SFNT name/OS2 parser,
// SHA-256 deduplication, size caps (16 MB/file, 64 MB total), and boot hydration.

import { parseAmFontToken } from '../engine/fontNames';
import { registerFace, unregisterFace, type FaceStyle } from '../engine/fontRegistry';

const DB_NAME = 'am-user-fonts-db';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export interface UserFontMeta {
  id: string; // sha-256 hex
  family: string;
  weight: number;
  style: FaceStyle;
  fileName: string;
  bytes: number;
  source: 'user' | 'google';
  addedAt: number;
}

interface StoredFontRecord {
  id: string;
  meta: UserFontMeta;
  data: ArrayBuffer;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let cachedMetas: UserFontMeta[] = [];
const storeListeners = new Set<() => void>();

export function onUserFontsChange(cb: () => void): () => void {
  storeListeners.add(cb);
  return () => storeListeners.delete(cb);
}

function notifyStore(): void {
  for (const cb of storeListeners) {
    try {
      cb();
    } catch {
      // ignore
    }
  }
}

export function getUserFonts(): UserFontMeta[] {
  return cachedMetas;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Lightweight SFNT (TTF/OTF/TTC) name + OS/2 weight/italic parser */
export function parseSfntMetadata(buf: ArrayBuffer, fallbackFileName: string): {
  family: string;
  weight: number;
  style: FaceStyle;
  isCollection: boolean;
} {
  const fallback = parseAmFontToken(fallbackFileName);
  if (buf.byteLength < 16) {
    return { family: fallback.family, weight: fallback.weight, style: fallback.style, isCollection: false };
  }
  const view = new DataView(buf);
  const tag0 = view.getUint32(0, false);

  // WOFF / WOFF2 are compressed — fall back cleanly to filename token parsing
  if (tag0 === 0x774f4646 || tag0 === 0x774f4632) {
    return { family: fallback.family, weight: fallback.weight, style: fallback.style, isCollection: false };
  }

  let tableDirOffset = 0;
  let isCollection = false;
  if (tag0 === 0x74746366) {
    // 'ttcf' collection -> face 0
    isCollection = true;
    if (buf.byteLength < 16) {
      return { family: fallback.family, weight: fallback.weight, style: fallback.style, isCollection: true };
    }
    tableDirOffset = view.getUint32(12, false);
  }

  if (tableDirOffset + 12 > buf.byteLength) {
    return { family: fallback.family, weight: fallback.weight, style: fallback.style, isCollection };
  }

  const sfntVer = view.getUint32(tableDirOffset, false);
  if (sfntVer !== 0x00010000 && sfntVer !== 0x4f54544f && sfntVer !== 0x74727565) {
    return { family: fallback.family, weight: fallback.weight, style: fallback.style, isCollection };
  }

  const numTables = view.getUint16(tableDirOffset + 4, false);
  let nameOff = 0;
  let nameLen = 0;
  let os2Off = 0;
  let os2Len = 0;

  for (let i = 0; i < numTables; i++) {
    const recOff = tableDirOffset + 12 + i * 16;
    if (recOff + 16 > buf.byteLength) break;
    const t = view.getUint32(recOff, false);
    const off = view.getUint32(recOff + 8, false);
    const len = view.getUint32(recOff + 12, false);
    if (t === 0x6e616d65) {
      // 'name'
      nameOff = off;
      nameLen = len;
    } else if (t === 0x4f532f32) {
      // 'OS/2'
      os2Off = off;
      os2Len = len;
    }
  }

  let weight = fallback.weight;
  let style: FaceStyle = fallback.style;
  if (os2Off > 0 && os2Off + 64 <= buf.byteLength && os2Len >= 64) {
    const usWeightClass = view.getUint16(os2Off + 4, false);
    if (usWeightClass >= 100 && usWeightClass <= 900) {
      weight = Math.round(usWeightClass / 100) * 100;
    }
    const fsSelection = view.getUint16(os2Off + 62, false);
    if ((fsSelection & 0x01) !== 0) style = 'italic';
  }

  let fam1 = '';
  let sub2 = '';
  let fam16 = '';
  let sub17 = '';

  if (nameOff > 0 && nameOff + 6 <= buf.byteLength && nameLen >= 6) {
    const count = view.getUint16(nameOff + 2, false);
    const strStorageOff = nameOff + view.getUint16(nameOff + 4, false);
    for (let i = 0; i < count; i++) {
      const r = nameOff + 6 + i * 12;
      if (r + 12 > buf.byteLength) break;
      const platformID = view.getUint16(r, false);
      const nameID = view.getUint16(r + 6, false);
      const len = view.getUint16(r + 8, false);
      const off = view.getUint16(r + 10, false);
      if (nameID !== 1 && nameID !== 2 && nameID !== 16 && nameID !== 17) continue;
      const start = strStorageOff + off;
      if (start + len > buf.byteLength) continue;

      let decoded = '';
      if (platformID === 3 || platformID === 0) {
        // UTF-16BE
        const chars: number[] = [];
        for (let k = 0; k + 1 < len; k += 2) {
          chars.push(view.getUint16(start + k, false));
        }
        decoded = String.fromCharCode(...chars).trim();
      } else if (platformID === 1) {
        // Mac Roman / ASCII
        const bytes = new Uint8Array(buf, start, len);
        decoded = new TextDecoder('latin1').decode(bytes).trim();
      }
      if (!decoded) continue;
      if (nameID === 16 && !fam16) fam16 = decoded;
      else if (nameID === 17 && !sub17) sub17 = decoded;
      else if (nameID === 1 && !fam1) fam1 = decoded;
      else if (nameID === 2 && !sub2) sub2 = decoded;
    }
  }

  const family = (fam16 || fam1 || fallback.family).trim();
  const sub = (sub17 || sub2).toLowerCase();
  if (sub.includes('italic') || sub.includes('oblique')) style = 'italic';

  return { family, weight, style, isCollection };
}

export async function hydrateUserFonts(): Promise<void> {
  try {
    const db = await openDb();
    const records: StoredFontRecord[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as StoredFontRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    cachedMetas = records.map((r) => r.meta).sort((a, b) => a.family.localeCompare(b.family));
    await Promise.allSettled(
      records.map((r) =>
        registerFace({
          family: r.meta.family,
          data: r.data,
          weight: r.meta.weight,
          style: r.meta.style,
          source: r.meta.source,
        })
      )
    );
    notifyStore();
  } catch {
    // IndexedDB unavailable in private mode — degrade cleanly
  }
}

export async function saveAndRegisterFontBytes(opts: {
  data: ArrayBuffer;
  fileName: string;
  family?: string;
  weight?: number;
  style?: FaceStyle;
  source: 'user' | 'google';
}): Promise<{ ok: boolean; meta?: UserFontMeta; duplicate?: boolean; error?: string; warning?: string }> {
  if (opts.data.byteLength === 0) {
    return { ok: false, error: 'Font file is empty (0 bytes).' };
  }
  if (opts.data.byteLength > MAX_FILE_BYTES) {
    return { ok: false, error: `Font file exceeds 16 MB limit (${(opts.data.byteLength / 1048576).toFixed(1)} MB).` };
  }
  const currentTotal = cachedMetas.reduce((s, m) => s + m.bytes, 0);
  if (currentTotal + opts.data.byteLength > MAX_TOTAL_BYTES) {
    return { ok: false, error: 'Total stored font quota (64 MB) exceeded. Delete unused fonts first.' };
  }

  const id = await sha256Hex(opts.data);
  const existing = cachedMetas.find((m) => m.id === id);
  if (existing) {
    return { ok: true, meta: existing, duplicate: true };
  }

  const parsed = parseSfntMetadata(opts.data, opts.fileName);
  let family = (opts.family || parsed.family).trim();
  const weight = opts.weight ?? parsed.weight;
  const style: FaceStyle = opts.style ?? parsed.style;

  // Avoid silent shadowing if same family+weight+style exists with different bytes (user upload)
  if (opts.source === 'user') {
    let suffix = 2;
    const baseFam = family;
    while (
      cachedMetas.some(
        (m) => m.family.toLowerCase() === family.toLowerCase() && m.weight === weight && m.style === style
      )
    ) {
      family = `${baseFam} (${suffix++})`;
    }
  }

  const reg = await registerFace({
    family,
    data: opts.data.slice(0),
    weight,
    style,
    source: opts.source,
  });
  if (!reg.ok) {
    return { ok: false, error: reg.error || 'Browser rejected font file.' };
  }

  const meta: UserFontMeta = {
    id,
    family,
    weight,
    style,
    fileName: opts.fileName,
    bytes: opts.data.byteLength,
    source: opts.source,
    addedAt: Date.now(),
  };

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id, meta, data: opts.data } satisfies StoredFontRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Keep in-memory registration even if IDB write fails
  }

  cachedMetas = [...cachedMetas, meta].sort((a, b) => a.family.localeCompare(b.family));
  notifyStore();
  return {
    ok: true,
    meta,
    warning: parsed.isCollection ? 'Font collection (.ttc): imported face 0 only.' : undefined,
  };
}

export async function importFontFile(
  file: File,
  overrideFamily?: string
): Promise<{ ok: boolean; meta?: UserFontMeta; duplicate?: boolean; error?: string; warning?: string }> {
  const data = await file.arrayBuffer();
  return saveAndRegisterFontBytes({
    data,
    fileName: file.name,
    family: overrideFamily,
    source: 'user',
  });
}

export async function deleteUserFont(id: string): Promise<UserFontMeta | null> {
  const target = cachedMetas.find((m) => m.id === id);
  if (!target) return null;
  unregisterFace(target.family, target.weight, target.style);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
  cachedMetas = cachedMetas.filter((m) => m.id !== id);
  notifyStore();
  return target;
}
