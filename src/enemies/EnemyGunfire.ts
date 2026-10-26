import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Vector3 } from 'three';
import { applyDamage } from '../combat/Damage';
import { Groups } from '../core/CollisionGroups';
import type { ImpactSurface } from '../core/EventBus';
import type { Enemy } from './Enemy';
import type { EnemyContext } from './EnemyContext';

const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
const right = new Vector3();
const up = new Vector3();
const end = new Vector3();
const normal = new Vector3();

/** `forward` (a unit vector) turned by a random amount inside a cone of `spreadDegrees` half-angle, into `out`. */
export function spreadDirection(forward: Vector3, spreadDegrees: number, out: Vector3): Vector3 {
  right.crossVectors(forward, up.set(0, 1, 0));
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  up.crossVectors(right, forward).normalize();
  const offset = Math.tan(MathUtils.degToRad(spreadDegrees)) * Math.sqrt(Math.random());
  const angle = Math.random() * Math.PI * 2;
  return out
    .copy(forward)
    .addScaledVector(right, Math.cos(angle) * offset)
    .addScaledVector(up, Math.sin(angle) * offset)
    .normalize();
}

/**
 * One enemy hitscan round from `eye` along the unit vector `direction`: the `enemyFired` event (tracer, flash and
 * sound from `muzzle`), then damage to the player hit (armor first; the hit comes from `eye`, and `shooter` lets
 * repeat hits share one damage indicator) or to whatever else it struck, with a bullet impact.
 */
export function fireEnemyRound(
  ctx: EnemyContext,
  shooter: Enemy,
  eye: Vector3,
  direction: Vector3,
  range: number,
  damage: number,
  muzzle: Vector3,
): void {
  ray.origin = { x: eye.x, y: eye.y, z: eye.z };
  ray.dir = { x: direction.x, y: direction.y, z: direction.z };
  const hit = ctx.world.castRayAndGetNormal(ray, range, true, undefined, Groups.enemySight);

  if (!hit) {
    end.copy(eye).addScaledVector(direction, range);
    ctx.events.emit('enemyFired', { type: shooter.type, muzzle, end });
    return;
  }
  end.copy(eye).addScaledVector(direction, hit.timeOfImpact);
  ctx.events.emit('enemyFired', { type: shooter.type, muzzle, end });

  const victim = ctx.players.find((p) => p.colliderHandle === hit.collider.handle);
  if (victim) {
    applyDamage(victim.damageable, damage, 'ballistic', eye, { source: 'enemy', attacker: shooter });
    return;
  }
  const hitbox = ctx.registry.hitboxOf(hit.collider);
  let surface: ImpactSurface;
  if (hitbox) surface = hitbox.target.impactSurface ?? 'target';
  else surface = hit.collider.shapeType() === RAPIER.ShapeType.HalfSpace ? 'dirt' : 'hard';
  normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
  ctx.events.emit('bulletImpact', { point: end, normal, surface });
  if (hitbox) applyDamage(hitbox.target, damage, 'ballistic', end, { source: 'enemy' });
}
