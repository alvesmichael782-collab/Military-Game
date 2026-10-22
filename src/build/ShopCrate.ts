import RAPIER from '@dimforge/rapier3d-compat';
import { BoxGeometry, Object3D, Vector3, type BufferGeometry, type Scene } from 'three';
import type { Cell } from '../world/BuildGrid';
import { PropBuilder } from '../world/PropBuilder';
import { PropMaterials } from '../world/PropMaterials';
import { tagSurface, untagSurfaces } from '../world/Surfaces';
import { distanceToGroundBox, Structure } from './Structure';

/** The crates that open a shop menu (see economy/CrateShop.ts). */
export type ShopCrateType = 'weaponCrate' | 'consumablesCrate';

interface Size {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Size of each crate, in meters: long side across its facing. Both fit well inside one 2 m cell, clear of walls on
 * its edges.
 */
export const SHOP_CRATE_SIZES: Readonly<Record<ShopCrateType, Size>> = {
  weaponCrate: { x: 1.15, y: 0.72, z: 0.72 },
  consumablesCrate: { x: 1.15, y: 0.85, z: 0.85 },
};

const ghostGeometries = new Map<ShopCrateType, BufferGeometry>();

/** The crate's outline for the build ghost. Built once per type. */
export function shopCrateGhostGeometry(type: ShopCrateType): BufferGeometry {
  let geometry = ghostGeometries.get(type);
  if (!geometry) {
    const s = SHOP_CRATE_SIZES[type];
    geometry = new BoxGeometry(s.x, s.y, s.z).translate(0, s.y / 2, 0);
    ghostGeometries.set(type, geometry);
  }
  return geometry;
}

/**
 * A shop crate on a single grid cell: the olive weapon crate stenciled "ARMS", or the bare wood consumables crate
 * stenciled "SUPPLY". Temporary shops, so they cannot be damaged: they never join the damageable registry, bullets
 * and blasts pass them by as plain scenery. Each blocks its cell for building and for enemy routes. F removes it
 * like any structure.
 */
export class ShopCrate extends Structure {
  override readonly damageable = false;
  readonly size: Vector3;
  private readonly object: Object3D;

  constructor(
    readonly type: ShopCrateType,
    id: number,
    cell: Cell,
    base: Vector3,
    yaw: number,
    scene: Scene,
    world: RAPIER.World,
  ) {
    const s = SHOP_CRATE_SIZES[type];
    super(id, [cell], base, yaw, 1, s.y / 2, () => {});
    this.size = new Vector3(s.x, s.y, s.z);
    this.object = type === 'weaponCrate' ? createWeaponCrateModel(s) : createConsumablesCrateModel(s);
    this.object.position.copy(base);
    this.object.rotation.y = yaw;
    scene.add(this.object);

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

  blastDistance(point: Vector3): number {
    const s = SHOP_CRATE_SIZES[this.type];
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

/** Steel L-bands down the four vertical corners of a box `s` wide and `height` tall. */
function cornerBands(b: PropBuilder, s: Size, height: number, band: number, t: number): void {
  const metal = PropMaterials.darkMetal();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(metal, band, height, t, sx * (s.x / 2 - band / 2 + t), height / 2, sz * (s.z / 2 + t / 2), { tint: 0.8 });
      b.box(metal, t, height, band, sx * (s.x / 2 + t / 2), height / 2, sz * (s.z / 2 - band / 2 + t), { tint: 0.8 });
    }
  }
}

/** Rope handles on the short ends, at `y`. */
function ropeHandles(b: PropBuilder, s: Size, y: number, length: number, t: number): void {
  for (const sx of [-1, 1]) b.box(PropMaterials.burlap(), t * 2, 0.045, length, sx * (s.x / 2 + t), y, 0, { tint: [0.75, 0.66, 0.5], ao: false });
}

/**
 * An olive-painted plank crate with "ARMS" stenciled on every side, dark steel corner bands, a lid with a raised
 * rim and two latches on the front, and rope handles on the short ends. Long side along X, front toward -Z.
 */
function createWeaponCrateModel(s: Size): Object3D {
  const object = new Object3D();
  object.name = 'weaponCrate';
  const metal = PropMaterials.darkMetal();
  const b = new PropBuilder().at(0, 0, 0);
  const lid = 0.08;
  const t = 0.012;
  b.box(PropMaterials.armsCrate(), s.x, s.y - lid, s.z, 0, (s.y - lid) / 2, 0, { uv: 'native' });
  // The lid: a little proud of the box all round, darker where it overhangs.
  b.box(PropMaterials.armsCrate(), s.x + 0.03, lid, s.z + 0.03, 0, s.y - lid / 2, 0, { uv: 'native', tint: 0.82, ao: false });
  cornerBands(b, s, s.y - lid, 0.08, t);
  // Two latches under the lid on the front and back.
  for (const sz of [-1, 1]) {
    for (const x of [-s.x * 0.28, s.x * 0.28]) b.box(metal, 0.07, 0.09, t * 1.5, x, s.y - lid - 0.03, sz * (s.z / 2 + t), { tint: 0.7, ao: false });
  }
  ropeHandles(b, s, s.y * 0.6, 0.26, t);
  b.buildMeshes(object, 'weaponCrate');
  return object;
}

/**
 * A bare wooden supply crate with "SUPPLY" stenciled on every side, steel bands down the corners and two straps
 * over the lid, and rope handles on the short ends. Long side along X.
 */
function createConsumablesCrateModel(s: Size): Object3D {
  const object = new Object3D();
  object.name = 'consumablesCrate';
  const metal = PropMaterials.darkMetal();
  const b = new PropBuilder().at(0, 0, 0);
  const t = 0.012;
  b.box(PropMaterials.supplyCrate(), s.x, s.y, s.z, 0, s.y / 2, 0, { uv: 'native' });
  cornerBands(b, s, s.y + 0.01, 0.1, t);
  // Two straps over the lid and down the long sides.
  for (const x of [-s.x * 0.3, s.x * 0.3]) {
    b.box(metal, 0.07, t, s.z + 2 * t, x, s.y + t / 2, 0, { tint: 0.7, ao: false });
    for (const sz of [-1, 1]) b.box(metal, 0.07, s.y, t, x, s.y / 2, sz * (s.z / 2 + t / 2), { tint: 0.7 });
  }
  ropeHandles(b, s, s.y * 0.72, 0.28, t);
  b.buildMeshes(object, 'consumablesCrate');
  return object;
}
