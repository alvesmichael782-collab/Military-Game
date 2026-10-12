import { MathUtils } from 'three';
import { config } from '../../core/config';

type RecoilConfig = typeof config.rifle.recoil;

/**
 * Counter-Strike-style recoil: a fixed, learnable pattern. Each shot pushes the view up
 * (fast at first, then flattening out) while a horizontal drift sways right then left.
 * The view settles back once firing stops, and the pattern restarts after a short pause.
 * The first bullet of a burst always goes exactly where you aim.
 */
export class Recoil {
  /** Current view offset in radians. Positive pitch is up, positive yaw is left (same as the camera). */
  pitch = 0;
  yaw = 0;

  private shots = 0;
  private sinceShot = Infinity;

  constructor(private readonly cfg: RecoilConfig) {}

  /** Index of the next shot in the pattern. */
  get shotIndex(): number {
    return this.shots;
  }

  /** Apply the kick for one shot, scaled by stance (1 = standing). Call after the bullet has left. */
  kick(scale = 1): void {
    const c = this.cfg;
    const i = this.shots;
    const up = (i < c.climbShots ? c.kickUp : c.plateauKickUp) * scale;
    const cap = MathUtils.degToRad(c.maxPitch * scale);
    // Never pull the view down if a higher-recoil stance already climbed past this cap.
    if (this.pitch < cap) this.pitch = Math.min(this.pitch + MathUtils.degToRad(up), cap);
    // Drift follows the pattern's offset curve; negative yaw is to the right.
    this.yaw -= MathUtils.degToRad(this.driftAt(i + 1) - this.driftAt(i)) * scale;
    this.shots++;
    this.sinceShot = 0;
  }

  /** `firing` is true while the trigger is held on a loaded weapon; the view holds its climb until it stops. */
  update(dt: number, firing: boolean): void {
    if (firing) return;
    const c = this.cfg;
    this.sinceShot += dt;
    if (this.sinceShot >= c.patternResetTime) this.shots = 0;
    if (this.sinceShot >= c.recoverDelay) {
      const keep = Math.exp(-c.recoverSpeed * dt);
      this.pitch *= keep;
      this.yaw *= keep;
    }
  }

  reset(): void {
    this.pitch = 0;
    this.yaw = 0;
    this.shots = 0;
    this.sinceShot = Infinity;
  }

  /** Horizontal drift (degrees, positive = right) after `shots` shots: zero at first, then a slow right-left sway. */
  private driftAt(shots: number): number {
    const c = this.cfg;
    const n = shots - c.driftStartShot;
    if (n <= 0) return 0;
    return c.driftAmplitude * Math.sin((n / c.driftSwingShots) * Math.PI);
  }
}
