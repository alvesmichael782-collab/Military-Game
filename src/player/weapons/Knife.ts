import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Vector3 } from 'three';
import { applyDamage } from '../../combat/Damage';
import type { DamageableRegistry, Hitbox } from '../../combat/DamageableRegistry';
import { Groups } from '../../core/CollisionGroups';
import type { EventBus, GameEvents, ImpactSurface } from '../../core/EventBus';
import { aimBasis, type AimState } from '../Aim';
import type { MeleeAttack, MeleeDef } from './defs/WeaponDef';
import type { HeldWeapon } from './HeldWeapon';

export type MeleeAttackKind = 'slash' | 'stab';
export type KnifePhase = 'idle' | 'windup' | 'attack';

/** Rays in the fan that sweeps the attack's arc. */
const SLASH_RAYS = 7;
const STAB_RAYS = 3;

/**
 * A melee weapon. Pressing the attack button starts a short wind-up: let go within `stabHoldTime` and it slashes
 * (each slash swings the other way), keep holding and it becomes a slower, stronger stab (repeating while held).
 * The hit lands `hitTime` into the attack: a fan of rays across the attack's arc finds the nearest enemy, or else
 * whatever solid thing is in reach, and the blow goes through `applyDamage` as 'melee' damage.
 */
export class Knife implements HeldWeapon {
  readonly spread = 0;
  readonly recoilPitch = 0;
  readonly recoilYaw = 0;
  readonly reloadElapsed = -1;
  readonly isReloading = false;

  private _phase: KnifePhase = 'idle';
  private _attack: MeleeAttackKind = 'slash';
  private elapsed = 0;
  private hitDone = false;
  private held = false;
  private wasHeld = false;
  /** 1: the next slash swings right to left; -1: left to right. */
  private side = 1;
  private _slashSide = 1;

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly direction = new Vector3();
  private readonly point = new Vector3();
  private readonly normal = new Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

  constructor(
    readonly def: MeleeDef,
    private readonly events: EventBus<GameEvents>,
    private readonly world: RAPIER.World,
    private readonly registry: DamageableRegistry,
  ) {}

  get phase(): KnifePhase {
    return this._phase;
  }

  get attack(): MeleeAttackKind {
    return this._attack;
  }

  /** Seconds into the wind-up or the attack. */
  get phaseElapsed(): number {
    return this.elapsed;
  }

  /** Which way the current (or last) slash swings: 1 right to left, -1 left to right. */
  get slashSide(): number {
    return this._slashSide;
  }

  setTrigger(held: boolean): void {
    this.held = held;
  }

  setAimAmount(): void {}

  reload(): boolean {
    return false;
  }

  refill(): void {}

  putAway(): void {
    this.held = false;
    this.wasHeld = false;
    this._phase = 'idle';
    this.elapsed = 0;
  }

  announce(): void {}

  update(dt: number, aim: AimState): void {
    const pressed = this.held && !this.wasHeld;
    this.wasHeld = this.held;
    this.elapsed += dt;

    if (this._phase === 'idle' && pressed) {
      this._phase = 'windup';
      this.elapsed = 0;
    }
    if (this._phase === 'windup') {
      if (!this.held) this.begin('slash');
      else if (this.elapsed >= this.def.stabHoldTime) this.begin('stab');
    }
    if (this._phase !== 'attack') return;

    const attack = this.current;
    if (!this.hitDone && this.elapsed >= attack.hitTime) {
      this.hitDone = true;
      this.strike(aim, attack);
    }
    if (this.elapsed >= attack.duration) {
      // Still holding after a stab: another stab follows straight away.
      if (this.held && this._attack === 'stab') {
        this.begin('stab');
      } else {
        this._phase = 'idle';
        this.elapsed = 0;
      }
    }
  }

  private get current(): MeleeAttack {
    return this._attack === 'slash' ? this.def.slash : this.def.stab;
  }

  private begin(kind: MeleeAttackKind): void {
    this._phase = 'attack';
    this._attack = kind;
    this.elapsed = 0;
    this.hitDone = false;
    if (kind === 'slash') {
      this._slashSide = this.side;
      this.side = -this.side;
    }
    this.events.emit('meleeSwung', { weapon: this.def.id, attack: kind, sounds: this.def.sounds });
  }

  /** Sweep the attack's arc with a fan of rays and hit the best target in reach. */
  private strike(aim: AimState, attack: MeleeAttack): void {
    aimBasis(aim.yaw, aim.pitch, this.forward, this.right, this.up);
    const rays = this._attack === 'slash' ? SLASH_RAYS : STAB_RAYS;
    let best: { hitbox: Hitbox | undefined; toi: number; dir: Vector3; normal: RAPIER.Vector } | null = null;
    for (let k = 0; k < rays; k++) {
      // Across the arc, tilted with the swing so a slash cuts a diagonal.
      const u = (k / (rays - 1)) * 2 - 1;
      const yaw = MathUtils.degToRad(attack.arc) * u;
      const pitch = this._attack === 'slash' ? -yaw * 0.35 * this._slashSide : 0;
      this.direction
        .copy(this.forward)
        .addScaledVector(this.right, Math.tan(yaw))
        .addScaledVector(this.up, Math.tan(pitch))
        .normalize();
      this.ray.origin = { x: aim.eye.x, y: aim.eye.y, z: aim.eye.z };
      this.ray.dir = { x: this.direction.x, y: this.direction.y, z: this.direction.z };
      const hit = this.world.castRayAndGetNormal(this.ray, this.def.range, true, undefined, Groups.bullet);
      if (!hit) continue;
      const hitbox = this.registry.hitboxOf(hit.collider);
      // An enemy anywhere in the arc beats a wall that is closer; otherwise the nearest thing wins.
      const better =
        best === null ||
        (hitbox?.target.kind === 'enemy' && best.hitbox?.target.kind !== 'enemy') ||
        ((hitbox?.target.kind === 'enemy') === (best.hitbox?.target.kind === 'enemy') && hit.timeOfImpact < best.toi);
      if (better) best = { hitbox, toi: hit.timeOfImpact, dir: this.direction.clone(), normal: hit.normal };
    }
    if (!best) return;

    this.point.copy(aim.eye).addScaledVector(best.dir, best.toi);
    this.normal.set(best.normal.x, best.normal.y, best.normal.z);
    const target = best.hitbox?.target;
    const surface: ImpactSurface = target ? (target.impactSurface ?? 'target') : 'hard';
    this.events.emit('meleeHit', { weapon: this.def.id, attack: this._attack, sounds: this.def.sounds, point: this.point, normal: this.normal, surface });
    if (best.hitbox && target) {
      const headshot = best.hitbox.zone === 'head';
      const damage = attack.damage * (headshot ? this.def.headshotMultiplier : 1);
      applyDamage(target, damage, 'melee', this.point, { source: 'player', headshot });
    }
  }
}
