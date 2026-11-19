import React, { useRef } from 'react';
import { evalEasing } from '../../engine/animation';
import { getAnimatableByTarget, useEditorStore } from '../../store/useEditorStore';
import type { EasingSpec } from '../../types/project';
import { AmIcon } from '../components/AmIcon';
import { useSelectedLayer } from './useSelectedLayer';

const PRESET_CURVES: { label: string; easing: EasingSpec }[] = [
  { label: 'Linear', easing: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1 } },
  { label: 'Ease In', easing: { type: 'cubicBezier', x1: 0.42, y1: 0, x2: 1, y2: 1 } },
  { label: 'Ease Out', easing: { type: 'cubicBezier', x1: 0, y1: 0, x2: 0.58, y2: 1 } },
  { label: 'Ease In-Out', easing: { type: 'cubicBezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
  { label: 'Snap Out', easing: { type: 'cubicBezier', x1: 0, y1: 1, x2: 0, y2: 1 } },
  { label: 'Hard In', easing: { type: 'cubicBezier', x1: 0.42, y1: 0, x2: 1, y2: 0 } },
  { label: 'Overshoot', easing: { type: 'overshoot', x1: 0.34, y1: 1.56, x2: 0.64, y2: 1, approximated: true } },
  { label: 'Bounce', easing: { type: 'bounce', x1: 0.25, y1: 1, x2: 0.5, y2: 1, approximated: true } },
  { label: 'Elastic', easing: { type: 'elastic', x1: 0.2, y1: 1.2, x2: 0.5, y2: 1, approximated: true } },
  { label: 'Step', easing: { type: 'step', x1: 0, y1: 0, x2: 1, y2: 1, params: [0.25], token: 'step', approximated: true } },
  { label: 'Cyclic', easing: { type: 'cyclic', x1: 0, y1: 0, x2: 1, y2: 1, params: [0.25, 0, 0.5, 0, 0], token: 'cyclic', approximated: true } },
];

export const EasingCurvePanel: React.FC = () => {
  const { curveTarget, setCurveTarget, updateKeyframeEasing, curveClipboard, setCurveClipboard } = useEditorStore();
  const { layer, normT, updateLayer } = useSelectedLayer();
  const svgRef = useRef<SVGSVGElement>(null);

  if (!layer || !curveTarget) return null;
  const prop = getAnimatableByTarget(layer, curveTarget);
  if (!prop || prop.keyframes.length < 2) return null;

  const sorted = [...prop.keyframes].sort((a, b) => a.t - b.t);
  let segIdx = sorted.findIndex((k) => k.t > normT);
  if (segIdx <= 0) segIdx = 1;
  const kfTarget = sorted[segIdx];
  const easing: EasingSpec = kfTarget.easing ?? { type: 'linear', x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 };

  const W = 220, H = 180, PAD = 24;
  const toSvg = (x: number, y: number): [number, number] => [
    PAD + x * (W - PAD * 2),
    H - PAD - y * (H - PAD * 2),
  ];

  const dragHandle = (which: 1 | 2) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const onMove = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, ((ev.clientX - r.left) / r.width * W - PAD) / (W - PAD * 2)));
      const y = Math.max(-0.5, Math.min(1.5, (H - PAD - (ev.clientY - r.top) / r.height * H) / (H - PAD * 2)));
      const next: EasingSpec = {
        type: 'cubicBezier',
        x1: which === 1 ? Number(x.toFixed(3)) : easing.x1,
        y1: which === 1 ? Number(y.toFixed(3)) : easing.y1,
        x2: which === 2 ? Number(x.toFixed(3)) : easing.x2,
        y2: which === 2 ? Number(y.toFixed(3)) : easing.y2,
      };
      updateKeyframeEasing(curveTarget, segIdx, next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const [p0x, p0y] = toSvg(0, 0);
  const [p1x, p1y] = toSvg(easing.x1, easing.y1);
  const [p2x, p2y] = toSvg(easing.x2, easing.y2);
  const [p3x, p3y] = toSvg(1, 1);

  const isBezierEditable = easing.type === 'cubicBezier' || easing.type === 'linear';
  const sampledPathD = (() => {
    if (easing.type === 'cubicBezier') {
      return `M ${p0x} ${p0y} C ${p1x} ${p1y}, ${p2x} ${p2y}, ${p3x} ${p3y}`;
    }
    const pts: string[] = [];
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const v = Math.max(-0.5, Math.min(1.5, evalEasing(u, easing)));
      const [sx, sy] = toSvg(u, v);
      pts.push(`${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)}`);
    }
    return pts.join(' ');
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button type="button" className="am-btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setCurveTarget(null)}>
          <AmIcon name="ic_back_button_white" fallback="back" size={14} /> Done
        </button>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--am-accent)' }}>
          Curve: {curveTarget.label}
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{
          width: '100%',
          height: 190,
          background: 'var(--am-a11)',
          borderRadius: 12,
          border: '1px solid var(--am-border-strong)',
          touchAction: 'none',
        }}
      >
        {/* Grid */}
        <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} fill="none" stroke="rgba(255,255,255,0.12)" />
        <line x1={p0x} y1={p0y} x2={p3x} y2={p3y} stroke="rgba(255,255,255,0.14)" strokeDasharray="4 4" />
        {/* Control Handle Lines (only for Bezier / Linear) */}
        {isBezierEditable && (
          <>
            <line x1={p0x} y1={p0y} x2={p1x} y2={p1y} stroke="#5CE5FF" strokeWidth={1.5} />
            <line x1={p3x} y1={p3y} x2={p2x} y2={p2y} stroke="#F16586" strokeWidth={1.5} />
          </>
        )}
        {/* Evaluated Easing Curve */}
        <path
          d={sampledPathD}
          fill="none"
          stroke="#00FFA8"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Draggable Handles */}
        {isBezierEditable && (
          <>
            <circle cx={p1x} cy={p1y} r={7} fill="#5CE5FF" stroke="#081318" strokeWidth={2} style={{ cursor: 'grab' }} onPointerDown={dragHandle(1)} />
            <circle cx={p2x} cy={p2y} r={7} fill="#F16586" stroke="#081318" strokeWidth={2} style={{ cursor: 'grab' }} onPointerDown={dragHandle(2)} />
          </>
        )}
      </svg>

      <div style={{ fontSize: 11, color: 'var(--am-text-muted)', textAlign: 'center', fontFamily: 'monospace' }}>
        {easing.type === 'cubicBezier'
          ? `cubicBezier(${easing.x1.toFixed(3)}, ${easing.y1.toFixed(3)}, ${easing.x2.toFixed(3)}, ${easing.y2.toFixed(3)})`
          : `${easing.token || easing.type}${easing.params?.length ? ` (${easing.params.map((n) => n.toFixed(2)).join(', ')})` : ''}`}
        {easing.approximated && (
          <span style={{ marginLeft: 6, color: 'var(--am-gold)', fontWeight: 700 }}>· Approximated</span>
        )}
      </div>

      <div className="am-pill-row">
        {PRESET_CURVES.map((pc) => (
          <button
            key={pc.label}
            type="button"
            className="am-pill"
            onClick={() => updateKeyframeEasing(curveTarget, segIdx, pc.easing)}
          >
            {pc.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="am-btn" style={{ flex: 1, fontSize: 12 }} onClick={() => setCurveClipboard(easing)}>
          Copy Curve
        </button>
        <button
          type="button"
          className="am-btn"
          disabled={!curveClipboard}
          style={{ flex: 1, fontSize: 12 }}
          onClick={() => curveClipboard && updateKeyframeEasing(curveTarget, segIdx, curveClipboard)}
        >
          Paste Curve
        </button>
        <button
          type="button"
          className="am-btn am-btn-primary"
          style={{ width: '100%', fontSize: 12 }}
          onClick={() =>
            updateLayer((l) => {
              const p = getAnimatableByTarget(l, curveTarget);
              if (!p) return;
              for (const k of p.keyframes) k.easing = { ...easing };
            })
          }
        >
          Apply to All Keyframes
        </button>
      </div>
    </div>
  );
};
