import JSZip from 'jszip';
import { saveMediaBlob } from '../store/storage';
import type { Project } from '../types/project';
import { importProjectFromAmXml, type AmPackageMediaMap } from './amXmlCodec';

export interface ParsedShareLink {
  uid: string;
  pid: string;
  zipUrl: string;
}

export interface LinkImportResult {
  projects: Project[];
  mediaCount: number;
  zipUrl?: string;
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

export function parseAlightShareUrl(rawInput: string): ParsedShareLink | null {
  const text = rawInput.trim();
  const match = text.match(/\/am\/share\/u\/([^/?#]+)\/p\/([^/?#]+)/i);
  if (!match) return null;
  const uid = match[1];
  const pid = match[2];
  const objectPath = encodeURIComponent(`share/u/${uid}/p/${pid}/projectfiles.zip`);
  const zipUrl = `https://firebasestorage.googleapis.com/v0/b/alight-creative.appspot.com/o/${objectPath}?alt=media`;
  return { uid, pid, zipUrl };
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

async function fetchWithCorsFallbacks(url: string, onStatus?: (msg: string) => void): Promise<ArrayBuffer> {
  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const endpoints: { label: string; fetchUrl: string }[] = [];
  if (isLocal) {
    endpoints.push({ label: 'local proxy', fetchUrl: `/api/am-proxy?url=${encodeURIComponent(url)}` });
  }
  endpoints.push({ label: 'direct', fetchUrl: url });
  endpoints.push({ label: 'corsproxy.io', fetchUrl: `https://corsproxy.io/?url=${encodeURIComponent(url)}` });
  endpoints.push({ label: 'codetabs', fetchUrl: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` });
  endpoints.push({ label: 'allorigins', fetchUrl: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` });

  let lastErr = '';
  for (const ep of endpoints) {
    try {
      onStatus?.(`Downloading package via ${ep.label}...`);
      const res = await fetch(ep.fetchUrl);
      if (!res.ok) {
        lastErr = `${ep.label}: HTTP ${res.status}`;
        continue;
      }
      const buf = await res.arrayBuffer();
      // Verify ZIP magic bytes ("PK")
      const hdr = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
      if (buf.byteLength > 22 && hdr[0] === 0x50 && hdr[1] === 0x4b) {
        return buf;
      }
      lastErr = `${ep.label}: non-ZIP response (${buf.byteLength} bytes)`;
    } catch (err) {
      lastErr = `${ep.label}: ${err instanceof Error ? err.message : 'network/CORS blocked'}`;
    }
  }
  throw new Error(`Could not download package directly (${lastErr}). Use the direct download link below and drop the .zip/.amproj file.`);
}

export async function importAlightMotionLink(
  rawUrl: string,
  onStatus?: (msg: string) => void
): Promise<LinkImportResult> {
  let parsed = parseAlightShareUrl(rawUrl);

  // Support short alight.link URLs by resolving redirect HTML/Location
  if (!parsed && /alight(?:\.page)?\.link\//i.test(rawUrl)) {
    const isLocal =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const resolveUrl = isLocal
      ? `/api/am-proxy?url=${encodeURIComponent(rawUrl.trim())}`
      : `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl.trim())}`;
    onStatus?.('Resolving short Alight Motion link...');
    const res = await fetch(resolveUrl);
    if (res.ok) {
      const html = await res.text();
      parsed = parseAlightShareUrl(res.url) ?? parseAlightShareUrl(html);
    }
  }

  if (!parsed) {
    throw new Error('Unrecognized Alight Motion link. Paste a link like https://alightcreative.com/am/share/u/.../p/...');
  }

  const zipBuf = await fetchWithCorsFallbacks(parsed.zipUrl, onStatus);
  const res = await importAmProjZip(zipBuf, onStatus);
  return { ...res, zipUrl: parsed.zipUrl };
}
