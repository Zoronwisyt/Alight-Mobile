import React, { useEffect, useRef, useState } from 'react';

/**
 * Frame-time readout for a real handset.
 *
 * Every optimisation in `MOBILE_SMOOTHNESS.md` §12 is mechanically sound and still unmeasured, because
 * the win depends on a GPU and a compositor this repo cannot reach. This turns that open question into
 * a number the user can read off the phone that was actually slow.
 *
 * Enable with `?perf=1`. Costs nothing when off: no listener, no rAF, no state.
 *
 * What it reports, and why each one matters:
 *  - **fps / p50 / p95** of the frame interval - p95 is the honest number, because a 60 fps average
 *    with a 200 ms tail still feels broken.
 *  - **dropped** - intervals over 1.5x the median refresh interval.
 *  - **longtask** - main-thread blocks > 50 ms, which on this editor are React commits, not GL.
 */
const HISTORY = 120;
const UPDATE_MS = 250;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

export const PerfHud: React.FC = () => {
  const enabled = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('perf') === '1';
  }, []);
  const [readout, setReadout] = useState('perf: warming up');

  const samplesRef = useRef<number[]>([]);
  const longMsRef = useRef(0);
  const longCountRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let raf = 0;
    let last = performance.now();
    let lastReport = last;
    let alive = true;

    const observer =
      typeof PerformanceObserver !== 'undefined' &&
      (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask')
        ? new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              longMsRef.current += entry.duration;
              longCountRef.current += 1;
            }
          })
        : null;
    try {
      observer?.observe({ entryTypes: ['longtask'] });
    } catch {
      // longtask is Chromium-only; the frame interval alone still tells the story.
    }

    const tick = (now: number) => {
      if (!alive) return;
      const dt = now - last;
      last = now;
      // Ignore the tab being hidden, which produces one enormous interval.
      if (dt > 0 && dt < 1000) {
        const s = samplesRef.current;
        s.push(dt);
        if (s.length > HISTORY) s.shift();
      }
      if (now - lastReport >= UPDATE_MS) {
        lastReport = now;
        const sorted = [...samplesRef.current].sort((a, b) => a - b);
        const p50 = percentile(sorted, 50);
        const p95 = percentile(sorted, 95);
        const dropped = sorted.filter((d) => d > p50 * 1.5).length;
        const fps = p50 > 0 ? Math.round(1000 / p50) : 0;
        const canvas = document.querySelector('canvas');
        const backing = canvas ? `${canvas.width}x${canvas.height}` : '?';
        setReadout(
          `perf ${fps} fps | p50 ${p50.toFixed(1)}ms | p95 ${p95.toFixed(1)}ms | dropped ${dropped}/${sorted.length}` +
            ` | long ${longCountRef.current} (${Math.round(longMsRef.current)}ms) | buf ${backing} dpr ${(window.devicePixelRatio || 1).toFixed(2)}`
        );
        longMsRef.current = 0;
        longCountRef.current = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        zIndex: 9999,
        pointerEvents: 'none',
        fontFamily: 'monospace',
        fontSize: 10,
        lineHeight: 1.4,
        padding: '4px 6px',
        borderRadius: 4,
        background: 'rgba(8, 10, 18, 0.78)',
        color: '#9CF8C0',
        whiteSpace: 'pre-wrap',
        maxWidth: '95vw',
      }}
    >
      {readout}
    </div>
  );
};
