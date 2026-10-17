import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { buildableOf } from '../build/Buildables';
import type { Structure } from '../build/Structure';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { EventBus, GameEvents, RepairPromptEvent, RepairStopReason } from '../core/EventBus';
import type { Input } from '../core/Input';
import type { Purse } from '../economy/Purse';
import { aimBasis, type AimState } from './Aim';

export const RepairError = {
  CASH: 'NOT ENOUGH CASH',
} as const;

/** A low structure's HP bar floats this far above its top, in meters. */
const BAR_GAP = 0.35;
/** A tall structure's (a wall's) HP bar floats in front of its face, on the player's side, at this fraction of its height. */
const BAR_FACE_HEIGHT = 0.78;
const BAR_FACE_GAP = 0.3;
/** Taller than this counts as tall, in meters. */
const TALL = 1.8;

/** What the repair tool needs from whoever owns the structures (the StructureManager). */
export interface RepairTargets {
  structureOf(collider: RAPIER.Collider): Structure | undefined;
  /** Restore up to `amount` HP; returns the HP actually restored. */
  repair(structure: Structure, amount: number): number;
}

/**
 * Hold E while aiming at a damaged structure within reach to repair it, in any phase. The rifle is lowered
 * meanwhile (no shooting, no grenades). HP comes back at `config.repair.rate`, paid for as it goes at the
 * structure's cash per HP, in small up-front steps so cash ticks down instead of flickering every frame.
 * Letting go of E, looking away, running out of cash or reaching full HP stops it.
 *
 * Also reports the damaged structure under the crosshair (for its HP bar) and drives the repair prompt.
 */
export class RepairTool {
  private held = false;
  private target: Structure | null = null;
  private _aimed: Structure | null = null;
  private _candidate: Structure | null = null;
  /** After running out of cash, E must be let go before a new repair can start (no restart every frame). */
  private waitForRelease = false;
  /** Dollars already paid toward repairs and not yet turned into HP. Carries over to the next repair. */
  private credit = 0;
  private cash = 0;
  private promptKey = '';
  private focusKey = '';

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

  constructor(
    private readonly world: RAPIER.World,
    private readonly structures: RepairTargets,
    private readonly purse: Purse,
    private readonly events: EventBus<GameEvents>,
  ) {
    events.on('cashChanged', ({ cash }) => {
      this.cash = cash;
    });
  }

  /** True while repairing. The rifle and grenades are unavailable meanwhile. */
  get isRepairing(): boolean {
    return this.target !== null;
  }

  /** The structure under the crosshair within `config.repair.hpBarRange`, damaged or not. */
  get aimed(): Structure | null {
    return this._aimed;
  }

  /** Call once per rendered frame, before `input.endFrame()`. */
  handleInput(input: Input, enabled: boolean): void {
    this.held = enabled && input.isActionDown('interact');
  }

  /**
   * How far away a structure E would repair is, in meters (0 while repairing, so the repair keeps E),
   * or Infinity if the crosshair is not on a damaged structure in reach.
   */
  interactDistance(aim: AimState): number {
    this._candidate = this.target;
    if (this.target) return 0;
    const hit = this.cast(aim);
    if (!hit || hit.timeOfImpact > config.repair.range) return Infinity;
    const aimed = this.structures.structureOf(hit.collider);
    if (!aimed || !aimed.isAlive || aimed.hp >= aimed.maxHp) return Infinity;
    this._candidate = aimed;
    return hit.timeOfImpact;
  }

  /** The structure the last `interactDistance` found (being repaired, or repairable under the crosshair), or null. */
  get candidate(): Structure | null {
    return this._candidate;
  }

  /** Aim, repair and update the prompt. Call after the camera has moved. `enabled` false stops any repair. */
  update(dt: number, aim: AimState, enabled: boolean): void {
    const hit = enabled ? this.cast(aim) : null;
    const aimed = hit ? (this.structures.structureOf(hit.collider) ?? null) : null;
    this._aimed = aimed;
    const inReach = aimed !== null && hit !== null && hit.timeOfImpact <= config.repair.range;
    const damaged = aimed !== null && aimed.isAlive && aimed.hp < aimed.maxHp;

    if (this.target) {
      if (!this.target.isAlive) this.stop('destroyed');
      else if (!this.held || !enabled) this.stop('released');
      else if (this.target !== aimed || !inReach) this.stop('lookedAway');
    }
    if (!this.held) this.waitForRelease = false;
    if (!this.target && this.held && !this.waitForRelease && inReach && damaged && aimed) this.start(aimed);
    if (this.target) this.tick(dt, this.target);

    this.updatePrompt(inReach && damaged ? aimed : null);
    this.updateFocus(this.target ?? (damaged ? aimed : null), aim.eye);
  }

  private start(structure: Structure): void {
    this.target = structure;
    this.events.emit('repairStarted', { id: structure.id, type: structure.type, position: structure.base.clone() });
  }

  private stop(reason: RepairStopReason): void {
    const structure = this.target;
    if (!structure) return;
    this.target = null;
    if (reason === 'noCash') this.waitForRelease = true;
    this.events.emit('repairStopped', { id: structure.id, type: structure.type, position: structure.base.clone(), reason });
  }

  private tick(dt: number, structure: Structure): void {
    const perHp = config.repair.cashPerHp[structure.type];
    const wanted = Math.min(config.repair.rate * dt, structure.maxHp - structure.hp);
    if (wanted <= 0) {
      this.stop('complete');
      return;
    }
    if (this.credit < wanted * perHp && !this.charge(structure, perHp)) {
      this.stop('noCash');
      return;
    }
    const restored = this.structures.repair(structure, Math.min(wanted, this.credit / perHp));
    this.credit = Math.max(0, this.credit - restored * perHp);
    if (structure.hp >= structure.maxHp) this.stop('complete');
  }

  /** Pay the next step up front. False (and the wallet flashes the cash red) when the player is broke. */
  private charge(structure: Structure, perHp: number): boolean {
    const owed = Math.ceil((structure.maxHp - structure.hp) * perHp - this.credit);
    const step = Math.max(1, Math.min(config.repair.chargeStep, owed));
    const affordable = Math.min(step, Math.floor(this.cash));
    // Spending what cannot be afforded reports `cashInsufficient`, which flashes the HUD cash counter.
    if (!this.purse.spend(affordable >= 1 ? affordable : step, 'repair')) return false;
    this.credit += affordable;
    return true;
  }

  /** What a full repair still costs, after what is already paid. */
  private costToFull(structure: Structure): number {
    return Math.max(0, Math.ceil((structure.maxHp - structure.hp) * config.repair.cashPerHp[structure.type] - this.credit));
  }

  private updatePrompt(structure: Structure | null): void {
    let prompt: RepairPromptEvent = { mode: 'hidden' };
    if (structure) {
      const cost = this.costToFull(structure);
      prompt = {
        mode: 'repair',
        item: buildableOf(structure.type).name,
        cost,
        repairing: this.target === structure,
        error: this.cash < 1 && cost > 0 ? RepairError.CASH : null,
      };
    }
    const key = JSON.stringify(prompt);
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.events.emit('repairPromptChanged', prompt);
  }

  private updateFocus(structure: Structure | null, eye: Vector3): void {
    // Which face of the structure the player is on (its local +z or -z), for a wall's bar.
    const acrossX = structure ? Math.sin(structure.yaw) : 0;
    const acrossZ = structure ? Math.cos(structure.yaw) : 0;
    const side = structure && (eye.x - structure.base.x) * acrossX + (eye.z - structure.base.z) * acrossZ < 0 ? -1 : 1;
    const key = structure ? `${structure.id}:${Math.ceil(structure.hp)}:${side}` : '';
    if (key === this.focusKey) return;
    this.focusKey = key;
    let anchor: Vector3 | null = null;
    if (structure) {
      const tall = structure.size.y > TALL;
      // Over a low structure; on a wall's face, so it stays in view up close instead of above the top of the screen.
      anchor = tall
        ? structure.base
            .clone()
            .add(new Vector3(acrossX, 0, acrossZ).multiplyScalar(side * (structure.size.z / 2 + BAR_FACE_GAP)))
            .setY(structure.base.y + structure.size.y * BAR_FACE_HEIGHT)
        : structure.base.clone().setY(structure.base.y + structure.size.y + BAR_GAP);
    }
    this.events.emit('structureFocusChanged', {
      target: structure && anchor && { id: structure.id, hp: structure.hp, maxHp: structure.maxHp, anchor },
    });
  }

  private cast(aim: AimState): RAPIER.RayColliderHit | null {
    aimBasis(aim.yaw, aim.pitch, this.forward, this.right, this.up);
    this.ray.origin = { x: aim.eye.x, y: aim.eye.y, z: aim.eye.z };
    this.ray.dir = { x: this.forward.x, y: this.forward.y, z: this.forward.z };
    // The bullet filter: sees structures, passes through the player and through a breached wall's holes.
    return this.world.castRay(this.ray, config.repair.hpBarRange, true, undefined, Groups.bullet);
  }
}
