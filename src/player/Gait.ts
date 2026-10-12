import { config } from '../core/config';

/** Below this speed the player counts as standing still, in m/s. */
const MIN_SPEED = 0.5;
/** After standing still or being in the air this long, in seconds, the next step comes half a stride in. */
const RESTART_AFTER = 0.25;

export interface GaitStance {
  readonly grounded: boolean;
  readonly crouching: boolean;
  readonly sprinting: boolean;
}

/**
 * The player's walking rhythm, by distance traveled: one footstep per stride length of the current stance
 * (`config.player.stride`). Footstep sounds play on it and the head bob follows it, so they stay in step.
 */
export class Gait {
  private _steps = 0;
  private _stepped = false;
  private still = 0;

  /** Footsteps taken, fractional. A foot comes down each time this passes a whole number. */
  get steps(): number {
    return this._steps;
  }

  /** True if a foot came down during the last update. */
  get stepped(): boolean {
    return this._stepped;
  }

  /** Advance by the horizontal distance moved this frame. */
  update(distance: number, dt: number, stance: GaitStance): void {
    this._stepped = false;
    const speed = dt > 0 ? distance / dt : 0;
    if (!stance.grounded || speed < MIN_SPEED) {
      this.still += dt;
      // Setting off again: the first foot comes down after half a stride.
      if (this.still >= RESTART_AFTER) this._steps = Math.floor(this._steps) + 0.5;
      return;
    }
    this.still = 0;
    const s = config.player.stride;
    const stride = stance.crouching ? s.crouch : stance.sprinting ? s.sprint : s.walk;
    const before = Math.floor(this._steps);
    this._steps += distance / stride;
    this._stepped = Math.floor(this._steps) > before;
  }

  /** Touched down from a jump or fall: that counts as a step, and the next one comes a full stride on. */
  land(): void {
    this._steps = Math.floor(this._steps) + 1;
    this.still = 0;
  }
}
