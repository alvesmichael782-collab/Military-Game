import { MathUtils, type Vector3 } from 'three';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import { DamageState } from '../destruction/DamageState';

/** Two sine waves at unrelated rates read as noise but stay smooth. */
function wobble(time: number, phase: number): number {
  return Math.sin(time * 1.0 + phase) * 0.6 + Math.sin(time * 1.73 + phase * 2.1) * 0.4;
}

/**
 * Camera shake from explosions, nearby collapses and the mounted MG, using a trauma model: each blast or collapse adds
 * trauma by how close it was, the shake strength is trauma squared, and trauma fades over time.
 */
export class ScreenShake {
  /** Current offsets in radians, added to the camera on top of aim and recoil. */
  pitch = 0;
  yaw = 0;
  roll = 0;

  private trauma = 0;
  private time = 0;

  /** `listener.position` is where the player's eyes are. */
  constructor(events: EventBus<GameEvents>, private readonly listener: { readonly position: Vector3 }) {
    events.on('explosion', ({ position }) => {
      const closeness = 1 - position.distanceTo(this.listener.position) / config.explosion.shakeRadius;
      if (closeness > 0) this.trauma = Math.min(1, this.trauma + closeness * closeness);
    });
    events.on('segmentStateChanged', ({ to, position }) => {
      if (to !== DamageState.COLLAPSED) return;
      const d = config.destruction;
      const p = this.listener.position;
      const closeness = 1 - Math.hypot(position.x - p.x, position.z - p.z) / d.collapseShakeRadius;
      if (closeness > 0) this.trauma = Math.min(1, this.trauma + d.collapseShakeTrauma * closeness);
    });
    // Each MG round shakes the view a little; sustained fire builds to a steady judder, never more than `shakeMax`.
    events.on('mgFired', () => {
      const mg = config.mg;
      if (this.trauma < mg.shakeMax) this.trauma = Math.min(mg.shakeMax, this.trauma + mg.shakeTrauma);
    });
  }

  update(dt: number): void {
    const s = config.screenShake;
    this.trauma = Math.max(0, this.trauma - s.decay * dt);
    this.time += dt * s.frequency * Math.PI * 2;
    const strength = this.trauma * this.trauma;
    this.pitch = MathUtils.degToRad(s.maxPitch) * strength * wobble(this.time, 0);
    this.yaw = MathUtils.degToRad(s.maxYaw) * strength * wobble(this.time, 1.7);
    this.roll = MathUtils.degToRad(s.maxRoll) * strength * wobble(this.time, 3.1);
  }
}
