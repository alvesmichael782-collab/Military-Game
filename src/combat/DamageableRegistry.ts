import type RAPIER from '@dimforge/rapier3d-compat';
import type { Damageable } from './Damageable';

/** Which part of a body a bullet hit. Only bodies with a head zone take headshot damage. */
export type HitZone = 'body' | 'head';

export interface Hitbox {
  readonly target: Damageable;
  readonly zone: HitZone;
}

/**
 * Every live damageable, plus a lookup from physics collider to the damageable it belongs to.
 * Hitscan uses the lookup to turn a ray hit into a target and zone; explosions walk the full list.
 */
export class DamageableRegistry {
  private readonly items = new Set<Damageable>();
  private readonly hitboxes = new Map<number, Hitbox>();

  add(target: Damageable): void {
    this.items.add(target);
  }

  /** Map a collider to a damageable so bullets hitting it damage that target. Also registers the target. */
  addHitbox(collider: RAPIER.Collider, target: Damageable, zone: HitZone): void {
    this.items.add(target);
    this.hitboxes.set(collider.handle, { target, zone });
  }

  /** Forget a target and its hitbox colliders, e.g. when a structure is destroyed or removed. */
  remove(target: Damageable, colliders: readonly RAPIER.Collider[]): void {
    this.items.delete(target);
    for (const collider of colliders) this.hitboxes.delete(collider.handle);
  }

  /** Forget one hitbox collider, e.g. a wall joint that is being rebuilt. */
  removeHitbox(collider: RAPIER.Collider): void {
    this.hitboxes.delete(collider.handle);
  }

  hitboxOf(collider: RAPIER.Collider): Hitbox | undefined {
    return this.hitboxes.get(collider.handle);
  }

  get all(): ReadonlySet<Damageable> {
    return this.items;
  }
}
