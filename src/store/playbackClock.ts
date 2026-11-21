/**
 * The playback clock, deliberately outside React.
 *
 * The rAF loop advances the playhead up to 120 times a second. Routing that through the zustand
 * store re-renders every `currentTimeMs` subscriber - the timeline's layer rows, the playbar, the
 * inspector, the preview gizmo overlay - and on a phone that React work costs more than the GL work
 * it is reporting on. So the live clock lives here, in a one-value pub/sub, and the store keeps the
 * *committed* playhead that React renders from.
 *
 * Two consumers, two tolerances:
 *  - DOM writers (the timeline's `translate3d`, the playhead cap) poll `get()` inside their own rAF
 *    and write `style.transform` directly. Zero React, 60 fps.
 *  - The store commit stays at ~6 Hz so text readouts and inspector values stay alive without a
 *    commit per frame.
 */
class PlaybackClock {
  private ms = 0;
  private listeners = new Set<() => void>();

  public get(): number {
    return this.ms;
  }

  public set(value: number): void {
    this.ms = value;
    for (const l of this.listeners) l();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Snapshot hook for `useSyncExternalStore` consumers. */
  public getSnapshot = (): number => this.ms;
}

export const playbackClock = new PlaybackClock();
