import { InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry, type Material, type Scene } from 'three';
import { config } from '../core/config';
import { DAMAGE_VARIANTS, DamageState } from '../destruction/DamageState';
import { damagedSegmentGeometry } from '../destruction/WallDamageGeometry';
import { damageTileOf } from '../destruction/WallDamageTextures';
import { Dir, type Edge } from '../world/BuildGrid';
import { ARM_SHAPE_COUNT, armShapeOf, createArmGeometry, createSegmentGeometry, yawOfTurns } from './WallGeometry';
import { createWallMaterial, WALL_DAMAGE_ATTRIBUTE, WALL_WEAR_ATTRIBUTE, wearOf } from './WallMaterial';

const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);
const HALF_CELL = config.build.cellSize / 2;

let segment: BufferGeometry | null = null;
let arms: BufferGeometry[] | null = null;

/** The wall segment geometry, built once and shared with the build ghost. */
export function wallSegmentGeometry(): BufferGeometry {
  segment ??= createSegmentGeometry();
  return segment;
}

/** One arm geometry per arm shape, built once and shared with the build ghost. */
export function wallArmGeometries(): readonly BufferGeometry[] {
  arms ??= Array.from({ length: ARM_SHAPE_COUNT }, (_, shape) => createArmGeometry(shape));
  return arms;
}

export interface WallPose {
  readonly edge: Readonly<Edge>;
  readonly base: Vector3;
  readonly yaw: number;
}

/** A built wall: where it stands and how broken it looks. Collapsed walls are not drawn. */
export interface WallLook extends WallPose {
  readonly damageState: DamageState;
  /** Which of the state's layouts it shows. */
  readonly damageVariant: number;
}

/** Segment meshes: intact first, then each damaged variant, then each breached one. */
const SEGMENT_LOOKS = 1 + DAMAGE_VARIANTS * 2;

function segmentLookOf(state: DamageState, variant: number): number {
  if (state === DamageState.DAMAGED) return 1 + variant;
  if (state === DamageState.BREACHED) return 1 + DAMAGE_VARIANTS + variant;
  return 0;
}

function segmentGeometryOf(look: number): BufferGeometry {
  if (look === 0) return wallSegmentGeometry();
  const breached = look > DAMAGE_VARIANTS;
  return damagedSegmentGeometry(breached ? DamageState.BREACHED : DamageState.DAMAGED, (look - 1) % DAMAGE_VARIANTS);
}

/** The directions (bits: +x, +z, -x, -z) that walls leave grid point (i, j) in. */
export type WallMaskLookup = (i: number, j: number) => number;

/** Where one end of a wall sits, which way it points into the wall, and its arm shape. */
export interface WallEnd {
  x: number;
  z: number;
  dir: number;
  shape: number;
}

/**
 * The two ends of the wall on `edge`, whose middle is `base`, given the walls at each grid point.
 * Writes into `out` and returns it.
 */
export function wallEnds(edge: Readonly<Edge>, base: Vector3, maskAt: WallMaskLookup, out: [WallEnd, WallEnd]): [WallEnd, WallEnd] {
  const alongX = edge.axis === 'x';
  const [near, far] = out;
  near.dir = alongX ? Dir.PX : Dir.PZ;
  near.x = base.x - (alongX ? HALF_CELL : 0);
  near.z = base.z - (alongX ? 0 : HALF_CELL);
  near.shape = armShapeOf(maskAt(edge.i, edge.j), near.dir);
  far.dir = alongX ? Dir.NX : Dir.NZ;
  far.x = base.x + (alongX ? HALF_CELL : 0);
  far.z = base.z + (alongX ? 0 : HALF_CELL);
  far.shape = armShapeOf(maskAt(edge.i + (alongX ? 1 : 0), edge.j + (alongX ? 0 : 1)), far.dir);
  return out;
}

/**
 * Draws every wall: one instanced mesh for the middle segments of each damage look (intact, and each
 * damaged and breached variant) and one per arm shape for the ends. Arms keep their shape whatever the
 * damage, so joints always meet; they carry the wall's damage overlay instead. Each wall carries its own
 * wear overlays on both faces. Walls change only when the player builds, something breaks or is repaired
 * (or the build preview moves), so each change rebuilds the instance lists.
 */
export class WallRenderer {
  private readonly segments: InstancedMesh[];
  private readonly arms: InstancedMesh[];
  private readonly ends: [WallEnd, WallEnd] = [
    { x: 0, z: 0, dir: 0, shape: 0 },
    { x: 0, z: 0, dir: 0, shape: 0 },
  ];
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();

  constructor(scene: Scene) {
    const material = createWallMaterial();
    const capacity = config.build.maxWalls;
    this.segments = Array.from({ length: SEGMENT_LOOKS }, (_, look) =>
      this.instanced(scene, segmentGeometryOf(look), material, capacity, `wallSegments-${look}`),
    );
    // Every wall has two ends, and both could have the same shape.
    this.arms = wallArmGeometries().map((geometry, shape) => this.instanced(scene, geometry, material, capacity * 2, `wallArms-${shape}`));
  }

  rebuild(walls: Iterable<WallLook>, maskAt: WallMaskLookup): void {
    const segmentCounts = new Array<number>(SEGMENT_LOOKS).fill(0);
    const counts = new Array<number>(ARM_SHAPE_COUNT).fill(0);
    for (const wall of walls) {
      if (wall.damageState === DamageState.COLLAPSED) continue;
      const [front, back] = wearOf(wall.edge);
      const [damageFront, damageBack] = this.damageTiles(wall);
      const look = segmentLookOf(wall.damageState, wall.damageVariant);
      const segments = this.segments[look];
      const n = segmentCounts[look]++;
      this.rotation.setFromAxisAngle(UP, wall.yaw);
      segments.setMatrixAt(n, this.matrix.compose(wall.base, this.rotation, ONE));
      this.setWear(segments, n, front, back, 0);
      this.setDamage(segments, n, damageFront, damageBack, 1);

      wallEnds(wall.edge, wall.base, maskAt, this.ends).forEach((end, k) => {
        const mesh = this.arms[end.shape];
        const index = counts[end.shape]++;
        this.rotation.setFromAxisAngle(UP, yawOfTurns(end.dir));
        this.position.set(end.x, 0, end.z);
        mesh.setMatrixAt(index, this.matrix.compose(this.position, this.rotation, ONE));
        // The far arm is turned half round from the segment, so its faces are the other way about.
        if (k === 0) this.setWear(mesh, index, front, back, HALF_CELL);
        else this.setWear(mesh, index, back, front, HALF_CELL);
        this.setDamage(mesh, index, damageFront, damageBack, k === 0 ? 1 : -1);
      });
    }
    this.segments.forEach((mesh, look) => this.finish(mesh, segmentCounts[look]));
    this.arms.forEach((mesh, shape) => this.finish(mesh, counts[shape]));
  }

  private setWear(mesh: InstancedMesh, index: number, front: number, back: number, toMiddle: number): void {
    (mesh.geometry.getAttribute(WALL_WEAR_ATTRIBUTE) as InstancedBufferAttribute).setXYZ(index, front, back, toMiddle);
  }

  /** The damage overlay tiles on a wall's +z and -z faces, -1 while intact. */
  private damageTiles(wall: WallLook): [number, number] {
    const state = wall.damageState;
    if (state !== DamageState.DAMAGED && state !== DamageState.BREACHED) return [-1, -1];
    return [damageTileOf(state, wall.damageVariant, 0), damageTileOf(state, wall.damageVariant, 1)];
  }

  private setDamage(mesh: InstancedMesh, index: number, front: number, back: number, sign: number): void {
    (mesh.geometry.getAttribute(WALL_DAMAGE_ATTRIBUTE) as InstancedBufferAttribute).setXYZ(index, front, back, sign);
  }

  private instanced(scene: Scene, shared: BufferGeometry, material: Material, capacity: number, name: string): InstancedMesh {
    // A copy, since the per-instance wear attribute belongs to this mesh alone.
    const geometry = shared.clone();
    geometry.setAttribute(WALL_WEAR_ATTRIBUTE, new InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute(WALL_DAMAGE_ATTRIBUTE, new InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Instances are spread over the whole build area; one draw call each is cheaper than keeping bounds current.
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
  }

  private finish(mesh: InstancedMesh, count: number): void {
    mesh.count = count;
    // Most looks are unused most of the time; skip their draw calls (and shadow passes) entirely.
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.getAttribute(WALL_WEAR_ATTRIBUTE).needsUpdate = true;
    mesh.geometry.getAttribute(WALL_DAMAGE_ATTRIBUTE).needsUpdate = true;
  }
}
