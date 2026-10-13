import { MathUtils, Vector3 } from 'three';
import type { MagazineReload, ReloadAnimation, RevolverReload } from './defs/WeaponDef';

/** One moment of a reload: offsets on top of the gun's pose, the magazine's from its seated pose, and the left hand. */
export interface ReloadPose {
  /** Gun rotation offsets in radians (positive pitch tips the muzzle up, positive yaw turns it left) and lift in meters. */
  pitch: number;
  yaw: number;
  roll: number;
  lift: number;
  /** Magazine distance out of the well along its axis (negative is further in), tip in radians, and whether it is drawn. */
  magDepth: number;
  magTilt: number;
  magVisible: boolean;
  /** Left hand: 0 on its grip, 1 at `hand` with its forearm toward `elbow` (model frame). */
  handBlend: number;
  readonly hand: Vector3;
  readonly elbow: Vector3;
}

/** Where the magazine sits in the model when seated (the center of its top) and the unit vector out of its well. */
export interface MagazineRig {
  readonly rest: Vector3;
  readonly axis: Vector3;
}

export function createReloadPose(): ReloadPose {
  return { pitch: 0, yaw: 0, roll: 0, lift: 0, magDepth: 0, magTilt: 0, magVisible: true, handBlend: 0, hand: new Vector3(), elbow: new Vector3() };
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

const X_AXIS = new Vector3(1, 0, 0);
const tmp = new Vector3();
const tmp2 = new Vector3();

/** The rest pose: no offsets, magazine seated, left hand on its grip. */
export function restReloadPose(out: ReloadPose): ReloadPose {
  out.pitch = 0;
  out.yaw = 0;
  out.roll = 0;
  out.lift = 0;
  out.magDepth = 0;
  out.magTilt = 0;
  out.magVisible = true;
  out.handBlend = 0;
  return out;
}

/**
 * Sample a gun's reload `t` seconds in (negative when not reloading, which gives the rest pose, so a cancelled
 * reload snaps straight back). `empty` is whether it started from an empty magazine, which adds the chamber step;
 * `rig` is where the magazine sits (magazine reloads only).
 */
export function sampleReload(t: number, a: ReloadAnimation, empty: boolean, rig: MagazineRig | null, out: ReloadPose): ReloadPose {
  restReloadPose(out);
  if (t < 0) return out;
  if (a.kind === 'revolver') return sampleRevolver(t, a, out);
  return rig ? sampleMagazine(t, a, empty, rig, out) : out;
}

/** Seconds into an empty magazine reload when the slide or bolt goes home (the chamber step's release). */
export function chamberReleaseTime(a: MagazineReload): number {
  return a.returnStart + a.emptyExtra * 0.6;
}

/** Where the left hand holds the magazine when it is `depth` out of the well and tipped by `tilt`. */
function handOnMagazine(a: MagazineReload, rig: MagazineRig, depth: number, tilt: number, out: Vector3): Vector3 {
  const o = a.handOnMagazine;
  return out.set(o.x, o.y, o.z).applyAxisAngle(X_AXIS, tilt).add(rig.rest).addScaledVector(rig.axis, depth);
}

/**
 * The gun tilts toward the player, the magazine drops out, a fresh one rises into the well and seats with a jolt,
 * and the gun turns back with a small settle. From empty, a chamber step runs between seating and the turn back:
 * a slide release (thumb press and snap) or a rack of the charging handle by the left hand.
 */
function sampleMagazine(t: number, a: MagazineReload, empty: boolean, rig: MagazineRig, out: ReloadPose): ReloadPose {
  // The chamber step freezes the normal timeline at `returnStart` for `emptyExtra` seconds.
  let te = t;
  let chamber = -1;
  if (empty && t >= a.returnStart) {
    if (t < a.returnStart + a.emptyExtra) {
      chamber = (t - a.returnStart) / a.emptyExtra;
      te = a.returnStart;
    } else {
      te = t - a.emptyExtra;
    }
  }

  // Gun: tilt in, hold, then turn back with an overshoot that settles.
  let tilt: number;
  if (te < a.returnStart) tilt = easeOutCubic(phase(te, 0, a.tiltEnd));
  else tilt = 1 - easeOutBack(phase(te, a.returnStart, a.returnEnd), a.settleOvershoot);
  // Seating jolts the gun; so does the slide or charging handle snapping forward.
  const releaseAt = chamberReleaseTime(a);
  const jolt = bump(te, a.seatTime, a.seatJoltTime) + (empty ? bump(t, releaseAt, a.seatJoltTime) : 0);
  out.pitch = deg(a.tiltPitch) * tilt + deg(a.seatJoltPitch) * jolt;
  out.yaw = deg(a.tiltYaw) * tilt;
  out.roll = deg(a.tiltRoll) * tilt;
  out.lift = -a.tiltDip * tilt + a.seatJoltLift * jolt;

  // Magazine.
  if (te >= a.releaseTime) {
    if (te < a.newMagStart) {
      // The old magazine falls out of the well and is hidden once it is out of view.
      const fall = te - a.releaseTime;
      out.magDepth = a.dropSpeed * fall + 0.5 * a.dropGravity * fall * fall;
      out.magVisible = out.magDepth < a.dropDistance;
    } else if (te < a.insertTime) {
      // A fresh magazine comes up from below the screen, straightening as it lines up with the well.
      out.magDepth = MathUtils.lerp(a.newMagDepth, a.insertDepth, easeOutCubic(phase(te, a.newMagStart, a.newMagEnd)));
      out.magTilt = deg(a.newMagTilt) * (1 - easeInOutCubic(phase(te, a.newMagStart, a.insertTime)));
    } else if (te < a.seatTime) {
      // Pushed home, faster as it goes.
      out.magDepth = a.insertDepth * (1 - easeInQuad(phase(te, a.insertTime, a.seatTime)));
    } else {
      out.magDepth = -a.seatBump * bump(te, a.seatTime, a.seatJoltTime);
    }
  }

  // Left hand: rides with the magazine (waiting just below the frame while the old one drops away).
  if (te < a.releaseTime) out.handBlend = easeInOutCubic(phase(te, a.handReachStart, a.releaseTime));
  else if (te < a.handReturnStart) out.handBlend = 1;
  else out.handBlend = 1 - easeInOutCubic(phase(te, a.handReturnStart, a.handReturnEnd));
  handOnMagazine(a, rig, Math.min(out.magDepth, a.dropDistance), out.magTilt, out.hand);
  const e = a.handOnMagazineElbow;
  out.elbow.set(e.x, e.y, e.z);

  const c = a.chamber;
  if (empty && chamber >= 0 && c.kind === 'slideRelease') {
    // The thumb presses the slide stop (a small dip), then the slide slams home with the jolt above.
    out.pitch -= deg(2) * bump(chamber, 0.15, 0.4);
    out.handBlend = 1;
  }
  if (empty && t >= a.returnStart && c.kind === 'rack') {
    // Rack: from the seated magazine to the handle, pull it back toward the shooter, let go.
    const grab = tmp.set(c.point.x, c.point.y, c.point.z);
    const pulled = tmp2.copy(grab).setZ(grab.z + c.pull);
    const u = chamber < 0 ? 1 : chamber;
    if (u < 0.4) {
      out.hand.lerp(grab, easeInOutCubic(u / 0.4));
    } else if (u < 0.6) {
      out.hand.copy(grab).lerp(pulled, easeInQuad((u - 0.4) / 0.2));
    } else {
      // Let go: the hand comes off the top, a little out and up.
      out.hand.copy(pulled).add(tmp.set(-0.02, 0.025, 0).multiplyScalar(easeOutCubic((u - 0.6) / 0.4)));
    }
    out.elbow.lerp(tmp.set(c.elbow.x, c.elbow.y, c.elbow.z), easeInOutCubic(clamp01(u / 0.4)));
    if (chamber >= 0) out.handBlend = 1;
  }
  return out;
}

/**
 * A revolver whose cylinder does not swing out: muzzle up with a shake to drop the empties, then muzzle down and
 * turned toward the player while the left hand pushes fresh rounds into the back of the cylinder, then a flick
 * closed and back to the normal pose.
 */
function sampleRevolver(t: number, a: RevolverReload, out: ReloadPose): ReloadPose {
  const eject = easeOutCubic(phase(t, 0, a.ejectEnd));
  const load = easeInOutCubic(phase(t, a.ejectHold, a.loadTiltEnd));
  const back = t < a.returnStart ? 0 : easeOutBack(phase(t, a.returnStart, a.returnEnd), a.settleOvershoot);
  const shake = t > a.ejectEnd && t < a.ejectHold ? Math.sin((t - a.ejectEnd) * 45) * (1 - phase(t, a.ejectEnd, a.ejectHold)) : 0;
  const hold = 1 - back;
  out.pitch = (MathUtils.lerp(deg(a.ejectPitch) * eject, deg(a.loadPitch), load) + deg(2) * shake) * hold;
  out.roll = MathUtils.lerp(deg(a.ejectRoll) * eject, deg(a.loadRoll), load) * hold;
  out.yaw = deg(a.loadYaw) * load * hold;
  out.lift = (a.loadLift * load - 0.01 * shake) * hold;

  // Left hand: up to the cylinder, a push per round group, then back to the grip.
  const reach = easeInOutCubic(phase(t, a.ejectHold, a.loadStart));
  const leave = easeInOutCubic(phase(t, a.seatTime, a.seatTime + (a.returnEnd - a.seatTime) * 0.6));
  out.handBlend = reach * (1 - leave);
  const pushes = phase(t, a.loadStart, a.seatTime) * a.loadPushes;
  const push = pushes > 0 && pushes < a.loadPushes ? Math.sin((pushes % 1) * Math.PI) : 0;
  out.hand.set(a.loadPoint.x, a.loadPoint.y, a.loadPoint.z - 0.025 * push);
  out.elbow.set(a.loadElbow.x, a.loadElbow.y, a.loadElbow.z);
  // Each push nudges the gun.
  out.lift -= 0.004 * push * hold;
  return out;
}
