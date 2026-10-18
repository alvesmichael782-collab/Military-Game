import type { Vector3 } from 'three';
import type { ImpactSurface } from '../core/EventBus';
import type { DamageInfo } from './Damage';
import type { DamageType } from './DamageType';

/** Broad category of a damageable thing, so listeners can tell the player apart from what they shoot. */
export type DamageableKind = 'player' | 'enemy' | 'structure' | 'core';

/** Anything that can take damage. Damage always arrives through `applyDamage`, never by calling `takeDamage` directly. */
export interface Damageable {
  readonly kind: DamageableKind;
  /** Center of the body, used for explosion distance. */
  readonly position: Vector3;
  readonly isAlive: boolean;
  /**
   * Distance from `point` to the body's surface, for explosion falloff. Large flat things like walls
   * implement it; without it, explosions measure to `position`.
   */
  blastDistance?(point: Vector3): number;
  /** What a bullet hitting it throws up. Without it, a hit counts as 'target'. */
  readonly impactSurface?: ImpactSurface;
  /** `position` is where the damage came from (hit point or blast center). `info` is what `applyDamage` was given. */
  takeDamage(amount: number, type: DamageType, position: Vector3, info?: DamageInfo): void;
}
