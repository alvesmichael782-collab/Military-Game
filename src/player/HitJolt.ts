import { MathUtils, type Vector3 } from 'three';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';

/** One axis of the jolt: a critically damped spring kicked by each hit and pulled back to rest. */
class Spring {
  value = 0;
  private velocity = 0;

  /** Kick so that, from rest, the offset peaks at `peak` after 1/`speed` seconds. */
  kick(peak: number, speed: number): void {
    this.velocity += peak * speed * Math.E;
  }

  /** Exact critically damped step, so any frame time stays stable. */
  update(dt: number, speed: number): void {
    const decay = Math.exp(-speed * dt);
    const c = this.velocity + speed * this.value;
    this.value = (this.value + c * dt) * decay;
    this.velocity = (this.velocity - c * speed * dt) * decay;
  }
}

/** What the jolt needs from the camera: where the eyes are and which way they face. */
export interface JoltView {
  readonly yaw: number;
  readonly camera: { readonly position: Vector3 };
}

/**
 * Camera jolt when the player is hit: the view is pushed the way the shot was travelling (away from the attacker),
 * a small pitch and yaw kick plus a roll toward that side, scaled by the damage, springing back in about 0.2 s.
 * Like `ScreenShake` it is an additive offset on the camera only, so the aim never moves.
 */
export class HitJolt {
  /** Current offsets in radians, added to the camera on top of aim, recoil and shake. */
  pitch = 0;
  yaw = 0;
  roll = 0;

  private readonly springs = { pitch: new Spring(), yaw: new Spring(), roll: new Spring() };

  constructor(events: EventBus<GameEvents>, private readonly view: JoltView) {
    events.on('playerDamaged', ({ amount, type, position }) => this.hit(amount, type === 'explosive', position));
  }

  private hit(amount: number, explosive: boolean, from: Vector3): void {
    const j = config.damageFeedback.jolt;
    const degrees = explosive
      ? Math.min(j.explosiveMaxDegrees, amount * j.explosiveDegreesPerDamage)
      : Math.min(j.maxDegrees, amount * j.degreesPerDamage);
    const kick = MathUtils.degToRad(degrees);

    // The way the shot travelled, flat. A hit from right where the eyes are (debug) counts as from straight ahead.
    const eye = this.view.camera.position;
    let dx = eye.x - from.x;
    let dz = eye.z - from.z;
    const length = Math.hypot(dx, dz);
    const yaw = this.view.yaw;
    if (length < 1e-3) {
      dx = Math.sin(yaw);
      dz = Math.cos(yaw);
    } else {
      dx /= length;
      dz /= length;
    }
    // Along the view (positive: the shot travels the way we look, so it came from behind) and to the right.
    const along = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);

    const s = this.springs;
    // From the front the head snaps back (looks up); from behind it is shoved down.
    s.pitch.kick(-along * kick * j.pitch, j.recoverSpeed);
    // Pushed to the right turns the view right (negative yaw) and tips the head right (negative roll).
    s.yaw.kick(-side * kick * j.yaw, j.recoverSpeed);
    s.roll.kick(-side * kick * j.roll, j.recoverSpeed);
  }

  /** `scale` is the jolt strength right now (lower while aiming down sights or mounted on the MG). */
  update(dt: number, scale: number): void {
    const speed = config.damageFeedback.jolt.recoverSpeed;
    const s = this.springs;
    s.pitch.update(dt, speed);
    s.yaw.update(dt, speed);
    s.roll.update(dt, speed);
    this.pitch = s.pitch.value * scale;
    this.yaw = s.yaw.value * scale;
    this.roll = s.roll.value * scale;
  }
}
