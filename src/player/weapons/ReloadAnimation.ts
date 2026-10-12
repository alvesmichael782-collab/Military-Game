import { MathUtils } from 'three';
import type { WeaponReloadAnimation } from './Weapon';

/** Offsets for one moment of a reload: the rifle's on top of its pose, the magazine's from its seated pose. */
export interface ReloadPose {
  /** Rifle rotation offsets in radians (positive pitch tips the muzzle up, positive yaw turns it left) and lift in meters. */
  pitch: number;
  yaw: number;
  roll: number;
  lift: number;
  /** Magazine distance below its seated pose along the magwell (negative is above), tip in radians, and whether it is drawn. */
  magDepth: number;
  magTilt: number;
  magVisible: boolean;
}

const deg = MathUtils.degToRad;
const clamp01 = (v: number): number => MathUtils.clamp(v, 0, 1);
const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;
const easeInQuad = (u: number): number => u * u;
const easeInOutCubic = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
/** Ease out past the target by an amount set by `s`, then settle back onto it. */
const easeOutBack = (u: number, s: number): number => 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2;

/** Through [start, end] as 0..1, clamped. */
function phase(t: number, start: number, end: number): number {
  return clamp01((t - start) / Math.max(end - start, 1e-4));
}

/** A quick bump: up fast over the first quarter of `duration` after `start`, then back down. 0 outside it. */
function bump(t: number, start: number, duration: number): number {
  const u = (t - start) / duration;
  if (u <= 0 || u >= 1) return 0;
  return u < 0.25 ? easeOutCubic(u / 0.25) : 1 - easeInOutCubic((u - 0.25) / 0.75);
}

/**
 * Sample a weapon's reload animation `t` seconds into the reload (negative when not reloading, which gives the
 * rest pose, so a cancelled reload snaps straight back). The rifle tilts toward the player, the magazine drops
 * out, a fresh one rises into the well and seats with a jolt, and the rifle turns back with a small settle.
 */
export function sampleReload(t: number, a: WeaponReloadAnimation, out: ReloadPose): ReloadPose {
  out.pitch = 0;
  out.yaw = 0;
  out.roll = 0;
  out.lift = 0;
  out.magDepth = 0;
  out.magTilt = 0;
  out.magVisible = true;
  if (t < 0) return out;

  // Rifle: tilt in, hold, then turn back with an overshoot that settles.
  let tilt: number;
  if (t < a.returnStart) tilt = easeOutCubic(phase(t, 0, a.tiltEnd));
  else tilt = 1 - easeOutBack(phase(t, a.returnStart, a.returnEnd), a.settleOvershoot);
  const jolt = bump(t, a.seatTime, a.seatJoltTime);
  out.pitch = deg(a.tiltPitch) * tilt + deg(a.seatJoltPitch) * jolt;
  out.yaw = deg(a.tiltYaw) * tilt;
  out.roll = deg(a.tiltRoll) * tilt;
  out.lift = -a.tiltDip * tilt + a.seatJoltLift * jolt;

  if (t < a.releaseTime) return out;
  if (t < a.newMagStart) {
    // The old magazine falls out of the well and is hidden once it is out of view.
    const fall = t - a.releaseTime;
    out.magDepth = a.dropSpeed * fall + 0.5 * a.dropGravity * fall * fall;
    out.magVisible = out.magDepth < a.dropDistance;
  } else if (t < a.insertTime) {
    // A fresh magazine comes up from below the screen, straightening as it lines up with the well.
    out.magDepth = MathUtils.lerp(a.newMagDepth, a.insertDepth, easeOutCubic(phase(t, a.newMagStart, a.newMagEnd)));
    out.magTilt = deg(a.newMagTilt) * (1 - easeInOutCubic(phase(t, a.newMagStart, a.insertTime)));
  } else if (t < a.seatTime) {
    // Pushed home, faster as it goes.
    out.magDepth = a.insertDepth * (1 - easeInQuad(phase(t, a.insertTime, a.seatTime)));
  } else {
    out.magDepth = -a.seatBump * bump(t, a.seatTime, a.seatJoltTime);
  }
  return out;
}

/**
 * How far the left hand is from the handguard onto the magazine (0 on the handguard, 1 holding the magazine),
 * `t` seconds into a reload (negative when not reloading).
 */
export function sampleLeftHand(t: number, a: WeaponReloadAnimation): number {
  if (t < 0) return 0;
  if (t < a.releaseTime) return easeInOutCubic(phase(t, a.handReachStart, a.releaseTime));
  if (t < a.handReturnStart) return 1;
  return 1 - easeInOutCubic(phase(t, a.handReturnStart, a.handReturnEnd));
}
