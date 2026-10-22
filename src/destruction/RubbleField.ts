import RAPIER from '@dimforge/rapier3d-compat';
import { InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type BufferGeometry, type Scene } from 'three';
import { config } from '../core/config';
import type { Cell, Edge } from '../world/BuildGrid';
import { tagSurface, untagSurfaces } from '../world/Surfaces';
import { DAMAGE_VARIANTS } from './DamageState';
import { createNestRubbleGeometry, createWallRubbleGeometry, nestRubbleHull, wallRubbleHull } from './RubbleGeometry';

/** Sandbag pile looks for the MG nest. */
const NEST_VARIANTS = 2;
/** Sandbag piles drawn per look. Only one nest stands at a time, so only a few piles ever lie around. */
const NEST_CAPACITY = 16;
const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);

export interface RubblePile {
  readonly id: number;
  readonly kind: 'wall' | 'nest';
  /** The edge a wall's pile lies on. */
  readonly edge: Readonly<Edge> | null;
  /** The cells a nest's pile covers. */
  readonly cells: readonly Cell[];
  /** Middle of the pile on the ground. */
  readonly base: Vector3;
  readonly yaw: number;
  readonly variant: number;
  readonly collider: RAPIER.Collider;
  /** Id of the structure that collapsed into it. */
  readonly structureId: number;
}

/**
 * Rubble left where structures collapsed. Piles stay on the field across waves until a wall is built on
 * the same edge or the player clears them in the build phase. Each pile has a low, sloped collider the
 * player can walk over or crouch behind; nothing else about it is solid. Drawn with one instanced mesh
 * per pile look, rebuilt whenever a pile comes or goes. Knows nothing of the grid: the StructureManager
 * keeps the grid in step.
 */
export class RubbleField {
  private readonly piles = new Map<number, RubblePile>();
  private readonly byCollider = new Map<number, RubblePile>();
  private readonly wallMeshes: InstancedMesh[];
  private readonly nestMeshes: InstancedMesh[];
  private readonly wallHull = wallRubbleHull();
  private readonly nestHull = nestRubbleHull();
  private nextId = 1;
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();

  constructor(
    scene: Scene,
    private readonly world: RAPIER.World,
  ) {
    const material = new MeshLambertMaterial({ vertexColors: true });
    const capacity = config.destruction.rubble.maxPiles;
    this.wallMeshes = Array.from({ length: DAMAGE_VARIANTS }, (_, v) => this.instanced(scene, createWallRubbleGeometry(v), material, capacity, `rubbleWall-${v}`));
    this.nestMeshes = Array.from({ length: NEST_VARIANTS }, (_, v) => this.instanced(scene, createNestRubbleGeometry(v), material, NEST_CAPACITY, `rubbleNest-${v}`));
  }

  get count(): number {
    return this.piles.size;
  }

  /** The oldest pile, which goes first once the field is full. */
  get oldest(): RubblePile | undefined {
    return this.piles.values().next().value;
  }

  ofCollider(collider: RAPIER.Collider): RubblePile | undefined {
    return this.byCollider.get(collider.handle);
  }

  /** The pile lying on a wall edge, if any. */
  atEdge(edge: Readonly<Edge>): RubblePile | undefined {
    for (const pile of this.piles.values()) {
      const e = pile.edge;
      if (e && e.axis === edge.axis && e.i === edge.i && e.j === edge.j) return pile;
    }
    return undefined;
  }

  /** The pile left by structure `structureId`, if it is still there. */
  ofStructure(structureId: number): RubblePile | undefined {
    for (const pile of this.piles.values()) if (pile.structureId === structureId) return pile;
    return undefined;
  }

  /** A wall's pile along `edge`, centered on `base`. `structureId` (the wall's) picks its look. */
  addWall(edge: Readonly<Edge>, base: Vector3, yaw: number, structureId: number): RubblePile {
    return this.add('wall', { ...edge }, [], base, yaw, structureId, structureId % DAMAGE_VARIANTS, this.wallHull, 'concrete');
  }

  /** The MG nest's sandbag pile over its cells. */
  addNest(cells: readonly Cell[], base: Vector3, yaw: number, structureId: number): RubblePile {
    return this.add('nest', null, cells.map((c) => ({ ...c })), base, yaw, structureId, structureId % NEST_VARIANTS, this.nestHull, 'sand');
  }

  remove(pile: RubblePile): void {
    if (!this.piles.delete(pile.id)) return;
    this.byCollider.delete(pile.collider.handle);
    const body = pile.collider.parent();
    if (body) {
      untagSurfaces(body);
      this.world.removeRigidBody(body);
    }
    this.redraw();
  }

  private add(
    kind: RubblePile['kind'],
    edge: Edge | null,
    cells: Cell[],
    base: Vector3,
    yaw: number,
    structureId: number,
    variant: number,
    hull: Float32Array,
    surface: 'concrete' | 'sand',
  ): RubblePile {
    const half = yaw / 2;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(base.x, base.y, base.z)
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
    );
    const desc = RAPIER.ColliderDesc.convexHull(hull);
    if (!desc) throw new Error('Rubble collider hull failed');
    const collider = tagSurface(this.world.createCollider(desc, body), surface);
    const pile: RubblePile = { id: this.nextId++, kind, edge, cells, base: base.clone(), yaw, variant, collider, structureId };
    this.piles.set(pile.id, pile);
    this.byCollider.set(collider.handle, pile);
    this.redraw();
    return pile;
  }

  private redraw(): void {
    const wallCounts = new Array<number>(this.wallMeshes.length).fill(0);
    const nestCounts = new Array<number>(this.nestMeshes.length).fill(0);
    for (const pile of this.piles.values()) {
      const meshes = pile.kind === 'wall' ? this.wallMeshes : this.nestMeshes;
      const counts = pile.kind === 'wall' ? wallCounts : nestCounts;
      const mesh = meshes[pile.variant];
      if (counts[pile.variant] >= mesh.instanceMatrix.count) continue;
      this.rotation.setFromAxisAngle(UP, pile.yaw);
      mesh.setMatrixAt(counts[pile.variant]++, this.matrix.compose(pile.base, this.rotation, ONE));
    }
    const finish = (mesh: InstancedMesh, count: number): void => {
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
    };
    this.wallMeshes.forEach((mesh, v) => finish(mesh, wallCounts[v]));
    this.nestMeshes.forEach((mesh, v) => finish(mesh, nestCounts[v]));
  }

  private instanced(scene: Scene, geometry: BufferGeometry, material: MeshLambertMaterial, capacity: number, name: string): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }
}
