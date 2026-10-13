/** Parts of a frame's CPU time that are timed separately. `path` runs inside `ai`. */
export type ProfileSection = 'render' | 'physics' | 'ai' | 'path';

const SECTIONS: readonly ProfileSection[] = ['render', 'physics', 'ai', 'path'];
/** Frames averaged per report. */
const WINDOW = 60;

/** Averages over the last `WINDOW` frames, in milliseconds. `ai` excludes `path`; `rest` is everything untimed. */
export interface FrameProfile {
  /** Time between frames (what the player feels). */
  frame: number;
  /** CPU time spent inside the frame callback. */
  cpu: number;
  render: number;
  physics: number;
  ai: number;
  path: number;
  rest: number;
  /** Slowest frame interval in the window. */
  worstFrame: number;
}

/**
 * Cheap per-frame CPU timing for the debug overlay, the stress test and PERF.md: frame interval, CPU time in the
 * frame callback, and the share of it spent rendering (draw submission), in physics, AI and path searches.
 * GPU time is not visible from here; a GPU-bound frame shows as a long `frame` with a short `cpu`.
 */
export class FrameProfiler {
  private readonly current: Record<ProfileSection, number> = { render: 0, physics: 0, ai: 0, path: 0 };
  private readonly sums: Record<ProfileSection, number> = { render: 0, physics: 0, ai: 0, path: 0 };
  private readonly starts: Record<ProfileSection, number> = { render: 0, physics: 0, ai: 0, path: 0 };
  private frameStart = 0;
  private lastFrameStart = 0;
  private cpuSum = 0;
  private frameSum = 0;
  private worst = 0;
  private frames = 0;
  private readonly _profile: FrameProfile = { frame: 0, cpu: 0, render: 0, physics: 0, ai: 0, path: 0, rest: 0, worstFrame: 0 };

  /** The latest averages. */
  get profile(): Readonly<FrameProfile> {
    return this._profile;
  }

  beginFrame(): void {
    const now = performance.now();
    if (this.lastFrameStart > 0) {
      const interval = now - this.lastFrameStart;
      this.frameSum += interval;
      this.worst = Math.max(this.worst, interval);
    }
    this.lastFrameStart = now;
    this.frameStart = now;
    for (const s of SECTIONS) this.current[s] = 0;
  }

  begin(section: ProfileSection): void {
    this.starts[section] = performance.now();
  }

  end(section: ProfileSection): void {
    this.current[section] += performance.now() - this.starts[section];
  }

  endFrame(): void {
    this.cpuSum += performance.now() - this.frameStart;
    for (const s of SECTIONS) this.sums[s] += this.current[s];
    if (++this.frames < WINDOW) return;
    const p = this._profile;
    const n = this.frames;
    p.frame = this.frameSum / Math.max(1, n - 1);
    p.cpu = this.cpuSum / n;
    p.render = this.sums.render / n;
    p.physics = this.sums.physics / n;
    p.path = this.sums.path / n;
    p.ai = this.sums.ai / n - p.path;
    p.rest = Math.max(0, p.cpu - p.render - p.physics - p.ai - p.path);
    p.worstFrame = this.worst;
    this.frames = 0;
    this.cpuSum = 0;
    this.frameSum = 0;
    this.worst = 0;
    for (const s of SECTIONS) this.sums[s] = 0;
  }
}

/** The game's one profiler. */
export const profiler = new FrameProfiler();
