import RAPIER from '@dimforge/rapier3d-compat';
import { Mesh, MeshLambertMaterial, Object3D, Vector3, type BufferGeometry, type Scene } from 'three';
import { PropMaterials } from '../world/PropMaterials';
import { config } from '../core/config';
import type { Cell } from '../world/BuildGrid';
import { tagSurface, untagSurfaces } from '../world/Surfaces';
import { mgGunView } from './MgGunAsset';
import { createMgNestBaseGeometry, createMgNestGeometry, MG_HUB, mgNestColliderBoxes, NEST, NEST_WALL_HEIGHT } from './MgNestModel';
import { distanceToGroundBox, Structure, type StructureDamageHandler } from './Structure';

let sharedGeometry: BufferGeometry | null = null;
let sharedBase: BufferGeometry | null = null;

/** The whole nest in one piece, for the build ghost. Built once. */
export function mgNestGeometry(): BufferGeometry {
  sharedGeometry ??= createMgNestGeometry(mgGunView().geometry);
  return sharedGeometry;
}

/** The static base, shared by every built nest. Built once. */
function mgNestBase(): BufferGeometry {
  sharedBase ??= createMgNestBaseGeometry();
  return sharedBase;
}

/**
 * The machine gun nest: a sandbag ring with a tripod-mounted gun on a 2 x 2 cell footprint. The gun is its
 * own mesh, turning on the tripod hub, so a mounted player can swing it (see `player/MgMount.ts`).
 * HP and destruction are handled by the StructureManager.
 */
export class MgNest extends Structure {
  readonly type = 'mgNest';
  /** The sandbag square, tall enough to take in the gun. */
  readonly size = new Vector3((NEST.ring + NEST.bagDepth / 2) * 2, NEST.gunHeight + 0.15, (NEST.ring + NEST.bagDepth / 2) * 2);
  /** The turning gun. Its origin is the tripod hub; rotation.y turns it from the nest's facing, rotation.x tips the barrel up. */
  readonly gun: Object3D;
  private readonly mesh: Mesh<BufferGeometry, MeshLambertMaterial>;

  constructor(
    id: number,
    cells: readonly Cell[],
    base: Vector3,
    yaw: number,
    scene: Scene,
    world: RAPIER.World,
    onDamage: StructureDamageHandler,
  ) {
    super(id, cells, base, yaw, config.structures.mgNest.hp, NEST_WALL_HEIGHT / 2, onDamage);

    // Burlap sandbags; the material is the nest's own, the texture is shared.
    const material = new MeshLambertMaterial({ vertexColors: true, map: PropMaterials.burlap().map });
    this.mesh = new Mesh(mgNestBase(), material);
    this.mesh.name = 'mgNest';
    this.mesh.position.copy(base);
    this.mesh.rotation.y = yaw;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // The machine gun model, turning on the tripod hub. Its material is shared by every nest.
    const view = mgGunView();
    const gun = new Mesh(view.geometry, view.material);
    gun.name = 'mgNestGun';
    gun.position.set(MG_HUB.x, MG_HUB.y, MG_HUB.z);
    gun.rotation.order = 'YXZ';
    gun.castShadow = true;
    gun.receiveShadow = true;
    this.gun = gun;
    this.mesh.add(gun);
    scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);

    const half = yaw / 2;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(base.x, base.y, base.z)
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
    );
    for (const [hx, hy, hz, x, y, z] of mgNestColliderBoxes()) {
      // Sandbags.
      this.colliders.push(tagSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z), body), 'sand'));
    }
  }

  /** The rigid body holding every collider of the nest, so the nest's own gun can shoot past them. */
  get body(): RAPIER.RigidBody | null {
    return this.colliders[0]?.parent() ?? null;
  }

  /** Turn the gun: `yaw` from the nest's facing (positive left) and `pitch` (positive up), in radians. */
  aimGun(yaw: number, pitch: number): void {
    this.gun.rotation.set(pitch, yaw, 0);
    this.gun.updateMatrixWorld(true);
  }

  /** The tripod hub in the world. */
  hubPosition(out: Vector3): Vector3 {
    return out.set(MG_HUB.x, MG_HUB.y, MG_HUB.z).applyMatrix4(this.mesh.matrixWorld);
  }

  /** The barrel tip in the world, where the gun is pointing now. */
  muzzlePosition(out: Vector3): Vector3 {
    return this.gun.localToWorld(out.copy(mgGunView().muzzle));
  }

  /** A point in the nest's own frame (gun facing -Z) taken to the world. */
  toWorld(local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).applyMatrix4(this.mesh.matrixWorld);
  }

  /** A world point in the nest's own frame (gun facing -Z). */
  toLocal(world: Vector3, out: Vector3): Vector3 {
    return this.mesh.worldToLocal(out.copy(world));
  }

  override get impactSurface(): 'sand' {
    return 'sand';
  }

  blastDistance(point: Vector3): number {
    const outer = NEST.ring + NEST.bagDepth / 2;
    return distanceToGroundBox(point, this.base, this.yaw, outer, NEST_WALL_HEIGHT, outer);
  }

  dispose(world: RAPIER.World): void {
    this.mesh.removeFromParent();
    this.mesh.material.dispose();
    const body = this.colliders[0]?.parent();
    if (!body) return;
    untagSurfaces(body);
    world.removeRigidBody(body);
  }
}
