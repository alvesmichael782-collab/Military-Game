import type { Vector3 } from 'three';
import type { EventBus, ExplosionKind, GameEvents } from '../core/EventBus';
import { localPlayerId } from '../net/PlayerId';
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
  /**
   * What fired the shot (an enemy), so repeated hits from one attacker can be told apart from another's.
   * Left out for blasts and anything else without a lasting shooter.
   */
  attacker?: object;
  /** Which player dealt it (see net/PlayerId.ts), for source 'player'. Defaults to the player on this machine. */
  player?: string;
  /** What blew up, for blast damage (grenade, satchel, mortar shell). */
  blast?: ExplosionKind;
}

/**
 * Decides where a hit is applied. Returns null to apply it here, as usual; otherwise the router has sent it on
 * (a multiplayer client sends hits on enemies and structures to the host) and returns whether it should kill.
 */
export type DamageRouter = (target: Damageable, amount: number, type: DamageType, position: Vector3, info: DamageInfo) => boolean | null;

let router: DamageRouter | null = null;

/** Install (or remove, with null) the multiplayer damage router. */
export function setDamageRouter(next: DamageRouter | null): void {
  router = next;
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

  const player = info.source === 'player' ? (info.player ?? localPlayerId()) : null;
  const routed = router ? router(target, amount, type, position, info) : null;
  if (routed === null) target.takeDamage(amount, type, position, info);
  const killed = routed ?? !target.isAlive;

  events?.emit('damageDealt', {
    target,
    amount,
    type,
    position: position.clone(),
    source: info.source ?? 'environment',
    headshot: info.headshot ?? false,
    killed,
    player,
    routed: routed !== null,
    blast: info.blast ?? null,
  });
  return killed;
}
