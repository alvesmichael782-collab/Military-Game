import type { Vector3 } from 'three';
import { config } from '../core/config';

/** A cell's column (x) and row (z). Also used for grid points (vertices): vertex (i, j) is the north-west corner of cell (i, j). */
export interface Cell {
  i: number;
  j: number;
}

/**
 * One grid edge, the line between two neighbouring grid points. Walls stand on edges.
 * An 'x' edge runs from vertex (i, j) to (i + 1, j); a 'z' edge runs from vertex (i, j) to (i, j + 1).
 */
export interface Edge {
  axis: 'x' | 'z';
  i: number;
  j: number;
}

/** Wall directions out of a grid point, as bits of a mask: +x, +z, -x, -z. Turning +90 degrees steps to the next bit. */
export const Dir = { PX: 0, PZ: 1, NX: 2, NZ: 3 } as const;

const NONE = 0;

/**
 * What stands on a grid edge, for movement. Intact, damaged and breached walls block it; open ground and
 * rubble (a collapsed wall) let anything cross.
 */
export const EdgeState = {
  OPEN: 0,
  INTACT: 1,
  DAMAGED: 2,
  BREACHED: 3,
  RUBBLE: 4,
} as const;
export type EdgeState = (typeof EdgeState)[keyof typeof EdgeState];

function blocks(state: number): boolean {
  return state === EdgeState.INTACT || state === EdgeState.DAMAGED || state === EdgeState.BREACHED;
}

/**
 * The 2 m grid over the whole map.
 * - Cells: permanently blocked (core, crate, spawn pads) or occupied by a structure (MG nest). `isWalkable`.
 * - Edges: walls stand on the edges between cells. A standing wall (intact, damaged or breached) blocks
 *   movement between the two cells it separates; rubble left by a collapsed wall does not. Pathfinding (M6)
 *   steps from cell to cell with `canStep`, which checks both, and listens for `navChanged`.
 * Cell (0, 0) is the north-west corner; cell (i, j) spans x in [-half + i*size, -half + (i+1)*size], same for z.
 */
/** The direction a wall on `edge` leaves grid point (i, j) in, as a `Dir` mask bit; 0 if the edge doesn't touch it. */
export function edgeDirBit(edge: Readonly<Edge>, i: number, j: number): number {
  if (i === edge.i && j === edge.j) return 1 << (edge.axis === 'x' ? Dir.PX : Dir.PZ);
  if (edge.axis === 'x' && i === edge.i + 1 && j === edge.j) return 1 << Dir.NX;
  if (edge.axis === 'z' && i === edge.i && j === edge.j + 1) return 1 << Dir.NZ;
  return 0;
}

export class BuildGrid {
  readonly size: number = config.build.cellSize;
  readonly columns: number;
  readonly rows: number;
  private readonly half: number = config.map.size / 2;
  private readonly blocked: Uint8Array;
  /** Cells nobody may build on that can still be walked through (enemy spawn pads). */
  private readonly reserved: Uint8Array;
  private readonly occupant: Int32Array;
  /** Reused by `canStep`, which pathfinding calls many times per search. */
  private readonly stepEdge: Edge = { axis: 'x', i: 0, j: 0 };
  private readonly blocking: Uint8Array;
  private readonly inRadius: Uint8Array;
  /** Per edge: wall id (0 for none) and its `EdgeState`. */
  private readonly xEdgeWall: Int32Array;
  private readonly zEdgeWall: Int32Array;
  private readonly xEdgeState: Uint8Array;
  private readonly zEdgeState: Uint8Array;

  constructor() {
    this.columns = Math.round(config.map.size / this.size);
    this.rows = this.columns;
    const count = this.columns * this.rows;
    this.blocked = new Uint8Array(count);
    this.reserved = new Uint8Array(count);
    this.occupant = new Int32Array(count);
    this.blocking = new Uint8Array(count);
    this.inRadius = new Uint8Array(count);
    // x edges: columns wide, rows + 1 lines. z edges: columns + 1 lines, rows long.
    this.xEdgeWall = new Int32Array(this.columns * (this.rows + 1));
    this.xEdgeState = new Uint8Array(this.xEdgeWall.length);
    this.zEdgeWall = new Int32Array((this.columns + 1) * this.rows);
    this.zEdgeState = new Uint8Array(this.zEdgeWall.length);

    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.columns; i++) {
        this.inRadius[this.index(i, j)] = this.withinRadius(this.centerX(i), this.centerZ(j)) ? 1 : 0;
      }
    }
  }

  // ---- Positions ----

  centerX(i: number): number {
    return -this.half + (i + 0.5) * this.size;
  }

  centerZ(j: number): number {
    return -this.half + (j + 0.5) * this.size;
  }

  /** World position of grid point (vertex) (i, j). */
  vertexX(i: number): number {
    return -this.half + i * this.size;
  }

  vertexZ(j: number): number {
    return -this.half + j * this.size;
  }

  /** The cell containing world point (x, z), written into `out`. Returns false if it is off the map. */
  cellAt(x: number, z: number, out: Cell): boolean {
    out.i = Math.floor((x + this.half) / this.size);
    out.j = Math.floor((z + this.half) / this.size);
    return this.contains(out.i, out.j);
  }

  /** The grid point nearest world point (x, z). */
  vertexNear(x: number, z: number, out: Cell): void {
    out.i = Math.round((x + this.half) / this.size);
    out.j = Math.round((z + this.half) / this.size);
  }

  /** The `axis` edge nearest world point (x, z), written into `out`. */
  edgeNear(x: number, z: number, axis: 'x' | 'z', out: Edge): void {
    const gx = (x + this.half) / this.size;
    const gz = (z + this.half) / this.size;
    out.axis = axis;
    if (axis === 'x') {
      out.i = Math.floor(gx);
      out.j = Math.round(gz);
    } else {
      out.i = Math.round(gx);
      out.j = Math.floor(gz);
    }
  }

  /** World position of an edge's middle, on the ground. */
  edgeMidpoint(edge: Edge, out: Vector3): Vector3 {
    const x = edge.axis === 'x' ? this.vertexX(edge.i) + this.size / 2 : this.vertexX(edge.i);
    const z = edge.axis === 'x' ? this.vertexZ(edge.j) : this.vertexZ(edge.j) + this.size / 2;
    return out.set(x, 0, z);
  }

  /** The grid point at the far end of an edge (the near end is (edge.i, edge.j)). */
  edgeEnd(edge: Edge, out: Cell): Cell {
    out.i = edge.i + (edge.axis === 'x' ? 1 : 0);
    out.j = edge.j + (edge.axis === 'z' ? 1 : 0);
    return out;
  }

  // ---- Cells ----

  contains(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.columns && j < this.rows;
  }

  isInBuildRadius(i: number, j: number): boolean {
    return this.contains(i, j) && this.inRadius[this.index(i, j)] === 1;
  }

  /** Free to build on: on the map, not permanently blocked and not occupied. Ignores the build radius. */
  isFree(i: number, j: number): boolean {
    if (!this.contains(i, j)) return false;
    const k = this.index(i, j);
    return this.blocked[k] === 0 && this.reserved[k] === 0 && this.occupant[k] === NONE;
  }

  /** Structure id occupying the cell, or 0. */
  occupantOf(i: number, j: number): number {
    return this.contains(i, j) ? this.occupant[this.index(i, j)] : NONE;
  }

  /** For pathfinding: false where a permanent blocker or a movement-blocking structure stands in the cell. */
  isWalkable(i: number, j: number): boolean {
    if (!this.contains(i, j)) return false;
    const k = this.index(i, j);
    return this.blocked[k] === 0 && this.blocking[k] === 0;
  }

  /** For pathfinding: can something walk from cell (i, j) to its side neighbour (i + di, j + dj)? Checks the cell and the wall between. */
  canStep(i: number, j: number, di: -1 | 0 | 1, dj: -1 | 0 | 1): boolean {
    if (Math.abs(di) + Math.abs(dj) !== 1 || !this.isWalkable(i + di, j + dj)) return false;
    return !this.isEdgeBlocked(this.stepEdgeOf(i, j, di, dj, this.stepEdge));
  }

  /** The edge crossed stepping from cell (i, j) to its side neighbour (i + di, j + dj), written into `out`. */
  stepEdgeOf(i: number, j: number, di: number, dj: number, out: Edge): Edge {
    if (di !== 0) {
      out.axis = 'z';
      out.i = di > 0 ? i + 1 : i;
      out.j = j;
    } else {
      out.axis = 'x';
      out.i = i;
      out.j = dj > 0 ? j + 1 : j;
    }
    return out;
  }

  /** Mark every cell overlapping the axis-aligned box centered at `center` (half sizes in meters) as permanently blocked. */
  blockArea(center: Vector3, halfX: number, halfZ: number): void {
    const min: Cell = { i: 0, j: 0 };
    const max: Cell = { i: 0, j: 0 };
    // Shrink a hair so a box ending exactly on a grid line does not claim the next cell.
    this.cellAt(center.x - halfX + 1e-3, center.z - halfZ + 1e-3, min);
    this.cellAt(center.x + halfX - 1e-3, center.z + halfZ - 1e-3, max);
    for (let j = min.j; j <= max.j; j++) {
      for (let i = min.i; i <= max.i; i++) {
        if (this.contains(i, j)) this.blocked[this.index(i, j)] = 1;
      }
    }
  }

  /** Mark every cell overlapping the box as never buildable, without blocking movement (enemy spawn pads). */
  reserveArea(center: Vector3, halfX: number, halfZ: number): void {
    const min: Cell = { i: 0, j: 0 };
    const max: Cell = { i: 0, j: 0 };
    this.cellAt(center.x - halfX + 1e-3, center.z - halfZ + 1e-3, min);
    this.cellAt(center.x + halfX - 1e-3, center.z + halfZ - 1e-3, max);
    for (let j = min.j; j <= max.j; j++) {
      for (let i = min.i; i <= max.i; i++) {
        if (this.contains(i, j)) this.reserved[this.index(i, j)] = 1;
      }
    }
  }

  /** Give `cells` to structure `id`. `blocksMovement` is what pathfinding will see. */
  occupy(cells: readonly Cell[], id: number, blocksMovement: boolean): void {
    for (const { i, j } of cells) {
      const k = this.index(i, j);
      this.occupant[k] = id;
      this.blocking[k] = blocksMovement ? 1 : 0;
    }
  }

  release(cells: readonly Cell[]): void {
    for (const { i, j } of cells) {
      const k = this.index(i, j);
      this.occupant[k] = NONE;
      this.blocking[k] = 0;
    }
  }

  // ---- Edges ----

  containsEdge(edge: Edge): boolean {
    return edge.axis === 'x'
      ? edge.i >= 0 && edge.i < this.columns && edge.j >= 0 && edge.j <= this.rows
      : edge.i >= 0 && edge.i <= this.columns && edge.j >= 0 && edge.j < this.rows;
  }

  /** The two cells an edge separates (either may be off the map). */
  edgeCells(edge: Edge, a: Cell, b: Cell): void {
    if (edge.axis === 'x') {
      a.i = edge.i;
      a.j = edge.j - 1;
      b.i = edge.i;
      b.j = edge.j;
    } else {
      a.i = edge.i - 1;
      a.j = edge.j;
      b.i = edge.i;
      b.j = edge.j;
    }
  }

  isEdgeInBuildRadius(edge: Edge): boolean {
    const x = edge.axis === 'x' ? this.vertexX(edge.i) + this.size / 2 : this.vertexX(edge.i);
    const z = edge.axis === 'x' ? this.vertexZ(edge.j) : this.vertexZ(edge.j) + this.size / 2;
    return this.containsEdge(edge) && this.withinRadius(x, z);
  }

  /**
   * A wall can stand here: on the map, no wall yet, and not inside something. An edge whose cells on
   * both sides are blocked or occupied (inside the MG nest, the core) is inside; an edge on the outer
   * border of such an area is fine as far as the grid is concerned (the physics check decides the rest).
   */
  isEdgeFree(edge: Edge): boolean {
    if (!this.containsEdge(edge) || this.edgeWall(edge) !== NONE) return false;
    const a: Cell = { i: 0, j: 0 };
    const b: Cell = { i: 0, j: 0 };
    this.edgeCells(edge, a, b);
    return this.isFree(a.i, a.j) || this.isFree(b.i, b.j);
  }

  /** For pathfinding: a standing wall on this edge (intact, damaged or breached) stops movement between its two cells. */
  isEdgeBlocked(edge: Edge): boolean {
    if (!this.containsEdge(edge)) return true;
    return blocks(this.edgeState(edge));
  }

  /** What stands on the edge (open off the map). */
  edgeState(edge: Edge): EdgeState {
    if (!this.containsEdge(edge)) return EdgeState.OPEN;
    const k = this.edgeIndex(edge);
    return (edge.axis === 'x' ? this.xEdgeState[k] : this.zEdgeState[k]) as EdgeState;
  }

  /** Set what stands on the edge. Returns true if that changed whether movement can cross it. */
  setEdgeState(edge: Edge, state: EdgeState): boolean {
    const states = edge.axis === 'x' ? this.xEdgeState : this.zEdgeState;
    const k = this.edgeIndex(edge);
    const was = blocks(states[k]);
    states[k] = state;
    return was !== blocks(state);
  }

  /** Wall id on the edge, or 0. */
  edgeWall(edge: Edge): number {
    if (!this.containsEdge(edge)) return NONE;
    const k = this.edgeIndex(edge);
    return edge.axis === 'x' ? this.xEdgeWall[k] : this.zEdgeWall[k];
  }

  /** Stand wall `id` on the edge, intact. Returns true if that changed whether movement can cross it. */
  occupyEdge(edge: Edge, id: number): boolean {
    (edge.axis === 'x' ? this.xEdgeWall : this.zEdgeWall)[this.edgeIndex(edge)] = id;
    return this.setEdgeState(edge, EdgeState.INTACT);
  }

  /** The wall on the edge is gone, leaving `left` (open ground, or rubble). Returns true if movement across it changed. */
  releaseEdge(edge: Edge, left: typeof EdgeState.OPEN | typeof EdgeState.RUBBLE = EdgeState.OPEN): boolean {
    (edge.axis === 'x' ? this.xEdgeWall : this.zEdgeWall)[this.edgeIndex(edge)] = NONE;
    return this.setEdgeState(edge, left);
  }

  /** Which of the four edges at grid point (i, j) hold walls, as a `Dir` bit mask. */
  wallMaskAt(i: number, j: number): number {
    let mask = 0;
    if (this.edgeWall({ axis: 'x', i, j }) !== NONE) mask |= 1 << Dir.PX;
    if (this.edgeWall({ axis: 'z', i, j }) !== NONE) mask |= 1 << Dir.PZ;
    if (this.edgeWall({ axis: 'x', i: i - 1, j }) !== NONE) mask |= 1 << Dir.NX;
    if (this.edgeWall({ axis: 'z', i, j: j - 1 }) !== NONE) mask |= 1 << Dir.NZ;
    return mask;
  }

  /** Wall ids on the edges at grid point (i, j), in `Dir` order (0 where there is none). */
  wallsAt(i: number, j: number, out: number[]): number[] {
    out.length = 0;
    out.push(
      this.edgeWall({ axis: 'x', i, j }),
      this.edgeWall({ axis: 'z', i, j }),
      this.edgeWall({ axis: 'x', i: i - 1, j }),
      this.edgeWall({ axis: 'z', i, j: j - 1 }),
    );
    return out;
  }

  private withinRadius(x: number, z: number): boolean {
    const core = config.map.corePosition;
    const radius = config.build.buildRadius;
    const dx = x - core.x;
    const dz = z - core.z;
    return dx * dx + dz * dz <= radius * radius;
  }

  private index(i: number, j: number): number {
    return j * this.columns + i;
  }

  private edgeIndex(edge: Edge): number {
    return edge.axis === 'x' ? edge.j * this.columns + edge.i : edge.j * (this.columns + 1) + edge.i;
  }
}
