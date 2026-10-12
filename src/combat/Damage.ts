import type { Vector3 } from 'three';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { Damageable } from './Damageable';
import type { DamageType } from './DamageType';

/**
 * Who caused the damage. Lets the HUD show hit markers only for the player's own hits, and decides
 * whether a kill pays cash. Grenades and satchels carry their thrower's source into their blast.
 */
export type DamageSource = 'player' | 'enemy' | 'environment';

export interface DamageInfo {
  source?: DamageSource;
  /** True when a bullet hit a head zone. The caller has already applied the headshot multiplier. */
  headshot?: boolean;
}

let events: EventBus<GameEvents> | null = null;

/** Connect the damage system to the event bus. Call once at boot. */
export function bindDamageEvents(bus: EventBus<GameEvents>): void {
  events = bus;
}

/**
 * The single entry point for all damage in the game. `position` is where the damage came from
 * (a bullet's hit point or a blast center). Returns true if this hit killed the target.
 */
export function applyDamage(
  target: Damageable,
  amount: number,
  type: DamageType,
  position: Vector3,
  info: DamageInfo = {},
): boolean {
  if (!target.isAlive || amount <= 0) return false;

  target.takeDamage(amount, type, position);
  const killed = !target.isAlive;

  events?.emit('damageDealt', {
    target,
    amount,
    type,
    position: position.clone(),
    source: info.source ?? 'environment',
    headshot: info.headshot ?? false,
    killed,
  });
  return killed;
}
