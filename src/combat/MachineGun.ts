import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Vector3 } from 'three';
import type { MgNest } from '../build/MgNest';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { EventBus, GameEvents, ImpactSurface } from '../core/EventBus';
import { aimBasis } from '../player/Aim';
import { applyDamage } from './Damage';
import type { DamageableRegistry } from './DamageableRegistry';

/** Smallest change in heat worth telling the HUD about. */
const HEAT_STEP = 0.005;

/**
 * The MG nest's gun, fired by the mounted player: hitscan from the eye along the view, `roundsPerMinute`
 * while the trigger is held, a tracer every few rounds. No ammo; each shot adds heat instead, which bleeds
 * off once the trigger has been let go. At full heat the gun locks for `overheatLockTime` while it cools.
 * Kills count as the player's.
 */
export class MachineGun {
  private heat = 0;
  private overheated = false;
  private lockTimer = 0;
  private cooldown = 0;
  private sinceShot = Infinity;
  private triggerHeld = false;
  private burstShots = 0;
  private rounds = 0;
  private announcedHeat = -1;
  private announcedOverheated = false;

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly direction = new Vector3();
  private readonly end = new Vector3();
  private readonly normal = new Vector3();
  private readonly muzzle = new Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly world: RAPIER.World,
    private readonly registry: DamageableRegistry,
  ) {}

  /** 0 cold, 1 overheated. */
  get heatLevel(): number {
    return this.heat;
  }

  get isOverheated(): boolean {
    return this.overheated;
  }

  setTrigger(held: boolean): void {
    if (!held) this.endBurst();
    this.triggerHeld = held;
  }

  /**
   * Cool down, and fire while the trigger is held. Call once per rendered frame, mounted or not (the gun keeps
   * cooling). `nest` is the mounted nest, or null; `eye`, `yaw` and `pitch` are the mounted camera's.
   */
  update(dt: number, nest: MgNest | null, eye: Vector3, yaw: number, pitch: number): void {
    const mg = config.mg;
    this.sinceShot += dt;
    if (this.overheated) {
      this.lockTimer -= dt;
      if (this.lockTimer <= 0) this.overheated = false;
    }
    if (this.sinceShot >= mg.coolDelay) this.heat = Math.max(0, this.heat - mg.coolRate * dt);

    // The cooldown carries over between frames so the fire rate stays exact at any frame rate.
    this.cooldown -= dt;
    if (nest && this.triggerHeld && !this.overheated) {
      while (this.cooldown <= 0) {
        this.fire(nest, eye, yaw, pitch);
        this.cooldown += 60 / mg.roundsPerMinute;
        this.heat = Math.min(1, this.heat + mg.heatPerShot);
        if (this.heat >= 1) {
          this.overheated = true;
          this.lockTimer = mg.overheatLockTime;
          this.endBurst();
          this.events.emit('mgOverheated', {});
          break;
        }
      }
    } else if (this.triggerHeld) {
      this.endBurst();
    }
    if (this.cooldown < 0) this.cooldown = 0;
    this.announce();
  }

  private fire(nest: MgNest, eye: Vector3, yaw: number, pitch: number): void {
    const mg = config.mg;
    aimBasis(yaw, pitch, this.forward, this.right, this.up);
    const offset = Math.tan(MathUtils.degToRad(mg.spread)) * Math.sqrt(Math.random());
    const angle = Math.random() * Math.PI * 2;
    this.direction
      .copy(this.forward)
      .addScaledVector(this.right, Math.cos(angle) * offset)
      .addScaledVector(this.up, Math.sin(angle) * offset)
      .normalize();

    // From the eye, so bullets go where the crosshair is; the nest's own sandbags and gun never stop them.
    this.ray.origin = { x: eye.x, y: eye.y, z: eye.z };
    this.ray.dir = { x: this.direction.x, y: this.direction.y, z: this.direction.z };
    const hit = this.world.castRayAndGetNormal(this.ray, mg.range, true, undefined, Groups.bullet, undefined, nest.body ?? undefined);
    this.end.copy(eye).addScaledVector(this.direction, hit ? hit.timeOfImpact : mg.range);

    this.rounds++;
    this.burstShots++;
    this.sinceShot = 0;
    nest.muzzlePosition(this.muzzle);
    this.events.emit('mgFired', { muzzle: this.muzzle, end: this.end, tracer: this.rounds % mg.tracerEvery === 0 });
    if (!hit) return;

    this.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    const hitbox = this.registry.hitboxOf(hit.collider);
    let surface: ImpactSurface;
    if (hitbox) surface = hitbox.target.impactSurface ?? 'target';
    else surface = hit.collider.shapeType() === RAPIER.ShapeType.HalfSpace ? 'dirt' : 'hard';
    this.events.emit('bulletImpact', { point: this.end, normal: this.normal, surface });

    if (hitbox) {
      const headshot = hitbox.zone === 'head';
      const damage = mg.damage * (headshot ? mg.headshotMultiplier : 1);
      applyDamage(hitbox.target, damage, 'ballistic', this.end, { source: 'player', headshot });
    }
  }

  private endBurst(): void {
    if (this.burstShots === 0) return;
    this.burstShots = 0;
    this.events.emit('mgBurstEnded', {});
  }

  private announce(): void {
    // Always report landing exactly on 0 or 1, so the bar empties and fills fully.
    const atEnd = (this.heat === 0 || this.heat === 1) && this.heat !== this.announcedHeat;
    const changed = atEnd || Math.abs(this.heat - this.announcedHeat) >= HEAT_STEP || this.overheated !== this.announcedOverheated;
    if (!changed) return;
    this.announcedHeat = this.heat;
    this.announcedOverheated = this.overheated;
    this.events.emit('mgHeatChanged', { heat: this.heat, overheated: this.overheated });
  }
}
