import React, { useMemo, useRef } from 'react';
import { parseColorArgb, rgbaToArgbHex } from '../../engine/animation';

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const s = max === 0 ? 0 : d / max;
  return [h * 360, s, max];
}

function hsvToRgb(hDeg: number, s: number, v: number): [number, number, number] {
  const h = (((hDeg % 360) + 360) % 360) / 60;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

const SWATCHES = [
  '#FFFFFFFF',
  '#FF000000',
  '#FF00FFA8',
  '#FF5CE5FF',
  '#FF69FC97',
  '#FFF16586',
  '#FFFFCD4B',
  '#FF7466F0',
  '#FFCE9FFC',
  '#FFF66A28',
  '#FFE01445',
  '#FF1F233A',
];

interface ColorPickerProps {
  value: string; // #AARRGGBB
  onChange: (argbHex: string) => void;
  showAlpha?: boolean;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange, showAlpha = true }) => {
  const [r, g, b, a] = parseColorArgb(value || '#FFFFFFFF');
  const [h, s, v] = useMemo(() => rgbToHsv(r, g, b), [r, g, b]);
  const svRef = useRef<HTMLDivElement>(null);

  const emitHsva = (nh: number, ns: number, nv: number, na: number) => {
    const [nr, ng, nb] = hsvToRgb(nh, ns, nv);
    onChange(rgbaToArgbHex(nr, ng, nb, na));
  };

  const handleSvPointer = (e: React.PointerEvent) => {
    const box = svRef.current;
    if (!box) return;
    box.setPointerCapture(e.pointerId);
    const update = (clientX: number, clientY: number) => {
      const rect = box.getBoundingClientRect();
      const ns = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const nv = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      emitHsva(h, ns, nv, a);
    };
    update(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => update(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const pureHueCss = useMemo(() => {
    const [hr, hg, hb] = hsvToRgb(h, 1, 1);
    return `rgb(${Math.round(hr * 255)}, ${Math.round(hg * 255)}, ${Math.round(hb * 255)})`;
  }, [h]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* SV Square */}
      <div
        ref={svRef}
        onPointerDown={handleSvPointer}
        style={{
          height: 140,
          borderRadius: 10,
          position: 'relative',
          cursor: 'crosshair',
          touchAction: 'none',
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHueCss})`,
          border: '1px solid var(--am-border-strong)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${s * 100}%`,
            top: `${(1 - v) * 100}%`,
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid #fff',
            boxShadow: '0 0 4px #000',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Hue Slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, width: 16, color: 'var(--am-text-muted)' }}>H</span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={Math.round(h)}
          onChange={(e) => emitHsva(Number(e.target.value), s, v, a)}
          style={{
            flex: 1,
            accentColor: 'var(--am-accent)',
            background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
            height: 10,
            borderRadius: 6,
          }}
        />
      </div>

      {/* Alpha Slider */}
      {showAlpha && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, width: 16, color: 'var(--am-text-muted)' }}>A</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={a}
            onChange={(e) => emitHsva(h, s, v, Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--am-accent)' }}
          />
          <span style={{ fontSize: 11, width: 34, textAlign: 'right' }}>{Math.round(a * 100)}%</span>
        </div>
      )}

      {/* Hex Input & Swatches */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          className="am-checker-bg"
          style={{ width: 28, height: 28, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--am-border-strong)' }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              background: `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`,
            }}
          />
        </div>
        <input
          type="text"
          className="am-input"
          value={value}
          onChange={(e) => {
            const txt = e.target.value.trim();
            if (/^#[0-9a-fA-F]{6,8}$/.test(txt)) {
              onChange(txt.length === 7 ? `#FF${txt.slice(1).toUpperCase()}` : txt.toUpperCase());
            }
          }}
          style={{ padding: '5px 8px', fontSize: 12, fontFamily: 'monospace' }}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SWATCHES.map((sw) => (
          <button
            key={sw}
            type="button"
            onClick={() => onChange(sw)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: `#${sw.slice(3)}`,
              border: value.toUpperCase() === sw ? '2px solid var(--am-accent)' : '1px solid var(--am-border-strong)',
            }}
            aria-label={`Swatch ${sw}`}
          />
        ))}
      </div>
    </div>
  );
};
