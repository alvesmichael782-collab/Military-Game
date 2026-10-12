import { config } from './config';

export type FixedUpdate = (dt: number) => void;
/** `alpha` is how far (0..1) render time sits between the last two fixed steps. */
export type RenderUpdate = (frameDt: number, alpha: number) => void;

/** Longest frame delta we accept, so returning from a hidden tab does not fast-forward. */
const MAX_FRAME_DELTA = 0.25;

/**
 * Fixed-timestep simulation driven by requestAnimationFrame.
 * Simulation always advances in `config.physics.step` increments; rendering runs once per frame.
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private rafId = 0;

  constructor(
    private readonly fixedUpdate: FixedUpdate,
    private readonly render: RenderUpdate,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    const step = config.physics.step;
    // The first frame's timestamp can be earlier than `start()` ran; never step time backwards.
    const frameDt = Math.min(Math.max(0, (now - this.lastTime) / 1000), MAX_FRAME_DELTA);
    this.lastTime = now;
    this.accumulator += frameDt;

    let steps = 0;
    while (this.accumulator >= step && steps < config.physics.maxStepsPerFrame) {
      this.fixedUpdate(step);
      this.accumulator -= step;
      steps++;
    }
    // If we hit the cap, drop the backlog rather than trying to catch up forever.
    if (steps === config.physics.maxStepsPerFrame && this.accumulator >= step) {
      this.accumulator = 0;
    }

    this.render(frameDt, this.accumulator / step);
  };
}
