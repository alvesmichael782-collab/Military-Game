import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Vector3 } from 'three';
import { applyDamage } from '../../combat/Damage';
import type { DamageableRegistry } from '../../combat/DamageableRegistry';
import { Groups } from '../../core/CollisionGroups';
import { config } from '../../core/config';
import type { EventBus, GameEvents, ImpactSurface } from '../../core/EventBus';
import { aimBasis, type AimState } from '../Aim';
import type { GunDef } from './defs/WeaponDef';
import { Recoil } from './Recoil';
import { Weapon } from './Weapon';

/** Smallest change in spread, in radians, worth telling the crosshair about. */
const SPREAD_EPSILON = 0.0002;

const deg = MathUtils.degToRad;

/** A hitscan gun driven entirely by its def: fire mode and rate, damage, Counter-Strike-style recoil, movement-based spread. */
export class Gun extends Weapon {
  /**
   * Where the muzzle is relative to the eye, in camera space (x right, y up, -z forward), as the player sees it.
   * Set every frame by the weapon manager from the view model; the muzzle light and tracers start here.
   */
  readonly muzzleOffset = new Vector3(0.18, -0.13, -0.75);

  private readonly recoil: Recoil;
  private bloom = 0;
  private _spread = 0;
  private announcedSpread = -1;

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly direction = new Vector3();
  private readonly point = new Vector3();
  private readonly normal = new Vector3();
  private readonly muzzle = new Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

  constructor(
    def: GunDef,
    events: EventBus<GameEvents>,
    private readonly world: RAPIER.World,
    private readonly registry: DamageableRegistry,
  ) {
    super(def, events);
    this.recoil = new Recoil(def.recoil);
  }

  get spread(): number {
    return this._spread;
  }

  get recoilPitch(): number {
    return this.recoil.pitch;
  }

  get recoilYaw(): number {
    return this.recoil.yaw;
  }

  override putAway(): void {
    super.putAway();
    this.recoil.reset();
    this.bloom = 0;
  }

  override refill(): void {
    super.refill();
    this.recoil.reset();
  }

  protected tick(dt: number, aim: AimState): void {
    this.recoil.update(dt, this.isFiring);
    this.bloom = Math.max(0, this.bloom - this.def.spread.bloomRecovery * dt);
    this._spread = this.currentSpread(aim);
    if (Math.abs(this._spread - this.announcedSpread) > SPREAD_EPSILON) {
      this.announcedSpread = this._spread;
      this.events.emit('weaponSpreadChanged', { spread: this._spread });
    }
  }

  protected fire(aim: AimState): void {
    const def = this.def;
    // Bullets leave along the recoiled view, plus a random offset inside the spread cone.
    aimBasis(aim.yaw + this.recoil.yaw, aim.pitch + this.recoil.pitch, this.forward, this.right, this.up);
    const offset = Math.tan(this._spread) * Math.sqrt(Math.random());
    const angle = Math.random() * Math.PI * 2;
    this.direction
      .copy(this.forward)
      .addScaledVector(this.right, Math.cos(angle) * offset)
      .addScaledVector(this.up, Math.sin(angle) * offset)
      .normalize();

    // The kick is worked out first so the shot's event can carry it; the bullet still flies along the view as it was.
    this.recoil.kick(this.recoilScale(aim) * this.aimScale(def.ads.recoilMultiplier));
    const m = this.muzzleOffset;
    this.muzzle.copy(aim.eye).addScaledVector(this.right, m.x).addScaledVector(this.up, m.y).addScaledVector(this.forward, -m.z);
    this.traceBullet(aim.eye, def.range);

    this.bloom = Math.min(def.spread.maxBloom, this.bloom + def.spread.bloomPerShot);
    // The next shot in this frame (very low frame rates only) uses the grown spread.
    this._spread = this.currentSpread(aim);
  }

  /** Spread cone half-angle for the current stance, movement, bloom and aim, in radians. */
  private currentSpread(aim: AimState): number {
    return deg(this.movementSpread(aim) + this.bloom) * this.aimScale(this.def.ads.spreadMultiplier);
  }

  /** Recoil multiplier for the current stance: tighter crouched, wilder sprinting or in the air. */
  private recoilScale(aim: AimState): number {
    const r = this.def.recoil;
    const body = aim.body;
    if (body.sprinting || !body.grounded) return r.mobileScale;
    if (body.crouching) return r.crouchingScale;
    return 1;
  }

  /** Base spread for the current stance and movement, in degrees. */
  private movementSpread(aim: AimState): number {
    const s = this.def.spread;
    const body = aim.body;
    let spread = body.crouching && body.grounded ? s.crouching : s.standing;
    spread += s.moving * Math.min(body.horizontalSpeed / config.player.walkSpeed, config.player.sprintSpeed / config.player.walkSpeed);
    if (!body.grounded) spread += s.airborne;
    return spread;
  }

  private traceBullet(eye: Vector3, range: number): void {
    this.ray.origin = { x: eye.x, y: eye.y, z: eye.z };
    this.ray.dir = { x: this.direction.x, y: this.direction.y, z: this.direction.z };
    const hit = this.world.castRayAndGetNormal(this.ray, range, true, undefined, Groups.bullet);
    if (hit) this.point.copy(eye).addScaledVector(this.direction, hit.timeOfImpact);
    // Before the bullet's impact, so the tracer knows where it starts.
    this.events.emit('weaponFired', {
      weapon: this.def.id,
      sounds: this.def.sounds,
      muzzle: this.muzzle,
      end: hit ? this.point : null,
      kickUp: this.recoil.lastKickUp,
      kickSide: this.recoil.lastKickSide,
    });
    if (!hit) return;

    this.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);

    const hitbox = this.registry.hitboxOf(hit.collider);
    let surface: ImpactSurface;
    if (hitbox) {
      surface = hitbox.target.impactSurface ?? 'target';
    } else {
      surface = hit.collider.shapeType() === RAPIER.ShapeType.HalfSpace ? 'dirt' : 'hard';
    }
    this.events.emit('bulletImpact', { point: this.point, normal: this.normal, surface });

    if (hitbox) {
      const headshot = hitbox.zone === 'head';
      const damage = this.def.damage * (headshot ? this.def.headshotMultiplier : 1);
      applyDamage(hitbox.target, damage, 'ballistic', this.point, { source: 'player', headshot });
    }
  }
}
