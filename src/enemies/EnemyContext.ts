import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vector3 } from 'three';
import type { Structure } from '../build/Structure';
import type { Damageable } from '../combat/Damageable';
import type { DamageableRegistry } from '../combat/DamageableRegistry';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { BuildGrid } from '../world/BuildGrid';
import type { Enemy } from './Enemy';
import type { Satchels } from './Satchels';
import type { SightBudget } from './SightBudget';

/** What enemies may know about the player: read-only, live values. */
export interface PlayerTarget {
  /** Feet position at the latest fixed step. */
  readonly position: Vector3;
  readonly velocity: Readonly<Vector3>;
  readonly crouching: boolean;
  readonly colliderHandle: number;
  /** Where enemy hits land (armor first, then health). */
  readonly damageable: Damageable;
}

/** The outpost core, as enemies see it. */
export interface CoreTarget extends Damageable {
  /** Ground point under the core. */
  readonly base: Vector3;
}

/** Shared services every enemy uses. Owned by the EnemyManager. */
export interface EnemyContext {
  readonly world: RAPIER.World;
  readonly grid: BuildGrid;
  readonly registry: DamageableRegistry;
  readonly events: EventBus<GameEvents>;
  /** Every player in the game (one in single player). Riflemen pick their target from these. */
  readonly players: readonly PlayerTarget[];
  readonly core: CoreTarget;
  readonly sight: SightBudget;
  readonly satchels: Satchels;
  /** The live structure with this id, if any (breach targets). */
  wall(id: number): Structure | undefined;
  /** Queue a path search for this enemy (deduplicated). */
  requestPath(enemy: Enemy): void;
  /** Seconds of (unfrozen) play since the manager started, for timestamps. */
  now(): number;
}
