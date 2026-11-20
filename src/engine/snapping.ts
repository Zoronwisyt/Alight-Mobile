import { evalAnimatable, evalRemappedTime } from './animation';
import type { Layer, Project } from '../types/project';

export type SnapGuideKind = 'center' | 'edge' | 'grid' | 'layer';

export interface SnapGuideLine {
  /** Position in project coordinates (px) */
  pos: number;
  kind: SnapGuideKind;
}

export interface SnapGuidesState {
  x: SnapGuideLine | null;
  y: SnapGuideLine | null;
}

export interface LayerPositionSnapResult {
  x: number;
  y: number;
  guideX: SnapGuideLine | null;
  guideY: SnapGuideLine | null;
}

/**
 * Alight Motion-style magnetic snapping for a layer's position (location X/Y).
 * Snaps to canvas center, canvas edges, thirds, and other visible active layers' centers.
 */
export function snapLayerPosition(
  rawX: number,
  rawY: number,
  opts: {
    project: Project;
    layers: Layer[];
    activeLayerId: string;
    currentTimeMs: number;
    threshold?: number;
  }
): LayerPositionSnapResult {
  const { project, layers, activeLayerId, currentTimeMs, threshold = 16 } = opts;
  const projW = project.width;
  const projH = project.height;

  const xTargets: SnapGuideLine[] = [
    { pos: projW / 2, kind: 'center' },
    { pos: 0, kind: 'edge' },
    { pos: projW, kind: 'edge' },
    { pos: Math.round(projW / 3), kind: 'grid' },
    { pos: Math.round((projW * 2) / 3), kind: 'grid' },
  ];

  const yTargets: SnapGuideLine[] = [
    { pos: projH / 2, kind: 'center' },
    { pos: 0, kind: 'edge' },
    { pos: projH, kind: 'edge' },
    { pos: Math.round(projH / 3), kind: 'grid' },
    { pos: Math.round((projH * 2) / 3), kind: 'grid' },
  ];

  // Collect other visible active layers' positions at currentTimeMs
  for (const l of layers) {
    if (l.id === activeLayerId) continue;
    if (!l.visible || l.type === 'audio' || l.type === 'camera') continue;
    if (currentTimeMs < l.startTime || currentTimeMs > l.endTime) continue;
    const { remappedNormT } = evalRemappedTime(l, currentTimeMs);
    const loc = evalAnimatable(l.transform.location, remappedNormT, [projW / 2, projH / 2, 0]);
    xTargets.push({ pos: Math.round(loc[0]), kind: 'layer' });
    yTargets.push({ pos: Math.round(loc[1]), kind: 'layer' });
  }

  let bestX = rawX;
  let bestXDist = threshold + 0.001;
  let guideX: SnapGuideLine | null = null;
  for (const t of xTargets) {
    const d = Math.abs(rawX - t.pos);
    if (d < bestXDist) {
      bestXDist = d;
      bestX = t.pos;
      guideX = t;
    }
  }

  let bestY = rawY;
  let bestYDist = threshold + 0.001;
  let guideY: SnapGuideLine | null = null;
  for (const t of yTargets) {
    const d = Math.abs(rawY - t.pos);
    if (d < bestYDist) {
      bestYDist = d;
      bestY = t.pos;
      guideY = t;
    }
  }

  return { x: bestX, y: bestY, guideX, guideY };
}

/**
 * Snap a timeline timestamp (ms) to the nearest target within thresholdMs.
 */
export function snapTimelineMs(
  rawMs: number,
  targets: number[],
  thresholdMs: number
): { ms: number; snapped: boolean } {
  let bestMs = rawMs;
  let bestDist = thresholdMs + 0.001;
  let snapped = false;
  for (const t of targets) {
    const d = Math.abs(rawMs - t);
    if (d < bestDist) {
      bestDist = d;
      bestMs = t;
      snapped = true;
    }
  }
  return { ms: bestMs, snapped };
}
