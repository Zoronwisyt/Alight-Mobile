import React from 'react';
import { AmIcon } from './AmIcon';

interface SpinnerControlProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  multiplier?: number;
  decimals?: number;
  unit?: string;
  hasKeyframe?: boolean;
  onToggleKeyframe?: () => void;
  onStepKeyframe?: (dir: -1 | 1) => void;
  onOpenCurve?: () => void;
  canOpenCurve?: boolean;
  onChange: (nextVal: number) => void;
}

export const SpinnerControl: React.FC<SpinnerControlProps> = ({
  label,
  value,
  min = -10000,
  max = 10000,
  step = 1,
  multiplier = 1,
  decimals,
  unit = '',
  hasKeyframe = false,
  onToggleKeyframe,
  onStepKeyframe,
  onOpenCurve,
  canOpenCurve = false,
  onChange,
}) => {
  const fracDigits = decimals !== undefined ? decimals : step < 0.05 ? 3 : step < 1 ? 2 : 1;
  const displayVal = Number((value * multiplier).toFixed(fracDigits));
  const range = max - min;
  const normPos = range > 0 ? Math.max(0, Math.min(1, (value - min) / range)) : 0.5;

  const handleScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startVal = value;
    e.currentTarget.setPointerCapture(e.pointerId);
    const sensitivity = range > 0 && range < 20 ? range / 220 : Math.max(step, 0.5);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      let next = startVal + dx * sensitivity;
      next = Math.max(min, Math.min(max, next));
      const invStep = 1 / Math.max(1e-6, step);
      next = Math.round(next * invStep) / invStep;
      onChange(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="am-spinner-box">
      <div className="am-spinner-header">
        <span className="am-spinner-label">{label}</span>
        <div className="am-spinner-readout">
          {onStepKeyframe && (
            <button type="button" className="am-icon-btn" style={{ width: 24, height: 24 }} onClick={() => onStepKeyframe(-1)} title="Previous Keyframe">
              <AmIcon name="ic_prev_element" fallback="back" size={14} />
            </button>
          )}
          {onToggleKeyframe && (
            <button
              type="button"
              className={`am-icon-btn ${hasKeyframe ? 'active' : ''}`}
              style={{ width: 26, height: 26 }}
              onClick={onToggleKeyframe}
              title="Add / Remove Keyframe"
            >
              <AmIcon name={hasKeyframe ? 'ic_keyframe_sign' : 'ic_keyframe_add_hollow'} fallback="plus" size={16} />
            </button>
          )}
          {onStepKeyframe && (
            <button type="button" className="am-icon-btn" style={{ width: 24, height: 24 }} onClick={() => onStepKeyframe(1)} title="Next Keyframe">
              <AmIcon name="ic_next_element" fallback="next" size={14} />
            </button>
          )}
          {onOpenCurve && (
            <button
              type="button"
              className="am-icon-btn"
              style={{ width: 26, height: 26 }}
              disabled={!canOpenCurve}
              onClick={onOpenCurve}
              title="Easing Curve"
            >
              <AmIcon name="ic_animate_curve" fallback="curve" size={15} />
            </button>
          )}
          <input
            type="number"
            className="am-num-input"
            value={displayVal}
            step={step * multiplier}
            onChange={(e) => {
              const raw = parseFloat(e.target.value);
              if (Number.isFinite(raw)) {
                const unscaled = raw / (multiplier || 1);
                onChange(Math.max(min, Math.min(max, unscaled)));
              }
            }}
          />
          {unit && <span style={{ fontSize: 11, color: 'var(--am-text-muted)' }}>{unit}</span>}
        </div>
      </div>

      <div className="am-ruler-scrub" onPointerDown={handleScrubDown} title="Drag horizontally to scrub value">
        <div
          className="am-ruler-indicator"
          style={{ position: 'absolute', left: `${normPos * 100}%` }}
        />
      </div>
    </div>
  );
};
