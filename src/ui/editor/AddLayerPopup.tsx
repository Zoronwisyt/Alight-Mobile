import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { animatable } from '../../engine/animation';
import { audioEngine } from '../../engine/audioEngine';
import { getDefaultShapeParams, getShapes } from '../../engine/catalog';
import { makeBaseLayer } from '../../store/demoProjects';
import { saveMediaBlob } from '../../store/storage';
import { useEditorStore } from '../../store/useEditorStore';
import type { ShapeDef } from '../../types/project';
import { AmDialog } from '../components/AmDialog';
import { AmIcon } from '../components/AmIcon';

type AddTab = 'shape' | 'media' | 'audio' | 'object' | 'element' | 'draw' | 'text';

const SHAPE_ICONS: Record<string, string> = {
  'com.alightcreative.shapes.rect': 'ic_add_square',
  'com.alightcreative.shapes.roundrect': 'ic_add_roundrect',
  'com.alightcreative.shapes.circle': 'ic_add_circle',
  'com.alightcreative.shapes.star': 'ic_add_star',
  'com.alightcreative.shapes.poly': 'ic_add_polygon',
  'com.alightcreative.shapes.triangle': 'ic_add_triangle',
  'com.alightcreative.shapes.arrow': 'ic_add_arrow',
  'com.alightcreative.shapes.pie': 'ic_add_pie',
};

export const AddLayerPopup: React.FC = () => {
  const {
    showAddLayerPopup,
    setModal,
    currentProject,
    currentTimeMs,
    addLayer,
    elements,
    setInspectorTab,
  } = useEditorStore(
    useShallow((s) => ({
      showAddLayerPopup: s.showAddLayerPopup,
      setModal: s.setModal,
      currentProject: s.currentProject,
      currentTimeMs: s.currentTimeMs,
      addLayer: s.addLayer,
      elements: s.elements,
      setInspectorTab: s.setInspectorTab,
    }))
  );

  const [tab, setTab] = useState<AddTab>('shape');
  const shapes = getShapes();

  if (!currentProject) return null;
  const cx = currentProject.width / 2;
  const cy = currentProject.height / 2;
  const start = Math.round(currentTimeMs);
  const end = Math.max(start + 2000, Math.min(currentProject.durationMs, start + 3000));
  const nextColorIdx = currentProject.layers.length % 8;

  const addShapeLayer = (shape: ShapeDef) => {
    addLayer(
      makeBaseLayer({
        id: `shp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'shape',
        label: shape.name,
        colorIndex: nextColorIdx,
        startTime: start,
        endTime: end,
        transform: {
          location: animatable([cx, cy, 0]),
          rotation: animatable(0),
          scale: animatable([1, 1]),
          scaleLinked: true,
          pivot: animatable([0, 0]),
          skew: animatable([0, 0]),
        },
        shapeId: shape.id,
        shapeParams: getDefaultShapeParams(shape),
      })
    );
  };

  const addTextLayer = () => {
    addLayer(
      makeBaseLayer({
        id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'text',
        label: 'Text',
        colorIndex: nextColorIdx,
        startTime: start,
        endTime: end,
        transform: {
          location: animatable([cx, cy, 0]),
          rotation: animatable(0),
          scale: animatable([1, 1]),
          scaleLinked: true,
          pivot: animatable([0, 0]),
          skew: animatable([0, 0]),
        },
        textData: {
          content: 'Double Tap to Edit',
          fontFamily: 'Space Grotesk',
          fontSize: 64,
          color: '#FFFFFFFF',
          align: 'center',
          lineHeight: 1.2,
          letterSpacing: 0,
          wrapWidth: currentProject.width * 0.85,
        },
      })
    );
  };

  const addObjectLayer = (kind: 'null' | 'camera') => {
    const defaultCamZ =
      kind === 'camera'
        ? -(Math.max(currentProject.width, currentProject.height) / (2 * Math.tan((60 * Math.PI) / 360)))
        : 0;
    addLayer(
      makeBaseLayer({
        id: `${kind}_${Date.now()}`,
        type: kind,
        label: kind === 'camera' ? 'Camera 1' : 'Null Object',
        colorIndex: kind === 'camera' ? 5 : 4,
        startTime: 0,
        endTime: currentProject.durationMs,
        transform: {
          location: animatable([cx, cy, defaultCamZ]),
          rotation: animatable(0),
          scale: animatable([1, 1]),
          scaleLinked: true,
          pivot: animatable([0, 0]),
          skew: animatable([0, 0]),
        },
        cameraData:
          kind === 'camera'
            ? {
                fov: animatable(60),
                type: 'perspective',
                active: true,
                fogEnabled: false,
                fogColor: '#FF0E1317',
                fogNear: 300,
                fogFar: 2000,
                focusDistance: animatable(1000),
                blurStrength: animatable(0),
              }
            : undefined,
      })
    );
  };

  const addVectorLayer = () => {
    addLayer(
      makeBaseLayer({
        id: `vec_${Date.now()}`,
        type: 'vector',
        label: 'Vector Path',
        colorIndex: nextColorIdx,
        startTime: start,
        endTime: end,
        transform: {
          location: animatable([cx, cy, 0]),
          rotation: animatable(0),
          scale: animatable([1, 1]),
          scaleLinked: true,
          pivot: animatable([0, 0]),
          skew: animatable([0, 0]),
        },
        vectorPath: {
          closed: true,
          points: [
            { x: 0, y: -180, inX: -80, inY: 0, outX: 80, outY: 0 },
            { x: 180, y: 80, inX: 0, inY: -80, outX: -80, outY: 80 },
            { x: -180, y: 80, inX: 80, inY: 80, outX: 0, outY: -80 },
          ],
        },
      })
    );
    setInspectorTab('editPoints');
  };

  const addFreehandLayer = () => {
    addLayer(
      makeBaseLayer({
        id: `draw_${Date.now()}`,
        type: 'freehand',
        label: 'Freehand Drawing',
        colorIndex: nextColorIdx,
        startTime: start,
        endTime: end,
        transform: {
          location: animatable([cx, cy, 0]),
          rotation: animatable(0),
          scale: animatable([1, 1]),
          scaleLinked: true,
          pivot: animatable([0, 0]),
          skew: animatable([0, 0]),
        },
        freehandStrokes: [],
      })
    );
  };

  const handleMediaFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const mediaId = `med_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const url = await saveMediaBlob(mediaId, file, file.name, file.type);

    if (isVideo) {
      const vid = document.createElement('video');
      vid.src = url;
      vid.onloadedmetadata = () => {
        addLayer(
          makeBaseLayer({
            id: `vid_${Date.now()}`,
            type: 'video',
            label: file.name,
            colorIndex: nextColorIdx,
            startTime: start,
            endTime: start + Math.max(1000, Math.round((vid.duration || 4) * 1000)),
            transform: {
              location: animatable([cx, cy, 0]),
              rotation: animatable(0),
              scale: animatable([1, 1]),
              scaleLinked: true,
              pivot: animatable([0, 0]),
              skew: animatable([0, 0]),
            },
            mediaData: {
              mediaId,
              src: url,
              naturalWidth: vid.videoWidth || 1080,
              naturalHeight: vid.videoHeight || 1080,
              durationMs: (vid.duration || 4) * 1000,
              trimStartMs: 0,
              playbackSpeed: 1,
              volume: 1,
              muted: false,
            },
          })
        );
      };
    } else {
      const img = new Image();
      img.src = url;
      img.onload = () => {
        const fitScale = Math.min(1, (currentProject.width * 0.8) / Math.max(1, img.naturalWidth));
        addLayer(
          makeBaseLayer({
            id: `img_${Date.now()}`,
            type: 'image',
            label: file.name,
            colorIndex: nextColorIdx,
            startTime: start,
            endTime: end,
            transform: {
              location: animatable([cx, cy, 0]),
              rotation: animatable(0),
              scale: animatable([fitScale, fitScale]),
              scaleLinked: true,
              pivot: animatable([0, 0]),
              skew: animatable([0, 0]),
            },
            mediaData: {
              mediaId,
              src: url,
              naturalWidth: img.naturalWidth || 1080,
              naturalHeight: img.naturalHeight || 1080,
            },
          })
        );
      };
    }
  };

  const handleAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const mediaId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const url = await saveMediaBlob(mediaId, file, file.name, file.type);
    let dur = 4000;
    let waveform: number[] = [];
    try {
      const buf = await audioEngine.loadAudioBuffer(url);
      dur = Math.round(buf.duration * 1000);
      waveform = audioEngine.extractPeaks(buf, 64);
    } catch {
      waveform = Array.from({ length: 48 }, (_, i) => 0.25 + 0.6 * Math.abs(Math.sin(i * 0.4)));
    }
    addLayer(
      makeBaseLayer({
        id: `aud_${Date.now()}`,
        type: 'audio',
        label: file.name,
        colorIndex: 6,
        startTime: start,
        endTime: start + dur,
        audioData: {
          mediaId,
          src: url,
          name: file.name,
          durationMs: dur,
          volume: animatable(1),
          muted: false,
          waveform,
        },
      })
    );
  };

  const addSynthAudio = async (pattern: 'beat' | 'ambient' | 'pulse', label: string) => {
    let waveform: number[] = [];
    try {
      const buf = await audioEngine.loadAudioBuffer('', pattern);
      waveform = audioEngine.extractPeaks(buf, 64);
    } catch {
      waveform = Array.from({ length: 48 }, (_, i) => (i % 4 === 0 ? 0.95 : 0.3));
    }
    addLayer(
      makeBaseLayer({
        id: `aud_${Date.now()}`,
        type: 'audio',
        label,
        colorIndex: 6,
        startTime: start,
        endTime: start + 4000,
        audioData: {
          src: '',
          name: label,
          durationMs: 4000,
          volume: animatable(0.85),
          muted: false,
          waveform,
          synthPattern: pattern,
        },
      })
    );
  };

  return (
    <AmDialog open={showAddLayerPopup} onClose={() => setModal('showAddLayerPopup', false)} title="Add Layer" wide>
      {/* Category Tabs */}
      <div className="am-pill-row" style={{ marginBottom: 14 }}>
        {(
          [
            ['shape', 'Shape'],
            ['media', 'Media'],
            ['audio', 'Audio'],
            ['object', 'Object'],
            ['element', 'Elements'],
            ['draw', 'Drawing'],
            ['text', 'Text'],
          ] as [AddTab, string][]
        ).map(([id, lbl]) => (
          <button key={id} type="button" className={`am-pill ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'shape' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
          {shapes.map((sh) => (
            <button
              key={sh.id}
              type="button"
              className="am-effect-card"
              onClick={() => addShapeLayer(sh)}
            >
              <AmIcon name={SHAPE_ICONS[sh.id] || 'ic_add_polygon'} fallback="shape" size={28} color="var(--am-accent)" />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{sh.name}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'media' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="am-btn am-btn-primary" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
            <AmIcon name="ic_add_imagevideo" fallback="image" size={18} />
            Upload Image or Video File
            <input type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleMediaFile} />
          </label>
          <div style={{ fontSize: 12, color: 'var(--am-text-muted)' }}>
            Or insert built-in sample texture cards from the Alight Motion APK:
          </div>
          <div className="am-pill-row">
            {[
              ['Bump Surface A', `${import.meta.env.BASE_URL}am/resource/bumpmap_a.webp`],
              ['Grunge Texture A', `${import.meta.env.BASE_URL}am/resource/grunge_a.webp`],
              ['RGBA Noise Map', `${import.meta.env.BASE_URL}am/textures/rgbanoise.webp`],
            ].map(([lbl, src]) => (
              <button
                key={src}
                type="button"
                className="am-btn"
                onClick={() =>
                  addLayer(
                    makeBaseLayer({
                      id: `img_${Date.now()}`,
                      type: 'image',
                      label: lbl,
                      colorIndex: nextColorIdx,
                      startTime: start,
                      endTime: end,
                      transform: {
                        location: animatable([cx, cy, 0]),
                        rotation: animatable(0),
                        scale: animatable([1.4, 1.4]),
                        scaleLinked: true,
                        pivot: animatable([0, 0]),
                        skew: animatable([0, 0]),
                      },
                      mediaData: { src, naturalWidth: 512, naturalHeight: 512 },
                    })
                  )
                }
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'audio' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="am-btn am-btn-primary" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
            <AmIcon name="ic_add_audio" fallback="audio" size={18} />
            Upload Audio (MP3 / WAV / OGG)
            <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleAudioFile} />
          </label>
          <div style={{ fontSize: 12, color: 'var(--am-text-muted)' }}>Built-in Synth Audio Tracks (drives live VU meter):</div>
          <div className="am-pill-row">
            <button type="button" className="am-btn" onClick={() => addSynthAudio('beat', '120 BPM Kick & Hat')}>
              + 120 BPM Beat
            </button>
            <button type="button" className="am-btn" onClick={() => addSynthAudio('pulse', 'Synth Bass Pulse')}>
              + Synth Pulse
            </button>
            <button type="button" className="am-btn" onClick={() => addSynthAudio('ambient', 'Ambient Pad')}>
              + Ambient Pad
            </button>
          </div>
        </div>
      )}

      {tab === 'object' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button type="button" className="am-effect-card" onClick={() => addObjectLayer('null')}>
            <AmIcon name="ic_add_object_element" fallback="box" size={30} color="var(--am-accent)" />
            <span style={{ fontWeight: 700 }}>Null Object</span>
            <span style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>Parenting anchor controller</span>
          </button>
          <button type="button" className="am-effect-card" onClick={() => addObjectLayer('camera')}>
            <AmIcon name="ic_camera_outline" fallback="camera" size={30} color="var(--am-accent)" />
            <span style={{ fontWeight: 700 }}>Camera</span>
            <span style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>3D perspective & depth parallax</span>
          </button>
        </div>
      )}

      {tab === 'element' && (
        <div>
          {elements.length === 0 ? (
            <p style={{ color: 'var(--am-text-muted)', fontSize: 13 }}>
              No saved elements yet. Select a layer and save it as an element from the right rail.
            </p>
          ) : (
            <div className="am-effect-grid">
              {elements.map((el) => (
                <button
                  key={el.id}
                  type="button"
                  className="am-effect-card"
                  onClick={() => {
                    for (const sub of el.layers) {
                      const copy = structuredClone(sub);
                      copy.id = `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                      addLayer(copy);
                    }
                  }}
                >
                  <AmIcon name="ic_add_elements" fallback="elements" size={26} color="var(--am-accent)" />
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{el.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'draw' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button type="button" className="am-effect-card" onClick={addFreehandLayer}>
            <AmIcon name="ic_add_freehanddrawing" fallback="draw" size={30} color="var(--am-accent)" />
            <span style={{ fontWeight: 700 }}>Freehand Drawing</span>
            <span style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>Paint strokes directly on canvas</span>
          </button>
          <button type="button" className="am-effect-card" onClick={addVectorLayer}>
            <AmIcon name="ic_add_vectordrawing" fallback="draw" size={30} color="var(--am-accent)" />
            <span style={{ fontWeight: 700 }}>Vector Drawing</span>
            <span style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>Editable Bezier anchor path</span>
          </button>
        </div>
      )}

      {tab === 'text' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--am-text-secondary)' }}>
            Add rich stylized typography with APK fonts (Space Grotesk, Roboto, Hind, Serif Pro) and Text Transform / Text Spacing effects.
          </p>
          <button type="button" className="am-btn am-btn-primary" onClick={addTextLayer}>
            <AmIcon name="ic_add_text" fallback="text" size={18} />
            + Add Text Layer
          </button>
        </div>
      )}
    </AmDialog>
  );
};
