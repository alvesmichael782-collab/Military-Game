import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { EventBus, ExplosionKind, GameEvents } from '../core/EventBus';
import { applyDamage, type DamageSource } from './Damage';
import type { Damageable } from './Damageable';
import type { DamageableRegistry } from './DamageableRegistry';

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const DOWN = { x: 0, y: -1, z: 0 };
/** Fraction of each blast impulse pointed straight up, so things get tossed rather than slid. */
const IMPULSE_LIFT = 0.4;

/** Damage scale at `distance` from the center: full inside `fullRadius`, falling linearly to zero at `radius`. */
export function blastFalloff(distance: number, radius: number, fullRadius: number): number {
  if (distance <= fullRadius) return 1;
  if (distance >= radius) return 0;
  return 1 - (distance - fullRadius) / (radius - fullRadius);
}

export interface ExplodeOptions {
  /** What blew up, for the sound. Defaults to a frag grenade. */
  kind?: ExplosionKind;
  /** Full damage inside this distance. Defaults to the frag grenade's. */
  fullDamageRadius?: number;
  /** Effects and shove only, no damage: a multiplayer copy of a blast whose damage is dealt on another machine. */
  harmless?: boolean;
}

/** Explosions: area damage with falloff, physics impulses, and the `explosion` event that drives effects, shake and sound. */
export class Explosions {
  private readonly ball = new RAPIER.Ball(1);
  private readonly bodies = new Set<RAPIER.RigidBody>();
  private readonly downRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, DOWN);
  private readonly groundPoint = new Vector3();
  private readonly groundNormal = new Vector3(0, 1, 0);
  private readonly offset = new Vector3();

  constructor(
    private readonly world: RAPIER.World,
    private readonly registry: DamageableRegistry,
    private readonly events: EventBus<GameEvents>,
  ) {}

  /**
   * Blow up at `position`: explosive damage to every damageable within `radius` (the player and enemies
   * included; friendly fire is on), and a shove for loose bodies. `source` is who set it off.
   */
  explode(position: Vector3, radius: number, damage: number, source: DamageSource, options: ExplodeOptions = {}): void {
    const fullRadius = Math.min(options.fullDamageRadius ?? config.grenade.fullDamageRadius, radius);

    // Collect first: damage can kill and change the registry's contents.
    const hits: [target: Damageable, scale: number][] = [];
    if (!options.harmless) for (const target of this.registry.all) {
      if (!target.isAlive) continue;
      const distance = target.blastDistance ? target.blastDistance(position) : target.position.distanceTo(position);
      const scale = blastFalloff(distance, radius, fullRadius);
      if (scale > 0) hits.push([target, scale]);
    }
    for (const [target, scale] of hits) {
      applyDamage(target, damage * scale, 'explosive', position, { source });
    }

    this.pushBodies(position, radius, fullRadius);
    const ground = this.findGround(position);
    this.events.emit('explosion', {
      position,
      radius,
      damage,
      kind: options.kind ?? 'frag',
      groundPoint: ground ? this.groundPoint : null,
      groundNormal: this.groundNormal,
    });
  }

  private pushBodies(position: Vector3, radius: number, fullRadius: number): void {
    this.ball.radius = radius;
    this.bodies.clear();
    this.world.intersectionsWithShape(
      position,
      IDENTITY_ROTATION,
      this.ball,
      (collider) => {
        const body = collider.parent();
        if (body && body.isDynamic()) this.bodies.add(body);
        return true;
      },
      RAPIER.QueryFilterFlags.ONLY_DYNAMIC,
    );

    for (const body of this.bodies) {
      const t = body.translation();
      const offset = this.offset.set(t.x - position.x, t.y - position.y, t.z - position.z);
      const distance = offset.length();
      const scale = blastFalloff(distance, radius, fullRadius);
      if (scale <= 0) continue;
      if (distance < 1e-3) offset.set(0, 1, 0);
      offset.normalize();
      offset.y += IMPULSE_LIFT;
      offset.normalize().multiplyScalar(config.grenade.impulse * scale * body.mass());
      body.applyImpulse(offset, true);
    }
  }

  /** Find the surface just below the blast for a scorch mark. */
  private findGround(position: Vector3): boolean {
    const maxHeight = config.explosion.scorchMaxHeight;
    // Start slightly above in case the blast center sits right on the surface.
    this.downRay.origin = { x: position.x, y: position.y + 0.1, z: position.z };
    const hit = this.world.castRayAndGetNormal(
      this.downRay,
      maxHeight + 0.1,
      true,
      RAPIER.QueryFilterFlags.ONLY_FIXED,
      Groups.groundQuery,
    );
    if (!hit || hit.normal.y < 0.5) return false;
    this.groundPoint.set(position.x, position.y + 0.1 - hit.timeOfImpact, position.z);
    this.groundNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    return true;
  }
}
