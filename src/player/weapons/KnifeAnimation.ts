import { MathUtils } from 'three';
import type { MeleeDef } from './defs/WeaponDef';
import type { Knife } from './Knife';

/** Offsets on top of the knife's resting pose: position in meters, rotation in radians. */
export interface KnifePose {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
}

export function createKnifePose(): KnifePose {
  return { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
}

const clamp01 = (v: number): number => MathUtils.clamp(v, 0, 1);
const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;
const easeInCubic = (u: number): number => u * u * u;
const easeInOutCubic = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

function phase(t: number, start: number, end: number): number {
  return clamp01((t - start) / Math.max(end - start, 1e-4));
}

/** Blend `out` toward the key pose `k` by `w`. */
function mix(out: KnifePose, k: Readonly<KnifePose>, w: number): void {
  out.x += (k.x - out.x) * w;
  out.y += (k.y - out.y) * w;
  out.z += (k.z - out.z) * w;
  out.pitch += (k.pitch - out.pitch) * w;
  out.yaw += (k.yaw - out.yaw) * w;
  out.roll += (k.roll - out.roll) * w;
}

function set(out: KnifePose, k: Readonly<KnifePose>): void {
  out.x = k.x;
  out.y = k.y;
  out.z = k.z;
  out.pitch = k.pitch;
  out.yaw = k.yaw;
  out.roll = k.roll;
}

/** No offsets. */
export function restKnifePose(out: KnifePose): KnifePose {
  set(out, REST);
  return out;
}

const REST: KnifePose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
/** Wind-up while the button is first held: drawn back a little, blade tipped up. */
const COCK: KnifePose = { x: 0.01, y: 0.015, z: 0.03, pitch: 0.18, yaw: 0, roll: 0 };
/** A right-to-left slash (side 1) starts up and out to the right and finishes low on the left; side -1 mirrors it. */
const SLASH_START: KnifePose = { x: 0.1, y: 0.08, z: 0.02, pitch: 0.35, yaw: -0.55, roll: -0.7 };
const SLASH_END: KnifePose = { x: -0.24, y: -0.07, z: -0.08, pitch: -0.25, yaw: 1.0, roll: 0.5 };
/** Stab: drawn right back, then thrust straight out. */
const STAB_BACK: KnifePose = { x: 0.02, y: 0.03, z: 0.1, pitch: 0.2, yaw: 0.05, roll: 0.1 };
const STAB_OUT: KnifePose = { x: -0.06, y: 0.03, z: -0.24, pitch: -0.1, yaw: 0.12, roll: 0 };

const k1 = createKnifePose();
const k2 = createKnifePose();

/** Mirror a key pose for a left-to-right slash. */
function sided(k: Readonly<KnifePose>, side: number, out: KnifePose): KnifePose {
  out.x = k.x * side;
  out.y = k.y;
  out.z = k.z;
  out.pitch = k.pitch;
  out.yaw = k.yaw * side;
  out.roll = k.roll * side;
  return out;
}

/** The knife's pose for its current wind-up or attack (rest when idle). */
export function sampleKnife(knife: Knife, def: MeleeDef, out: KnifePose): KnifePose {
  set(out, REST);
  const t = knife.phaseElapsed;
  if (knife.phase === 'windup') {
    mix(out, COCK, easeOutCubic(phase(t, 0, def.stabHoldTime)));
    return out;
  }
  if (knife.phase !== 'attack') return out;

  if (knife.attack === 'slash') {
    const a = def.slash;
    const side = knife.slashSide;
    const start = sided(SLASH_START, side, k1);
    const end = sided(SLASH_END, side, k2);
    // Up to the start, the fast cut through the hit, then back to rest.
    const ready = a.hitTime * 0.45;
    const through = a.hitTime + 0.08;
    if (t < ready) mix(out, start, easeOutCubic(t / ready));
    else if (t < through) {
      set(out, start);
      mix(out, end, easeInOutCubic(phase(t, ready, through)));
    } else {
      set(out, end);
      mix(out, REST, easeInOutCubic(phase(t, through, a.duration)));
    }
    return out;
  }

  const a = def.stab;
  // The stab follows the held wind-up: further back, then the thrust lands on the hit, holds, and returns.
  const thrust = a.hitTime * 0.65;
  const hold = a.hitTime + 0.12;
  set(out, COCK);
  if (t < thrust) mix(out, STAB_BACK, easeOutCubic(t / thrust));
  else if (t < a.hitTime) {
    set(out, STAB_BACK);
    mix(out, STAB_OUT, easeInCubic(phase(t, thrust, a.hitTime)));
  } else if (t < hold) set(out, STAB_OUT);
  else {
    set(out, STAB_OUT);
    mix(out, REST, easeInOutCubic(phase(t, hold, a.duration)));
  }
  return out;
}
