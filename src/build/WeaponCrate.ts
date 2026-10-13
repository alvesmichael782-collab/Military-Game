import RAPIER from '@dimforge/rapier3d-compat';
import { BoxGeometry, Object3D, Vector3, type BufferGeometry, type Scene } from 'three';
import { config } from '../core/config';
import type { Cell } from '../world/BuildGrid';
import { PropBuilder } from '../world/PropBuilder';
import { PropMaterials } from '../world/PropMaterials';
import { tagSurface, untagSurfaces } from '../world/Surfaces';
import { distanceToGroundBox, Structure } from './Structure';

/** Size of the crate, in meters: long side across its facing. Fits well inside one 2 m cell, clear of walls on its edges. */
export const WEAPON_CRATE_SIZE = { x: 1.15, y: 0.72, z: 0.72 } as const;

let ghostGeometry: BufferGeometry | null = null;

/** The crate's outline for the build ghost. Built once. */
export function weaponCrateGhostGeometry(): BufferGeometry {
  const s = WEAPON_CRATE_SIZE;
  ghostGeometry ??= new BoxGeometry(s.x, s.y, s.z).translate(0, s.y / 2, 0);
  return ghostGeometry;
}

/**
 * The weapon crate: an olive military crate stenciled "ARMS" on a single grid cell. A temporary shop (see
 * economy/WeaponShop.ts), so it cannot be damaged: it never joins the damageable registry, bullets and blasts
 * pass it by as plain scenery. Blocks its cell for building and for enemy routes. F removes it like any structure.
 */
export class WeaponCrate extends Structure {
  readonly type = 'weaponCrate';
  override readonly damageable = false;
  readonly size = new Vector3(WEAPON_CRATE_SIZE.x, WEAPON_CRATE_SIZE.y, WEAPON_CRATE_SIZE.z);
  private readonly object: Object3D;

  constructor(id: number, cell: Cell, base: Vector3, yaw: number, scene: Scene, world: RAPIER.World) {
    super(id, [cell], base, yaw, 1, WEAPON_CRATE_SIZE.y / 2, () => {});
    this.object = createWeaponCrateModel();
    this.object.position.copy(base);
    this.object.rotation.y = yaw;
    scene.add(this.object);

    const s = WEAPON_CRATE_SIZE;
    const half = yaw / 2;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(base.x, s.y / 2, base.z)
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
    );
    this.colliders.push(tagSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2), body), 'wood'));
  }

  override get impactSurface(): 'hard' {
    return 'hard';
  }

  /** Where the floating weapon turns above the crate. */
  displayPoint(out: Vector3): Vector3 {
    return out.set(this.base.x, config.weaponCrate.displayHeight, this.base.z);
  }

  blastDistance(point: Vector3): number {
    const s = WEAPON_CRATE_SIZE;
    return distanceToGroundBox(point, this.base, this.yaw, s.x / 2, s.y, s.z / 2);
  }

  dispose(world: RAPIER.World): void {
    this.object.removeFromParent();
    const body = this.colliders[0]?.parent();
    if (!body) return;
    untagSurfaces(body);
    world.removeRigidBody(body);
  }
}

/**
 * An olive-painted plank crate with "ARMS" stenciled on every side, dark steel corner bands, a lid with a raised
 * rim and two latches on the front, and rope handles on the short ends. Long side along X, front toward -Z.
 */
function createWeaponCrateModel(): Object3D {
  const object = new Object3D();
  object.name = 'weaponCrate';
  const s = WEAPON_CRATE_SIZE;
  const metal = PropMaterials.darkMetal();
  const b = new PropBuilder().at(0, 0, 0);
  const lid = 0.08;
  b.box(PropMaterials.armsCrate(), s.x, s.y - lid, s.z, 0, (s.y - lid) / 2, 0, { uv: 'native' });
  // The lid: a little proud of the box all round, darker where it overhangs.
  b.box(PropMaterials.armsCrate(), s.x + 0.03, lid, s.z + 0.03, 0, s.y - lid / 2, 0, { uv: 'native', tint: 0.82, ao: false });
  const band = 0.08;
  const t = 0.012;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(metal, band, s.y - lid, t, sx * (s.x / 2 - band / 2 + t), (s.y - lid) / 2, sz * (s.z / 2 + t / 2), { tint: 0.8 });
      b.box(metal, t, s.y - lid, band, sx * (s.x / 2 + t / 2), (s.y - lid) / 2, sz * (s.z / 2 - band / 2 + t), { tint: 0.8 });
    }
  }
  // Two latches under the lid on the front and back.
  for (const sz of [-1, 1]) {
    for (const x of [-s.x * 0.28, s.x * 0.28]) b.box(metal, 0.07, 0.09, t * 1.5, x, s.y - lid - 0.03, sz * (s.z / 2 + t), { tint: 0.7, ao: false });
  }
  // Rope handles on the short ends.
  for (const sx of [-1, 1]) b.box(PropMaterials.burlap(), t * 2, 0.045, 0.26, sx * (s.x / 2 + t), s.y * 0.6, 0, { tint: [0.75, 0.66, 0.5], ao: false });
  b.buildMeshes(object, 'weaponCrate');
  return object;
}
