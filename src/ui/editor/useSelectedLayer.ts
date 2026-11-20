import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { evalAnimatable, evalRemappedTime } from '../../engine/animation';
import { useEditorStore } from '../../store/useEditorStore';
import type { Animatable, Layer } from '../../types/project';

export function useSelectedLayer() {
  const {
    currentProject,
    currentTimeMs,
    selectedLayerIds,
    groupStack,
    mutateLayer,
  } = useEditorStore(
    useShallow((s) => ({
      currentProject: s.currentProject,
      currentTimeMs: s.currentTimeMs,
      selectedLayerIds: s.selectedLayerIds,
      groupStack: s.groupStack,
      mutateLayer: s.mutateLayer,
    }))
  );

  let layers = currentProject?.layers ?? [];
  for (const gid of groupStack) {
    const g = layers.find((x) => x.id === gid && x.type === 'group');
    if (g?.groupLayers) layers = g.groupLayers;
  }
  const layer = selectedLayerIds.length === 1 ? layers.find((l) => l.id === selectedLayerIds[0]) : undefined;
  const layerId = layer?.id;

  // I-1 + I-2: Copy-on-write single-layer mutation (shares all other layers by reference)
  const updateLayer = useCallback(
    (fn: (l: Layer) => void, recordHistory = true) => {
      if (!layerId) return;
      mutateLayer(layerId, fn, recordHistory);
    },
    [layerId, mutateLayer]
  );

  const normT = layer ? evalRemappedTime(layer, currentTimeMs).remappedNormT : 0;

  const setAnimValue = <T,>(prop: Animatable<T>, nextVal: T) => {
    prop.value = nextVal;
    if (prop.keyframes.length > 0) {
      const idx = prop.keyframes.findIndex((k) => Math.abs(k.t - normT) < 0.012);
      if (idx !== -1) {
        prop.keyframes[idx].v = nextVal;
      } else {
        prop.keyframes.push({ t: normT, v: nextVal });
        prop.keyframes.sort((a, b) => a.t - b.t);
      }
    }
  };

  const hasKfHere = (prop?: Animatable<any>): boolean => {
    if (!prop || prop.keyframes.length === 0) return false;
    return prop.keyframes.some((k) => Math.abs(k.t - normT) < 0.012);
  };

  const readAnim = <T,>(prop: Animatable<T> | undefined, fallback: T): T =>
    evalAnimatable(prop, normT, fallback);

  return {
    project: currentProject,
    layer,
    normT,
    updateLayer,
    setAnimValue,
    hasKfHere,
    readAnim,
  };
}
