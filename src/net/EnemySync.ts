import { Vector3 } from 'three';
import { config } from '../core/config';
import type { EnemyManager } from '../enemies/EnemyManager';
import { UNIFORM_COLORS } from '../enemies/SoldierGeometry';
import { createSoldierPose } from '../enemies/SoldierRig';
import { round2, round3 } from './protocol';

// One soldier's numbers in an `enemies` message.
const SLOT = 0;
const UNIFORM = 1;
const ALIVE = 2;
const HP = 3;
const X = 4;
const Y = 5;
const Z = 6;
const YAW = 7;
const SPEED = 8;
const PHASE = 9;
const AIM = 10;
const AIM_PITCH = 11;
const CROUCH = 12;
const LEAN = 13;
const ROLL = 14;
const RECOIL = 15;
const FLINCH = 16;
const FLINCH_SIDE = 17;
const FALL = 18;
const FALL_X = 19;
const FALL_Z = 20;
const SINK = 21;
const FLAGS = 22;
export const ENEMY_STRIDE = 23;

const ARMED = 1;
const SATCHEL = 2;
const BAND = 4;
/** Blended between snapshots; the rest (slot, uniform, alive, flags) come from the newer one. */
const BLENDED = [HP, X, Y, Z, SPEED, PHASE, AIM, AIM_PITCH, CROUCH, LEAN, ROLL, RECOIL, FLINCH, FALL, FALL_X, FALL_Z, SINK];
const UNIFORMS = [UNIFORM_COLORS.tan, UNIFORM_COLORS.olive, UNIFORM_COLORS.sapper];
/** Snapshots kept for blending. */
const HISTORY = 6;

interface Snapshot {
  time: number;
  /** Each soldier's numbers, by pool slot. */
  bySlot: Map<number, number[]>;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Host: every soldier on the field, packed for an `enemies` message. */
export function packEnemies(enemies: EnemyManager): number[] {
  const out: number[] = [];
  for (const enemy of enemies.enemies) {
    if (!enemy.active) continue;
    const p = enemy.soldierPose;
    const f = enemy.currFeet;
    const uniform = Math.max(0, UNIFORMS.indexOf(enemies.uniformOf(enemy.slot) as (typeof UNIFORMS)[number]));
    const flags = (p.armed ? ARMED : 0) | (p.satchel ? SATCHEL : 0) | (p.band ? BAND : 0);
    out.push(
      enemy.slot, uniform, enemy.isAlive ? 1 : 0, Math.ceil(enemy.hp),
      round2(f.x), round2(f.y), round2(f.z), round3(enemy.yaw),
      round2(p.speed), round2(p.phase), round2(p.aim), round3(p.aimPitch), round2(p.crouch), round2(p.lean), round3(p.roll),
      round2(p.recoil), round2(p.flinch), p.flinchSide, round2(p.fall), round2(p.fallX), round2(p.fallZ), round2(p.sink), flags,
    );
  }
  return out;
}

/**
 * Client: shows the host's soldiers. Keeps the last few snapshots and, every frame, draws each soldier
 * `interpolationDelay` in the past, blended between the two snapshots around that moment. Brings pooled
 * soldiers in, kills them and sends them back to the pool as the host's snapshots say.
 */
export class EnemyReplica {
  private readonly snapshots: Snapshot[] = [];
  private readonly blended = new Array<number>(ENEMY_STRIDE).fill(0);
  private readonly pose = createSoldierPose();
  private readonly feet = new Vector3();
  private readonly seen = new Set<number>();

  constructor(private readonly enemies: EnemyManager) {}

  /** An `enemies` message arrived. */
  receive(data: readonly number[]): void {
    const bySlot = new Map<number, number[]>();
    for (let i = 0; i + ENEMY_STRIDE <= data.length; i += ENEMY_STRIDE) bySlot.set(data[i + SLOT], data.slice(i, i + ENEMY_STRIDE));
    this.snapshots.push({ time: performance.now() / 1000, bySlot });
    if (this.snapshots.length > HISTORY) this.snapshots.shift();
  }

  /** Pose every soldier for this frame. Call before the enemy manager draws. */
  update(): void {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) return;
    const renderTime = performance.now() / 1000 - config.multiplayer.interpolationDelay;
    // The newest snapshot at or before the render time, and the one after it.
    let older = this.snapshots[0];
    let newer = older;
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i].time <= renderTime) {
        older = this.snapshots[i];
        newer = this.snapshots[Math.min(i + 1, this.snapshots.length - 1)];
        break;
      }
    }
    const span = newer.time - older.time;
    const t = span > 1e-4 ? Math.min(1, Math.max(0, (renderTime - older.time) / span)) : 1;

    this.seen.clear();
    for (const [slot, b] of newer.bySlot) {
      this.seen.add(slot);
      const a = older.bySlot.get(slot) ?? b;
      const out = this.blended;
      for (let i = 0; i < ENEMY_STRIDE; i++) out[i] = b[i];
      for (const i of BLENDED) out[i] = a[i] + (b[i] - a[i]) * t;
      out[YAW] = a[YAW] + wrapAngle(b[YAW] - a[YAW]) * t;
      this.apply(slot, out);
    }
    // The host has sent these back to the pool (or never had them).
    for (const enemy of this.enemies.enemies) if (enemy.active && !this.seen.has(enemy.slot)) this.enemies.replicaRelease(enemy.slot);
  }

  private apply(slot: number, s: readonly number[]): void {
    this.feet.set(s[X], s[Y], s[Z]);
    let enemy = this.enemies.bySlot(slot);
    if (!enemy) return;
    if (!enemy.active) enemy = this.enemies.replicaSpawn(slot, this.feet, s[YAW], UNIFORMS[s[UNIFORM]] ?? UNIFORM_COLORS.tan);
    if (!enemy) return;
    if (s[ALIVE] === 0) enemy.replicaDie();
    const p = this.pose;
    const flags = s[FLAGS];
    p.armed = (flags & ARMED) !== 0;
    p.satchel = (flags & SATCHEL) !== 0;
    p.band = (flags & BAND) !== 0;
    p.fullSpeed = p.armed ? config.rifleman.speed : config.sapper.speed;
    p.speed = s[SPEED];
    p.phase = s[PHASE];
    p.aim = s[AIM];
    p.aimPitch = s[AIM_PITCH];
    p.crouch = s[CROUCH];
    p.lean = s[LEAN];
    p.roll = s[ROLL];
    p.recoil = s[RECOIL];
    p.flinch = s[FLINCH];
    p.flinchSide = s[FLINCH_SIDE];
    p.fall = s[FALL];
    p.fallX = s[FALL_X];
    p.fallZ = s[FALL_Z];
    p.sink = s[SINK];
    enemy.replicaUpdate(this.feet, s[YAW], p, s[HP]);
  }
}
