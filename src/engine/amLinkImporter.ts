import JSZip from 'jszip';
import { saveMediaBlob } from '../store/storage';
import type { Project } from '../types/project';
import { importProjectFromAmXml, type AmPackageMediaMap } from './amXmlCodec';

export interface ParsedShareLink {
  uid: string;
  pid: string;
  zipUrl: string;
  objectBase?: string;
}

export interface LinkImportResult {
  projects: Project[];
  mediaCount: number;
  zipUrl?: string;
}

const CUSTOM_PROXY_STORAGE_KEY = 'am_custom_proxy_url';

export function getCustomProxyUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const qs = new URLSearchParams(window.location.search).get('proxy');
    if (qs && /^https?:\/\//i.test(qs.trim())) {
      window.localStorage.setItem(CUSTOM_PROXY_STORAGE_KEY, qs.trim());
      return qs.trim();
    }
    return window.localStorage.getItem(CUSTOM_PROXY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setCustomProxyUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean) window.localStorage.setItem(CUSTOM_PROXY_STORAGE_KEY, clean);
    else window.localStorage.removeItem(CUSTOM_PROXY_STORAGE_KEY);
  } catch {
    // ignore storage quota errors
  }
}

function formatProxyUrl(baseProxy: string, targetUrl: string): string {
  const trimmed = baseProxy.trim();
  if (trimmed.includes('{url}')) {
    return trimmed.replace('{url}', encodeURIComponent(targetUrl));
  }
  const sep = trimmed.includes('?') ? '&' : '?';
  return `${trimmed}${sep}url=${encodeURIComponent(targetUrl)}`;
}

const EXT_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
};

function buildFirebaseObjectUrl(objectPath: string, token?: string): string {
  const encoded = encodeURIComponent(objectPath);
  return `https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/${encoded}?alt=media${
    token ? `&token=${encodeURIComponent(token)}` : ''
  }`;
}

export function parseAlightShareUrl(rawInput: string): ParsedShareLink | null {
  const text = rawInput.trim();
  if (!text) return null;

  // 1) Standard Alight Motion share link: https://alightcreative.com/am/share/u/{uid}/p/{pid}
  const match = text.match(/\/am\/share\/u\/([^/?#\s"'<>]+)\/p\/([^/?#\s"'<>]+)/i);
  if (match) {
    const uid = decodeURIComponent(match[1]);
    const pid = decodeURIComponent(match[2]);
    const objectBase = `share/u/${uid}/p/${pid}`;
    return {
      uid,
      pid,
      objectBase,
      zipUrl: buildFirebaseObjectUrl(`${objectBase}/projectfiles.zip`),
    };
  }

  // 2) Direct Firebase Storage URL (URL-encoded share%2Fu%2F...%2Fp%2F...)
  const fbMatch = text.match(/share(?:%2F|\/)u(?:%2F|\/)([^/?&#%\s]+)(?:%2F|\/)p(?:%2F|\/)([^/?&#%\s]+)/i);
  if (fbMatch) {
    const uid = decodeURIComponent(fbMatch[1]);
    const pid = decodeURIComponent(fbMatch[2]);
    const objectBase = `share/u/${uid}/p/${pid}`;
    const urlInText = text.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
    return {
      uid,
      pid,
      objectBase,
      zipUrl: urlInText || buildFirebaseObjectUrl(`${objectBase}/projectfiles.zip`),
    };
  }

  // 3) Direct .zip / .amproj / .xml URL
  const directMatch = text.match(/https?:\/\/[^\s"'<>]+\.(?:zip|amproj|xml)(?:\?[^\s"'<>]*)?/i);
  if (directMatch) {
    return {
      uid: 'direct',
      pid: 'package',
      zipUrl: directMatch[0],
    };
  }

  return null;
}

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

async function probeMediaMetadata(
  url: string,
  mime: string
): Promise<{ width?: number; height?: number; durationMs?: number }> {
  if (mime.startsWith('image/')) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({});
      img.src = url;
      window.setTimeout(() => resolve({}), 2000);
    });
  }
  if (mime.startsWith('video/')) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () =>
        resolve({
          width: v.videoWidth || undefined,
          height: v.videoHeight || undefined,
          durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : undefined,
        });
      v.onerror = () => resolve({});
      v.src = url;
      window.setTimeout(() => resolve({}), 2500);
    });
  }
  if (mime.startsWith('audio/')) {
    return new Promise((resolve) => {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.onloadedmetadata = () =>
        resolve({ durationMs: Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : undefined });
      a.onerror = () => resolve({});
      a.src = url;
      window.setTimeout(() => resolve({}), 2500);
    });
  }
  return {};
}

export async function importAmProjZip(
  zipData: ArrayBuffer | Blob,
  onStatus?: (msg: string) => void
): Promise<LinkImportResult> {
  // Check if payload is a raw Alight Motion XML instead of ZIP
  const headBytes =
    zipData instanceof Blob
      ? new Uint8Array(await zipData.slice(0, 64).arrayBuffer())
      : new Uint8Array(zipData, 0, Math.min(64, zipData.byteLength));
  const isZip = headBytes.length >= 2 && headBytes[0] === 0x50 && headBytes[1] === 0x4b;
  if (!isZip) {
    const rawText =
      zipData instanceof Blob
        ? await zipData.text()
        : new TextDecoder('utf-8').decode(zipData);
    if (rawText.trimStart().startsWith('<')) {
      onStatus?.('Parsing Alight Motion XML...');
      return { projects: [importProjectFromAmXml(rawText)], mediaCount: 0 };
    }
  }

  onStatus?.('Unpacking Alight Motion package...');
  const zip = await JSZip.loadAsync(zipData);

  const xmlFiles: string[] = [];
  const mediaFiles: string[] = [];

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const lower = relativePath.toLowerCase();
    if (lower.endsWith('.xml')) {
      xmlFiles.push(relativePath);
    } else if (!lower.endsWith('.txt') && !lower.endsWith('.json')) {
      const ext = lower.split('.').pop() || '';
      if (EXT_TO_MIME[ext]) {
        mediaFiles.push(relativePath);
      }
    }
  });

  if (xmlFiles.length === 0) {
    throw new Error('No Alight Motion .xml project found inside package.');
  }

  const mediaMap: AmPackageMediaMap = new Map();
  for (let i = 0; i < mediaFiles.length; i++) {
    const path = mediaFiles[i];
    const baseName = path.split('/').pop() || path;
    const mime = guessMime(baseName);
    onStatus?.(`Extracting media ${i + 1} / ${mediaFiles.length} (${baseName})...`);
    const u8 = await zip.file(path)!.async('uint8array');
    const blob = new Blob([u8 as BlobPart], { type: mime });
    const mediaId = `amlink_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
    const url = await saveMediaBlob(mediaId, blob, baseName, mime);
    const meta = await probeMediaMetadata(url, mime);
    const asset = { mediaId, src: url, mime, name: baseName, ...meta };
    mediaMap.set(path, asset);
    mediaMap.set(path.toLowerCase(), asset);
    mediaMap.set(baseName, asset);
    mediaMap.set(baseName.toLowerCase(), asset);
  }

  onStatus?.('Parsing project XML, effects, and bookmarks...');
  const projects: Project[] = [];
  for (const xmlPath of xmlFiles) {
    const xmlText = await zip.file(xmlPath)!.async('string');
    const proj = importProjectFromAmXml(xmlText, mediaMap);
    projects.push(proj);
  }

  return { projects, mediaCount: mediaFiles.length };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Probes Firebase Storage metadata directly (Firebase metadata endpoint serves Access-Control-Allow-Origin: *)
 * to discover downloadTokens, exact file size, and alternate filenames (projectfiles.zip / project.amproj / project.xml).
 */
async function resolveFirebasePackageUrl(
  parsed: ParsedShareLink,
  onStatus?: (msg: string) => void
): Promise<{ downloadUrl: string; sizeBytes?: number }> {
  if (!parsed.objectBase) {
    return { downloadUrl: parsed.zipUrl };
  }
  const candidates = ['projectfiles.zip', 'project.amproj', 'project.xml'];
  for (const file of candidates) {
    const objPath = `${parsed.objectBase}/${file}`;
    const metaUrl = `https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/${encodeURIComponent(objPath)}`;
    try {
      const res = await fetchWithTimeout(metaUrl, 5000);
      if (!res.ok) continue;
      const meta = (await res.json()) as { downloadTokens?: string; size?: string };
      const token = meta.downloadTokens?.split(',')[0]?.trim();
      const sizeBytes = meta.size ? parseInt(meta.size, 10) : undefined;
      if (sizeBytes && Number.isFinite(sizeBytes)) {
        onStatus?.(`Found ${file} (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB)...`);
      }
      return {
        downloadUrl: buildFirebaseObjectUrl(objPath, token),
        sizeBytes,
      };
    } catch {
      // ignore metadata probe errors and fall back to default zipUrl
    }
  }
  return { downloadUrl: parsed.zipUrl };
}

function buildProxyEndpoints(targetUrl: string): { label: string; fetchUrl: string; timeoutMs: number }[] {
  const endpoints: { label: string; fetchUrl: string; timeoutMs: number }[] = [];
  const customProxy = getCustomProxyUrl();
  if (customProxy) {
    endpoints.push({ label: 'custom proxy', fetchUrl: formatProxyUrl(customProxy, targetUrl), timeoutMs: 45000 });
  }

  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const isStaticGhPages = host.endsWith('.github.io');
  if (typeof window !== 'undefined' && !isStaticGhPages && window.location.protocol.startsWith('http')) {
    endpoints.push({
      label: 'studio proxy',
      fetchUrl: `/api/am-proxy?url=${encodeURIComponent(targetUrl)}`,
      timeoutMs: 45000,
    });
  }

  endpoints.push({ label: 'direct', fetchUrl: targetUrl, timeoutMs: 12000 });
  endpoints.push({
    label: 'codetabs',
    fetchUrl: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
    timeoutMs: 18000,
  });
  endpoints.push({
    label: 'allorigins',
    fetchUrl: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    timeoutMs: 18000,
  });
  return endpoints;
}

function isValidPackagePayload(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 22) return false;
  const hdr = new Uint8Array(buf, 0, Math.min(64, buf.byteLength));
  // ZIP ("PK")
  if (hdr[0] === 0x50 && hdr[1] === 0x4b) return true;
  // XML ("<?xml" or "<scene")
  const headText = new TextDecoder('utf-8').decode(hdr).trimStart();
  if (headText.startsWith('<?xml') || headText.startsWith('<scene')) return true;
  return false;
}

async function fetchWithCorsFallbacks(
  url: string,
  sizeBytes?: number,
  onStatus?: (msg: string) => void
): Promise<ArrayBuffer> {
  const endpoints = buildProxyEndpoints(url);
  const sizeLabel = sizeBytes ? ` (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB)` : '';

  let lastErr = '';
  for (const ep of endpoints) {
    try {
      onStatus?.(`Downloading package${sizeLabel} via ${ep.label}...`);
      const res = await fetchWithTimeout(ep.fetchUrl, ep.timeoutMs);
      if (!res.ok) {
        lastErr = `${ep.label}: HTTP ${res.status}`;
        continue;
      }
      const buf = await res.arrayBuffer();
      if (isValidPackagePayload(buf)) {
        return buf;
      }
      lastErr = `${ep.label}: non-package response (${buf.byteLength} bytes)`;
    } catch (err) {
      lastErr = `${ep.label}: ${err instanceof Error ? err.message : 'network/CORS blocked'}`;
    }
  }
  throw new Error(
    `Automatic download blocked by Firebase CORS on static hosting (${lastErr}). Set a free Cloudflare Worker proxy URL below for 1-click imports, or tap "Download projectfiles.zip" and select it.`
  );
}

async function resolveShortAlightLink(
  rawUrl: string,
  onStatus?: (msg: string) => void
): Promise<ParsedShareLink | null> {
  const urlMatch = rawUrl.match(/https?:\/\/[^\s"'<>]+/i);
  const target = (urlMatch ? urlMatch[0] : rawUrl).trim();
  const endpoints = buildProxyEndpoints(target);

  for (const ep of endpoints) {
    if (ep.label === 'direct') continue; // alight.link has no CORS headers
    try {
      onStatus?.(`Resolving short link via ${ep.label}...`);
      const res = await fetchWithTimeout(ep.fetchUrl, 10000);
      const finalHeader = res.headers.get('X-Final-URL') || '';
      const fromHeader = parseAlightShareUrl(finalHeader) ?? parseAlightShareUrl(res.url);
      if (fromHeader) return fromHeader;
      if (res.ok) {
        const html = await res.text();
        const fromHtml = parseAlightShareUrl(html);
        if (fromHtml) return fromHtml;
      }
    } catch {
      // try next resolver
    }
  }
  return null;
}

export async function importAlightMotionLink(
  rawUrl: string,
  onStatus?: (msg: string) => void
): Promise<LinkImportResult> {
  let parsed = parseAlightShareUrl(rawUrl);

  // Support short alight.link / alight.page.link URLs by resolving redirects & HTML
  if (!parsed && /alight(?:\.page)?\.link\//i.test(rawUrl)) {
    parsed = await resolveShortAlightLink(rawUrl, onStatus);
  }

  if (!parsed) {
    throw new Error(
      'Unrecognized Alight Motion link. Paste a link like https://alightcreative.com/am/share/u/.../p/... or https://alight.link/...'
    );
  }

  onStatus?.('Checking Alight Motion cloud package...');
  const { downloadUrl, sizeBytes } = await resolveFirebasePackageUrl(parsed, onStatus);
  const zipBuf = await fetchWithCorsFallbacks(downloadUrl, sizeBytes, onStatus);
  const res = await importAmProjZip(zipBuf, onStatus);
  return { ...res, zipUrl: downloadUrl };
}
