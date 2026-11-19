import { saveMediaBlob } from '../store/storage';
import type { Layer, Project } from '../types/project';

interface LoadedMediaAsset {
  type: 'image' | 'video';
  label: string;
  mediaData: NonNullable<Layer['mediaData']>;
}

async function loadMediaFileAsset(file: File): Promise<LoadedMediaAsset> {
  const isVideo = file.type.startsWith('video/');
  const mediaId = `med_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const url = await saveMediaBlob(mediaId, file, file.name, file.type);

  if (isVideo) {
    const dims = await new Promise<{ w: number; h: number; durMs: number }>((resolve) => {
      const vid = document.createElement('video');
      vid.preload = 'metadata';
      vid.onloadedmetadata = () => {
        resolve({
          w: vid.videoWidth || 1080,
          h: vid.videoHeight || 1080,
          durMs: (vid.duration || 4) * 1000,
        });
      };
      vid.onerror = () => resolve({ w: 1080, h: 1080, durMs: 4000 });
      vid.src = url;
    });
    return {
      type: 'video',
      label: file.name,
      mediaData: {
        mediaId,
        src: url,
        naturalWidth: dims.w,
        naturalHeight: dims.h,
        durationMs: dims.durMs,
        trimStartMs: 0,
        playbackSpeed: 1,
        volume: 1,
        muted: false,
      },
    };
  }

  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1080, h: img.naturalHeight || 1080 });
    img.onerror = () => resolve({ w: 1080, h: 1080 });
    img.src = url;
  });

  return {
    type: 'image',
    label: file.name,
    mediaData: {
      mediaId,
      src: url,
      naturalWidth: dims.w,
      naturalHeight: dims.h,
    },
  };
}

/**
 * Replaces media on all selected layers (1 file -> all selected; N files -> mapped in order).
 * Preserves each layer's effects, keyframes, transform, and timeline bounds.
 */
export async function replaceMediaOnLayers(
  files: FileList | File[],
  selectedIds: string[],
  groupStack: string[],
  mutateProject: (fn: (p: Project) => void, recordHistory?: boolean) => void
): Promise<void> {
  const fileArr = Array.from(files);
  if (fileArr.length === 0 || selectedIds.length === 0) return;
  const assets = await Promise.all(fileArr.map(loadMediaFileAsset));

  mutateProject((proj) => {
    let list = proj.layers;
    for (const gid of groupStack) {
      const g = list.find((x) => x.id === gid);
      if (g?.groupLayers) list = g.groupLayers;
    }
    let idx = 0;
    for (const l of list) {
      if (!selectedIds.includes(l.id)) continue;
      const asset = assets[idx % assets.length];
      idx++;
      l.type = asset.type;
      l.label = asset.label;
      l.mediaData = {
        ...asset.mediaData,
        playbackSpeed: l.mediaData?.playbackSpeed ?? asset.mediaData.playbackSpeed,
        volume: l.mediaData?.volume ?? asset.mediaData.volume,
        muted: l.mediaData?.muted ?? asset.mediaData.muted,
      };
    }
  });
}
