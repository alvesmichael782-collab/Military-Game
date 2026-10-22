import type { StructureType } from '../build/Buildables';
import type { DamageSource } from '../combat/Damage';
import type { DamageType } from '../combat/DamageType';
import type { GameOverReason, GameResult, ImpactSurface } from '../core/EventBus';
import type { Phase } from '../core/GameState';
import type { Cell, Edge } from '../world/BuildGrid';

/** A position or direction on the wire, rounded to centimeters. */
export type V3 = [number, number, number];

/**
 * One player's body and view, `playerSendRate` times a second:
 * feet x, y, z, view yaw and pitch (FPSCamera's), crouching, alive, sprinting (1/0), and the MG nest they are on (0 for none).
 */
export type PlayerState = [x: number, y: number, z: number, yaw: number, pitch: number, crouch: number, alive: number, sprint: number, nest: number];

/** Host events that clients replay as they are (see EventRelay.ts). */
export type RelayedEvent =
  | 'enemySpawned'
  | 'enemyKilled'
  | 'enemyDamaged'
  | 'enemyFired'
  | 'enemyFootstep'
  | 'enemyCallout'
  | 'wavePlanned'
  | 'waveStarted'
  | 'squadSpawned'
  | 'enemiesRemaining'
  | 'waveCleared';

/**
 * Everything sent in game. Clients only talk to the host. Messages a client sends about itself (`state`,
 * `shot`, `impact`, `grenade`) are relayed by the host to the other clients with `id` filled in.
 */
export type GameMessage =
  // ---- Players (every machine about its own player) ----
  | { t: 'state'; id?: string; s: PlayerState }
  /** A shot: weapon def id (or 'mg'), muzzle, and where it stopped (null: hit nothing). */
  | { t: 'shot'; id?: string; w: string; m: V3; e: V3 | null }
  | { t: 'impact'; p: V3; n: V3; s: ImpactSurface }
  | { t: 'grenade'; id?: string; p: V3; v: V3 }
  // ---- Damage ----
  /** Client to host: its player hit an enemy ('e', by pool slot), a structure ('s', by id) or the core ('c'). */
  | { t: 'hit'; k: 'e' | 's' | 'c'; id: number; a: number; ty: DamageType; src: DamageSource; p: V3; h: boolean }
  /** Host to client: something hit that client's player. `att` is the shooter's pool slot, or -1 for a blast. */
  | { t: 'hurt'; a: number; ty: DamageType; p: V3; att: number }
  // ---- World, host to clients ----
  | { t: 'event'; n: RelayedEvent; p: Record<string, unknown> }
  /** Every soldier on the field, `ENEMY_STRIDE` numbers each (see EnemySync.ts). */
  | { t: 'enemies'; d: number[] }
  | { t: 'phase'; to: Phase; w: number; r: number }
  | { t: 'timer'; ph: Phase; s: number }
  | { t: 'over'; res: GameResult; why: GameOverReason; w: number }
  | { t: 'satchel'; p: V3; y: number; f: number; d: boolean }
  | { t: 'core'; hp: number }
  | { t: 'ready'; r: number; n: number; ids: string[] }
  | { t: 'left'; id: string }
  // ---- Structures ----
  /** Client to host: build this (the client has paid `c`). Walls use `e`, the nest and crates `cell` (the nest's is its center point). */
  | { t: 'build'; k: StructureType; e?: Edge; cell?: Cell; y: number; c: number }
  /** Host to clients: it was built, as structure `id`, by player `o`. */
  | { t: 'placed'; k: StructureType; e?: Edge; cell?: Cell; y: number; c: number; id: number; o: string }
  | { t: 'remove'; id: number }
  | { t: 'removed'; id: number }
  /** Clear the rubble pile left by structure `sid`. */
  | { t: 'clear'; sid: number }
  | { t: 'cleared'; sid: number }
  /** Client to host: its player repaired `a` HP of structure `id`. */
  | { t: 'repair'; id: number; a: number }
  /** Host to clients: structure `id` changed by `d` HP (negative is damage) and now has `hp` on the host. */
  | { t: 'hp'; id: number; d: number; hp: number; ty: DamageType; p: V3 }
  /** Host to a client: cash for that player (a refund for something they built). */
  | { t: 'cash'; a: number }
  // ---- Votes ----
  /** Client to host: its player pressed the start key (start the wave, or skip the summary). */
  | { t: 'vote' };

export function v3(v: { x: number; y: number; z: number }): V3 {
  return [round2(v.x), round2(v.y), round2(v.z)];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
