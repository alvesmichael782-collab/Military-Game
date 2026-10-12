import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import { DamageState, damageVariantOf } from '../destruction/DamageState';
import { solidBoxes, wallDamageLayout, wallOpenings } from '../destruction/WallDamageLayouts';
import type { Edge } from '../world/BuildGrid';
import { tagSurface, untagSurfaces } from '../world/Surfaces';
import { JOINT_RADIUS } from './WallGeometry';
import { distanceToGroundBox, Structure, type StructureDamageHandler } from './Structure';
import type { WallLook } from './WallRenderer';

const w = config.structures.wall;

/**
 * One wall segment on a grid edge: an upright with a lip on each side of its base, running from one grid
 * point to the next and turned to the edge's direction. Drawn by the WallRenderer (segment plus shared joints).
 * Its compound collider (upright and both lips) spans the full edge, so straight runs collide seamlessly;
 * corners get extra joint colliders. The player walks on low step proxies over the lips instead of the lips
 * themselves (see `Groups.wallLip`). HP and destruction are handled by the StructureManager.
 *
 * Once breached, the upright's collider is rebuilt as pieces around its holes, so bullets and grenades
 * pass through them; a player-only blocker over the whole upright still stops anyone walking through.
 */
export class WallSegment extends Structure implements WallLook {
  readonly type = 'wall';
  readonly size = new Vector3(config.build.cellSize, w.height, JOINT_RADIUS * 2);
  private _damageState: DamageState = DamageState.INTACT;

  constructor(
    id: number,
    readonly edge: Readonly<Edge>,
    base: Vector3,
    yaw: number,
    private readonly world: RAPIER.World,
    onDamage: StructureDamageHandler,
  ) {
    super(id, [], base, yaw, w.hp, w.height / 2, onDamage);
    this.buildColliders();
  }

  get damageState(): DamageState {
    return this._damageState;
  }

  /** Which of its state's layouts the wall shows, fixed by its id. */
  get damageVariant(): number {
    return damageVariantOf(this.id, this._damageState);
  }

  /** Bullets on intact plaster throw plaster dust; once it is broken they throw brick. */
  override get impactSurface(): 'plaster' | 'brick' {
    return this._damageState === DamageState.INTACT ? 'plaster' : 'brick';
  }

  /**
   * Move to a new damage state. The colliders are rebuilt when the wall becomes breached or stops being
   * breached; returns true if they were, so the manager can re-register them.
   */
  setDamageState(state: DamageState): boolean {
    const was = this._damageState;
    this._damageState = state;
    const breached = (s: DamageState): boolean => s === DamageState.BREACHED;
    if (state === DamageState.COLLAPSED || breached(was) === breached(state)) return false;
    this.removeBody();
    this.buildColliders();
    return true;
  }

  blastDistance(point: Vector3): number {
    return distanceToGroundBox(point, this.base, this.yaw, config.build.cellSize / 2, w.height, w.thickness / 2);
  }

  dispose(): void {
    this.removeBody();
  }

  private buildColliders(): void {
    const world = this.world;
    const half = this.yaw / 2;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(this.base.x, this.base.y, this.base.z)
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
    );
    const length = config.build.cellSize / 2;
    const t = w.thickness / 2;
    const lipHalf = w.lipWidth / 2;
    const colliders: RAPIER.Collider[] = [];

    if (this._damageState === DamageState.BREACHED) {
      // Solid pieces around the holes, for bullets, grenades and debris.
      const layout = wallDamageLayout(DamageState.BREACHED, this.damageVariant);
      for (const box of solidBoxes(wallOpenings(layout), -length, length, 0, w.height)) {
        const hx = (box.s1 - box.s0) / 2;
        const hy = (box.v1 - box.v0) / 2;
        colliders.push(world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, t).setTranslation(box.s0 + hx, box.v0 + hy, 0), body));
      }
      // Nobody walks or climbs through the holes until it collapses.
      colliders.push(
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(length, w.height / 2, t).setTranslation(0, w.height / 2, 0).setCollisionGroups(Groups.movementBlocker),
          body,
        ),
      );
    } else {
      colliders.push(world.createCollider(RAPIER.ColliderDesc.cuboid(length, w.height / 2, t).setTranslation(0, w.height / 2, 0), body));
    }

    for (const side of [1, -1]) {
      const z = side * (t + lipHalf);
      colliders.push(
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(length, w.lipHeight / 2, lipHalf).setTranslation(0, w.lipHeight / 2, z).setCollisionGroups(Groups.wallLip),
          body,
        ),
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(length, w.playerStepHeight / 2, lipHalf)
            .setTranslation(0, w.playerStepHeight / 2, z)
            .setCollisionGroups(Groups.playerStep),
          body,
        ),
      );
    }
    for (const collider of colliders) tagSurface(collider, 'concrete');
    this.colliders.length = 0;
    this.colliders.push(...colliders);
  }

  private removeBody(): void {
    const body = this.colliders[0]?.parent();
    this.colliders.length = 0;
    if (!body) return;
    untagSurfaces(body);
    this.world.removeRigidBody(body);
  }
}
