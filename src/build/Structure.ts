import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import type { Damageable } from '../combat/Damageable';
import type { DamageType } from '../combat/DamageType';
import type { ImpactSurface } from '../core/EventBus';
import type { Cell } from '../world/BuildGrid';
import type { StructureType } from './Buildables';

/** Called for every hit a structure takes. The StructureManager is the one place that changes structure HP. */
export type StructureDamageHandler = (structure: Structure, amount: number, type: DamageType, from: Vector3) => void;

const local = new Vector3();

/** Distance from `point` to a box standing on the ground, centered on `base`, turned by `yaw`, with the given half sizes. */
export function distanceToGroundBox(point: Vector3, base: Vector3, yaw: number, hx: number, height: number, hz: number): number {
  // Into the box's frame: undo the yaw around the base.
  const dx = point.x - base.x;
  const dz = point.z - base.z;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  local.set(c * dx - s * dz, point.y - base.y, s * dx + c * dz);
  const ox = Math.max(0, Math.abs(local.x) - hx);
  const oz = Math.max(0, Math.abs(local.z) - hz);
  const oy = local.y < 0 ? -local.y : Math.max(0, local.y - height);
  return Math.hypot(ox, oy, oz);
}

/**
 * A player-built structure on the build grid. Damage arrives through `applyDamage` like everything else,
 * but HP only changes in the StructureManager (via `onDamage`), so damage states live in one place.
 */
export abstract class Structure implements Damageable {
  readonly kind = 'structure';
  abstract readonly type: StructureType;
  readonly maxHp: number;
  hp: number;
  /** Ground point under the structure's center. */
  readonly base: Vector3;
  /** Middle of the body, for anything that wants a single point. */
  readonly center: Vector3;
  readonly colliders: RAPIER.Collider[] = [];
  /** Full size in its own frame (width x height x depth), for the removal highlight. */
  abstract readonly size: Vector3;
  /** False for structures nothing can damage (the weapon crate): they never join the damageable registry. */
  readonly damageable: boolean = true;
  /** Which player built it (see net/PlayerId.ts). Removing it refunds them. */
  owner = '';

  constructor(
    readonly id: number,
    readonly cells: readonly Cell[],
    base: Vector3,
    readonly yaw: number,
    maxHp: number,
    centerHeight: number,
    private readonly onDamage: StructureDamageHandler,
  ) {
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.base = base.clone();
    this.center = new Vector3(base.x, base.y + centerHeight, base.z);
  }

  get position(): Vector3 {
    return this.center;
  }

  get isAlive(): boolean {
    return this.hp > 0;
  }

  /** What a bullet hitting it throws up. */
  get impactSurface(): ImpactSurface {
    return 'target';
  }

  takeDamage(amount: number, type: DamageType, from: Vector3): void {
    if (this.isAlive) this.onDamage(this, amount, type, from);
  }

  abstract blastDistance(point: Vector3): number;
  /** Drop the visuals and colliders. The manager has already freed the grid cells and registry entries. */
  abstract dispose(world: RAPIER.World): void;
}
