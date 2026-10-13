import { Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, type BufferGeometry, type Scene, type Vector3 } from 'three';
import { config } from '../core/config';
import { mgNestGeometry } from './MgNest';
import { weaponCrateGhostGeometry } from './WeaponCrate';
import { yawOfTurns } from './WallGeometry';
import { wallArmGeometries, wallSegmentGeometry, type WallEnd } from './WallRenderer';

const VALID = 0x55d45a;
const INVALID = 0xff4433;
const BODY_OPACITY = 0.42;
const FOOTPRINT_OPACITY = 0.28;
/** Lift for the footprint so it never fights the ground for depth. */
const FOOTPRINT_LIFT = 0.03;

function ghostMaterial(opacity: number): MeshBasicMaterial {
  // Pulled toward the camera in depth so where it lies exactly on a built wall (aiming at a taken edge)
  // it tints that wall cleanly instead of flickering against it.
  return new MeshBasicMaterial({
    color: VALID,
    transparent: true,
    opacity,
    depthWrite: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
}

/** Told when the wall preview appears or goes, so built walls can shape their ends to meet it. */
export type GhostWallListener = (shown: boolean) => void;

/**
 * See-through preview of what is about to be built, green when it can go there, red when not.
 * A wall shows exactly as it will be built: its middle plus its two ends, shaped for the walls they will
 * join (an open end, a straight join, its half of a corner, its part of a T or cross). It is the same
 * size as the built wall and never covers a neighbour. The MG nest and the weapon crate show with their grid footprints.
 */
export class BuildGhost {
  private readonly bodyMaterial = ghostMaterial(BODY_OPACITY);
  private readonly footprintMaterial = ghostMaterial(FOOTPRINT_OPACITY);
  private readonly segment: Mesh;
  private readonly arms: [Mesh, Mesh];
  private readonly nest = new Object3D();
  private readonly crate = new Object3D();
  private wallShown = false;

  constructor(
    scene: Scene,
    private readonly onWall: GhostWallListener,
  ) {
    this.segment = this.mesh(wallSegmentGeometry());
    this.arms = [this.mesh(wallArmGeometries()[0]), this.mesh(wallArmGeometries()[0])];
    const wallRoot = new Object3D();
    wallRoot.add(this.segment, ...this.arms);
    wallRoot.name = 'buildGhostWall';

    this.nest.add(this.mesh(mgNestGeometry()), this.footprint(config.build.cellSize * 2, config.build.cellSize * 2));
    this.nest.name = 'buildGhostNest';
    this.crate.add(this.mesh(weaponCrateGhostGeometry()), this.footprint(config.build.cellSize, config.build.cellSize));
    this.crate.name = 'buildGhostWeaponCrate';

    this.hideMeshes();
    scene.add(wallRoot, this.nest, this.crate);
  }

  /** A wall on the edge whose middle is `base`, with its two ends as `ends` describe. */
  showWall(base: Vector3, yaw: number, ends: readonly [WallEnd, WallEnd], valid: boolean): void {
    this.hideMeshes();
    this.setValid(valid);
    this.segment.position.copy(base);
    this.segment.rotation.y = yaw;
    this.segment.visible = true;
    ends.forEach((end, k) => {
      const mesh = this.arms[k];
      mesh.geometry = wallArmGeometries()[end.shape];
      mesh.position.set(end.x, 0, end.z);
      mesh.rotation.y = yawOfTurns(end.dir);
      mesh.visible = true;
    });
    this.wallShown = true;
    this.onWall(true);
  }

  showNest(base: Vector3, yaw: number, valid: boolean): void {
    this.hide();
    this.setValid(valid);
    this.nest.position.copy(base);
    this.nest.rotation.y = yaw;
    this.nest.visible = true;
  }

  showWeaponCrate(base: Vector3, yaw: number, valid: boolean): void {
    this.hide();
    this.setValid(valid);
    this.crate.position.copy(base);
    this.crate.rotation.y = yaw;
    this.crate.visible = true;
  }

  hide(): void {
    this.hideMeshes();
    if (!this.wallShown) return;
    this.wallShown = false;
    this.onWall(false);
  }

  private hideMeshes(): void {
    this.segment.visible = false;
    for (const arm of this.arms) arm.visible = false;
    this.nest.visible = false;
    this.crate.visible = false;
  }

  private setValid(valid: boolean): void {
    const color = valid ? VALID : INVALID;
    this.bodyMaterial.color.setHex(color);
    this.footprintMaterial.color.setHex(color);
  }

  private mesh(geometry: BufferGeometry): Mesh {
    const mesh = new Mesh(geometry, this.bodyMaterial);
    mesh.renderOrder = 2;
    return mesh;
  }

  private footprint(width: number, depth: number): Mesh {
    const plane = new PlaneGeometry(width, depth);
    plane.rotateX(-Math.PI / 2);
    const mesh = new Mesh(plane, this.footprintMaterial);
    mesh.position.y = FOOTPRINT_LIFT;
    mesh.renderOrder = 1;
    return mesh;
  }
}
