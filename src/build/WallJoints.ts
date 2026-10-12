import RAPIER from '@dimforge/rapier3d-compat';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { BuildGrid, Cell } from '../world/BuildGrid';
import { tagSurface, untagSurfaces } from '../world/Surfaces';
import { JOINT_RADIUS, jointShapeOf } from './WallGeometry';

const w = config.structures.wall;

/** Called when a joint collider appears or goes, so hits on it count against one of the walls that meet there. */
export interface JointColliderHooks {
  attach(collider: RAPIER.Collider, wallId: number): void;
  detach(collider: RAPIER.Collider): void;
}

/**
 * Joint colliders: where the wall segments' own colliders leave a grid point's corner open (corners,
 * T-junctions, crosses), a collider for the center of the upright and the lip slab around it.
 */
export class WallJoints {
  private readonly bodies = new Map<number, RAPIER.RigidBody>();
  private readonly ids: number[] = [];

  constructor(
    private readonly world: RAPIER.World,
    private readonly grid: BuildGrid,
    private readonly hooks: JointColliderHooks,
  ) {}

  /** Re-read the grid at these grid points after a wall was added or removed there. */
  refresh(points: readonly Cell[]): void {
    for (const { i, j } of points) {
      const key = this.key(i, j);
      this.removeCollider(key);
      const mask = this.grid.wallMaskAt(i, j);
      const shape = jointShapeOf(mask)?.shape;
      // No walls, an open end or a straight run: the segments' own colliders already reach the grid point.
      if (shape === undefined || shape === 'end' || shape === 'straight') continue;
      this.addCollider(key, this.grid.vertexX(i), this.grid.vertexZ(j), this.ownerAt(i, j));
    }
  }

  private addCollider(key: number, x: number, z: number, wallId: number): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, z));
    const t = w.thickness / 2;
    const core = this.world.createCollider(RAPIER.ColliderDesc.cuboid(t, w.height / 2, t).setTranslation(0, w.height / 2, 0), body);
    const lips = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(JOINT_RADIUS, w.lipHeight / 2, JOINT_RADIUS)
        .setTranslation(0, w.lipHeight / 2, 0)
        .setCollisionGroups(Groups.wallLip),
      body,
    );
    const step = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(JOINT_RADIUS, w.playerStepHeight / 2, JOINT_RADIUS)
        .setTranslation(0, w.playerStepHeight / 2, 0)
        .setCollisionGroups(Groups.playerStep),
      body,
    );
    this.bodies.set(key, body);
    for (const collider of [core, lips, step]) {
      tagSurface(collider, 'concrete');
      this.hooks.attach(collider, wallId);
    }
  }

  private removeCollider(key: number): void {
    const body = this.bodies.get(key);
    if (!body) return;
    for (let k = 0; k < body.numColliders(); k++) this.hooks.detach(body.collider(k));
    untagSurfaces(body);
    this.world.removeRigidBody(body);
    this.bodies.delete(key);
  }

  /** The lowest wall id meeting at a grid point: hits on the joint damage that wall. */
  private ownerAt(i: number, j: number): number {
    let owner = 0;
    for (const id of this.grid.wallsAt(i, j, this.ids)) if (id !== 0 && (owner === 0 || id < owner)) owner = id;
    return owner;
  }

  private key(i: number, j: number): number {
    return j * (this.grid.columns + 1) + i;
  }
}
