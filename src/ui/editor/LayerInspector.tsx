import React, { useRef } from 'react';
import { replaceMediaOnLayers } from '../../engine/mediaReplace';
import { useEditorStore, type InspectorTab } from '../../store/useEditorStore';
import { AmIcon } from '../components/AmIcon';
import { BlendingOpacityPanel } from './BlendingOpacityPanel';
import { BorderShadowPanel } from './BorderShadowPanel';
import { ColorFillPanel } from './ColorFillPanel';
import { EasingCurvePanel } from './EasingCurvePanel';
import { EffectSettingsPanel } from './EffectSettingsPanel';
import { EffectsPanel } from './EffectsPanel';
import { MoveTransformPanel } from './MoveTransformPanel';
import {
  CameraOptionsPanel,
  DrawingToolbar,
  EditPointsPanel,
  ShapeEditPanel,
  SpeedRemapPanel,
  TextEditPanel,
  VolumePanel,
} from './TypeInspectors';
import { useSelectedLayer } from './useSelectedLayer';

export const LayerInspector: React.FC = () => {
  const { inspectorTab, setInspectorTab, curveTarget, setCurveTarget, layoutMode, enterGroup, selectedLayerIds, groupStack, mutateProject } = useEditorStore();
  const { layer, updateLayer } = useSelectedLayer();
  const replaceMediaRef = useRef<HTMLInputElement>(null);

  const handleReplaceMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && selectedLayerIds.length > 0) {
      await replaceMediaOnLayers(files, selectedLayerIds, groupStack, mutateProject);
    }
    e.target.value = '';
  };

  if (!layer) {
    if (layoutMode === 'classic') return null;
    return (
      <aside className="am-inspector-dock" style={{ alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <AmIcon name="ic_add_object" fallback="sliders" size={38} color="var(--am-text-dim)" />
        <h3 style={{ margin: '10px 0 4px', fontSize: 15 }}>No Layer Selected</h3>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--am-text-muted)' }}>
          Select any track in the timeline or click an element on the stage to edit Move &amp; Transform, Fill, Border, Blending, and Effects.
        </p>
      </aside>
    );
  }

  if (layoutMode === 'classic' && inspectorTab === 'none') return null;

  const titles: Record<InspectorTab, string> = {
    none: layer.label,
    menu: layer.label,
    colorFill: 'Color & Fill',
    borderShadow: 'Border & Shadow',
    moveTransform: 'Move & Transform',
    blending: 'Blending & Opacity',
    effects: `Effects (${layer.effects.length})`,
    effectSettings: 'Effect Settings',
    editShape: 'Edit Shape',
    editPoints: 'Edit Vector Points',
    editText: 'Edit Text',
    cameraOptions: 'Camera Options',
    speed: 'Speed / Time Remap',
    volume: 'Audio Volume',
    drawing: 'Freehand Brush',
  };

  return (
    <aside className="am-inspector-dock">
      <div className="am-insp-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {inspectorTab !== 'menu' && (
            <button
              type="button"
              className="am-icon-btn"
              onClick={() => {
                setCurveTarget(null);
                setInspectorTab('menu');
              }}
              title="Back to Layer Menu"
            >
              <AmIcon name="ic_back_button_white" fallback="back" size={18} />
            </button>
          )}
          <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {curveTarget ? `Curve · ${curveTarget.label}` : titles[inspectorTab]}
          </span>
        </div>

        <button
          type="button"
          className="am-icon-btn"
          onClick={() => {
            setCurveTarget(null);
            setInspectorTab('none');
          }}
          title="Close Panel"
        >
          <AmIcon name="ic_viewmode_panel_close" fallback="close" size={18} />
        </button>
      </div>

      <div className="am-insp-scroll am-scroll">
        {curveTarget ? (
          <EasingCurvePanel />
        ) : inspectorTab === 'menu' || inspectorTab === 'none' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="am-field" style={{ marginBottom: 0 }}>
              <label htmlFor="layer-rename">Layer Label</label>
              <input
                id="layer-rename"
                className="am-input"
                value={layer.label}
                onChange={(e) => updateLayer((l) => { l.label = e.target.value; }, false)}
                style={{ padding: '6px 10px', fontSize: 13 }}
              />
            </div>

            <div className="am-menu-grid">
              {layer.type !== 'audio' && layer.type !== 'null' && layer.type !== 'camera' && (
                <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('colorFill')}>
                  <AmIcon name="ic_fill" fallback="sliders" size={20} color="var(--am-accent)" />
                  <span>Color &amp; Fill</span>
                </button>
              )}

              {(layer.type === 'shape' || layer.type === 'text' || layer.type === 'vector') && (
                <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('borderShadow')}>
                  <AmIcon name="ic_border" fallback="box" size={20} color="#5CE5FF" />
                  <span>Border &amp; Shadow</span>
                </button>
              )}

              <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('moveTransform')}>
                <AmIcon name="ic_movetransform_z_guide_up" fallback="sliders" size={20} color="#69FC97" />
                <span>Move &amp; Transform</span>
              </button>

              {layer.type !== 'audio' && (
                <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('blending')}>
                  <AmIcon name="ic_masking_group_bl" fallback="elements" size={20} color="#CE9FFC" />
                  <span>Blending &amp; Opacity</span>
                </button>
              )}

              {layer.type !== 'audio' && (
                <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('effects')}>
                  <AmIcon name="effects" fallback="effects" size={20} color="#FFCD4B" />
                  <span>Effects ({layer.effects.length})</span>
                </button>
              )}

              {layer.type === 'shape' && (
                <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('editShape')}>
                  <AmIcon name="ic_add_polygon" fallback="shape" size={20} color="var(--am-accent)" />
                  <span>Edit Shape</span>
                </button>
              )}

              {layer.type === 'vector' && (
                <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('editPoints')}>
                  <AmIcon name="ic_add_vectordrawing" fallback="draw" size={20} color="var(--am-accent)" />
                  <span>Edit Points</span>
                </button>
              )}

              {layer.type === 'freehand' && (
                <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('drawing')}>
                  <AmIcon name="ic_add_freehanddrawing" fallback="draw" size={20} color="var(--am-accent)" />
                  <span>Freehand Brush</span>
                </button>
              )}

              {layer.type === 'text' && (
                <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('editText')}>
                  <AmIcon name="ic_add_text" fallback="text" size={20} color="var(--am-accent)" />
                  <span>Edit Text</span>
                </button>
              )}

              {layer.type === 'camera' && (
                <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('cameraOptions')}>
                  <AmIcon name="ic_camera_options" fallback="camera" size={20} color="var(--am-accent)" />
                  <span>Camera Options</span>
                </button>
              )}

              {layer.type === 'group' && (
                <button type="button" className="am-menu-tile" onClick={() => enterGroup(layer.id)}>
                  <AmIcon name="ic_group_settings_" fallback="elements" size={20} color="var(--am-accent)" />
                  <span>Edit Group ({layer.groupLayers?.length ?? 0})</span>
                </button>
              )}

              <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('speed')}>
                <AmIcon name="ic_animate_curve" fallback="curve" size={20} color="#F16586" />
                <span>Speed / Time</span>
              </button>

              {layer.type === 'audio' && (
                <button type="button" className="am-menu-tile" onClick={() => setInspectorTab('volume')}>
                  <AmIcon name="ic_add_audio" fallback="audio" size={20} color="var(--am-accent)" />
                  <span>Volume</span>
                </button>
              )}

              <input
                ref={replaceMediaRef}
                type="file"
                accept="image/*,video/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleReplaceMedia}
              />
              <button type="button" className="am-menu-tile" onClick={() => replaceMediaRef.current?.click()}>
                <AmIcon name="ic_add_media" fallback="image" size={20} color="var(--am-accent)" />
                <span>{selectedLayerIds.length > 1 ? `Replace All (${selectedLayerIds.length})` : 'Replace Media'}</span>
              </button>
            </div>
          </div>
        ) : inspectorTab === 'moveTransform' ? (
          <MoveTransformPanel />
        ) : inspectorTab === 'colorFill' ? (
          <ColorFillPanel />
        ) : inspectorTab === 'borderShadow' ? (
          <BorderShadowPanel />
        ) : inspectorTab === 'blending' ? (
          <BlendingOpacityPanel />
        ) : inspectorTab === 'effects' ? (
          <EffectsPanel />
        ) : inspectorTab === 'effectSettings' ? (
          <EffectSettingsPanel />
        ) : inspectorTab === 'editShape' ? (
          <ShapeEditPanel />
        ) : inspectorTab === 'editPoints' ? (
          <EditPointsPanel />
        ) : inspectorTab === 'editText' ? (
          <TextEditPanel />
        ) : inspectorTab === 'cameraOptions' ? (
          <CameraOptionsPanel />
        ) : inspectorTab === 'drawing' ? (
          <DrawingToolbar />
        ) : inspectorTab === 'speed' ? (
          <SpeedRemapPanel />
        ) : inspectorTab === 'volume' ? (
          <VolumePanel />
        ) : null}
      </div>
    </aside>
  );
};
