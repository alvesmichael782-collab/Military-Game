import { Vector3 } from 'three';
import { config } from '../core/config';
import type { BuildGrid, Cell, Edge } from '../world/BuildGrid';

/** A wall's remaining and full HP, for the cost of breaching it. */
export interface WallHealth {
  hp: number;
  maxHp: number;
}

/** Looks up a standing wall by id. */
export type WallLookup = (wallId: number) => WallHealth | undefined;

/** A planned route, reused per enemy. Waypoints are cell centers on the ground, already smoothed. */
export class EnemyPath {
  readonly xs: number[] = [];
  readonly zs: number[] = [];
  /** The first standing wall the route goes through (its breach point), or 0 for an open route. */
  breachWallId = 0;
  readonly breachEdge: Edge = { axis: 'x', i: 0, j: 0 };
  /** Index of the waypoint just before the breach wall, or -1. */
  breachIndex = -1;
  /** True if the route ends next to the core; false if the search gave up and it only gets closer. */
  reachesCore = false;
  /** Grid cells the raw route passes through (cell index = j * columns + i), for deciding who re-plans after a wall change. */
  readonly cells: number[] = [];

  get length(): number {
    return this.xs.length;
  }

  clear(): void {
    this.xs.length = 0;
    this.zs.length = 0;
    this.cells.length = 0;
    this.breachWallId = 0;
    this.breachIndex = -1;
    this.reachesCore = false;
  }
}

const SQRT2 = Math.SQRT2;
type Step = -1 | 0 | 1;
/** The four side steps, then the four diagonals as pairs of side steps (indices into the first four). */
const SIDE_I: readonly Step[] = [1, -1, 0, 0];
const SIDE_J: readonly Step[] = [0, 0, 1, -1];
const DIAGONAL_A: readonly number[] = [0, 0, 1, 1];
const DIAGONAL_B: readonly number[] = [2, 3, 2, 3];

/**
 * A* over the build grid's cells in 8 directions (`BuildGrid.canStep`), with no diagonal corner-cutting past
 * walls. Standing walls are not hard blockers: an orthogonal step across one is allowed at a high cost that
 * rises with the wall's HP (and its distance from the core), so a walled-in core still gets a route, through
 * the weakest wall. That first wall is the route's breach point. Typed arrays are reused across searches.
 */
export class Pathfinder {
  private readonly count: number;
  private readonly g: Float32Array;
  private readonly parent: Int32Array;
  /** Search id that last touched / closed each cell, so nothing needs clearing between searches. */
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private search = 0;
  private readonly heapCell: Int32Array;
  private readonly heapF: Float32Array;
  private heapSize = 0;
  private readonly raw: number[] = [];
  /** For each raw route cell, true where the step out of it crosses a standing wall. */
  private readonly crossing: boolean[] = [];
  private readonly edge: Edge = { axis: 'x', i: 0, j: 0 };
  private readonly cell: Cell = { i: 0, j: 0 };
  private readonly coreX = config.map.corePosition.x;
  private readonly coreZ = config.map.corePosition.z;
  private readonly mid = new Vector3();
  /** Heuristic per cell (distance to the goal zone), fixed because the core never moves. */
  private readonly h: Float32Array;
  /** Per side step of the cell being expanded: 1 if it is open ground (no wall), else 0. */
  private readonly sideOpen = new Uint8Array(4);
  /** 1 for the cells under the core. */
  private readonly coreCell: Uint8Array;

  /** `coreCells` are the grid cells under the core's footprint. */
  constructor(
    private readonly grid: BuildGrid,
    private readonly walls: WallLookup,
    coreCells: readonly Cell[],
  ) {
    this.count = grid.columns * grid.rows;
    this.coreCell = new Uint8Array(this.count);
    for (const { i, j } of coreCells) if (grid.contains(i, j)) this.coreCell[j * grid.columns + i] = 1;
    this.g = new Float32Array(this.count);
    this.parent = new Int32Array(this.count);
    this.seen = new Uint32Array(this.count);
    this.closed = new Uint32Array(this.count);
    // Lazy deletion pushes a cell once per improvement; 8 per cell is more than enough.
    this.heapCell = new Int32Array(this.count * 8);
    this.heapF = new Float32Array(this.count * 8);
    this.h = new Float32Array(this.count);
    const goal = config.pathfinding.coreGoalRadius;
    for (let j = 0; j < grid.rows; j++) {
      for (let i = 0; i < grid.columns; i++) {
        const dx = grid.centerX(i) - this.coreX;
        const dz = grid.centerZ(j) - this.coreZ;
        this.h[j * grid.columns + i] = Math.max(0, Math.sqrt(dx * dx + dz * dz) - goal);
      }
    }
  }

  /** Plan a route from world point (x, z) to the core into `out`. Returns false if no step at all could be taken. */
  findPath(x: number, z: number, out: EnemyPath): boolean {
    out.clear();
    const grid = this.grid;
    const columns = grid.columns;
    if (!grid.cellAt(x, z, this.cell)) {
      // Off the grid: clamp onto it.
      this.cell.i = Math.min(columns - 1, Math.max(0, this.cell.i));
      this.cell.j = Math.min(grid.rows - 1, Math.max(0, this.cell.j));
    }
    const start = this.cell.j * columns + this.cell.i;

    this.search++;
    if (this.search === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.search = 1;
    }
    const id = this.search;
    this.heapSize = 0;
    this.g[start] = 0;
    this.parent[start] = -1;
    this.seen[start] = id;
    const hs = this.h;
    this.push(start, hs[start]);

    let best = start;
    let bestH = hs[start];
    let goal = -1;
    let visited = 0;
    const maxVisited = config.pathfinding.maxVisited;
    // Best way into the core through a wall hugging it (a tight ring): its total cost, the cell it starts from, and the core cell behind the wall.
    let throughCost = Infinity;
    let throughFrom = -1;
    let throughCore = -1;

    while (this.heapSize > 0) {
      const current = this.pop();
      if (this.closed[current] === id) continue;
      // Every route still open costs at least as much as going through the wall: that is the best there is.
      if (this.g[current] + hs[current] >= throughCost) break;
      this.closed[current] = id;
      const ci = current % columns;
      const cj = (current - ci) / columns;
      const h = hs[current];
      if (h <= 0 && grid.isWalkable(ci, cj)) {
        // Next to the core with nothing in between: arrived. With a wall in between (a tight ring inside the
        // goal zone), the route must go through it, at the usual wall-crossing cost.
        let open = false;
        for (let d = 0; d < 4; d++) {
          const ni = ci + SIDE_I[d];
          const nj = cj + SIDE_J[d];
          if (!grid.contains(ni, nj) || this.coreCell[nj * columns + ni] === 0) continue;
          grid.stepEdgeOf(ci, cj, SIDE_I[d], SIDE_J[d], this.edge);
          const wall = grid.isEdgeBlocked(this.edge) ? grid.edgeWall(this.edge) : 0;
          if (wall === 0) {
            open = true;
            break;
          }
          const cost = this.g[current] + grid.size + this.wallCost(wall, this.edge);
          if (cost < throughCost) {
            throughCost = cost;
            throughFrom = current;
            throughCore = nj * columns + ni;
          }
        }
        if (open) {
          goal = current;
          break;
        }
      }
      if (h < bestH) {
        bestH = h;
        best = current;
      }
      if (++visited > maxVisited) break;

      const size = grid.size;
      const gCurrent = this.g[current];
      // Side steps: walls cost extra to cross, off-map and blocked cells cannot be entered.
      for (let d = 0; d < 4; d++) {
        const di = SIDE_I[d];
        const dj = SIDE_J[d];
        this.sideOpen[d] = 0;
        if (!grid.isWalkable(ci + di, cj + dj)) continue;
        let step = size;
        grid.stepEdgeOf(ci, cj, di, dj, this.edge);
        if (grid.isEdgeBlocked(this.edge)) {
          const wall = grid.edgeWall(this.edge);
          if (wall === 0) continue; // off the map
          step += this.wallCost(wall, this.edge);
        } else {
          this.sideOpen[d] = 1;
        }
        this.relax(current, (cj + dj) * columns + ci + di, gCurrent + step, id);
      }
      // Diagonals only through open corners: both side steps open (no wall), and no wall on the far two
      // edges around the corner either.
      for (let d = 0; d < 4; d++) {
        const a = DIAGONAL_A[d];
        const b = DIAGONAL_B[d];
        if (this.sideOpen[a] === 0 || this.sideOpen[b] === 0) continue;
        const di = SIDE_I[a];
        const dj = SIDE_J[b];
        if (!grid.canStep(ci + di, cj, 0, dj) || !grid.canStep(ci, cj + dj, di, 0)) continue;
        this.relax(current, (cj + dj) * columns + ci + di, gCurrent + SQRT2 * size, id);
      }
    }

    if (goal < 0 && throughFrom >= 0) {
      // In through the wall around the core: the core cell behind it ends the route, so the wall shows up as a crossing.
      this.parent[throughCore] = throughFrom;
      out.reachesCore = true;
      this.buildRoute(start, throughCore, out);
      return true;
    }
    const end = goal >= 0 ? goal : best;
    out.reachesCore = goal >= 0;
    if (end === start && goal < 0) return false;
    this.buildRoute(start, end, out);
    return true;
  }

  /** What crossing the standing wall `wallId` on `edge` adds to a route, in meters of walking. */
  wallCost(wallId: number, edge: Edge): number {
    const p = config.pathfinding;
    const health = this.walls(wallId);
    const hp = health ? health.hp : config.structures.wall.hp;
    // How far the edge is from the core, as a fraction of the build radius.
    const mid = this.grid.edgeMidpoint(edge, this.mid);
    const far = Math.min(1, Math.hypot(mid.x - this.coreX, mid.z - this.coreZ) / config.build.buildRadius);
    return (p.wallCrossBase + p.wallCrossPerHp * hp) * (1 + p.wallCoreDistanceCost * far);
  }

  /** Reach `next` from `current` at cost `g` if that beats what it had. */
  private relax(current: number, next: number, g: number, id: number): void {
    if (this.closed[next] === id) return;
    if (this.seen[next] === id && g >= this.g[next]) return;
    this.seen[next] = id;
    this.g[next] = g;
    this.parent[next] = current;
    this.push(next, g + this.h[next]);
  }

  /** Walk the parents back, find the breach, then smooth the route into waypoints. */
  private buildRoute(start: number, end: number, out: EnemyPath): void {
    const grid = this.grid;
    const columns = grid.columns;
    const raw = this.raw;
    raw.length = 0;
    for (let c = end; c !== -1; c = this.parent[c]) {
      raw.push(c);
      if (c === start) break;
    }
    raw.reverse();
    out.cells.push(...raw);

    // Mark wall crossings; the first is the breach.
    const crossing = this.crossing;
    crossing.length = raw.length;
    for (let k = 0; k < raw.length; k++) {
      crossing[k] = false;
      if (k + 1 >= raw.length) break;
      const a = raw[k];
      const b = raw[k + 1];
      const ai = a % columns;
      const aj = (a - ai) / columns;
      const di = (b % columns) - ai;
      const dj = (b - (b % columns)) / columns - aj;
      if (di !== 0 && dj !== 0) continue;
      grid.stepEdgeOf(ai, aj, di, dj, this.edge);
      if (!grid.isEdgeBlocked(this.edge)) continue;
      crossing[k] = true;
      if (out.breachWallId === 0) {
        out.breachWallId = grid.edgeWall(this.edge);
        out.breachEdge.axis = this.edge.axis;
        out.breachEdge.i = this.edge.i;
        out.breachEdge.j = this.edge.j;
      }
    }

    // Greedy string pulling: from each anchor, go straight to the farthest cell with a clear line,
    // never past a wall crossing (both sides of a crossing stay as waypoints).
    let anchor = 0;
    this.addWaypoint(out, raw[0]);
    while (anchor < raw.length - 1) {
      let limit = raw.length - 1;
      for (let k = anchor; k < raw.length - 1; k++) {
        if (crossing[k]) {
          limit = k;
          break;
        }
      }
      if (limit === anchor) {
        // Crossing a wall from here: the far side is the next waypoint.
        if (crossing[anchor] && out.breachIndex < 0) out.breachIndex = out.xs.length - 1;
        anchor++;
        this.addWaypoint(out, raw[anchor]);
        continue;
      }
      let k = anchor + 1;
      while (k < limit && this.lineClear(raw[anchor], raw[k + 1])) k++;
      anchor = k;
      this.addWaypoint(out, raw[anchor]);
    }
  }

  private addWaypoint(out: EnemyPath, cell: number): void {
    const columns = this.grid.columns;
    const i = cell % columns;
    out.xs.push(this.grid.centerX(i));
    out.zs.push(this.grid.centerZ((cell - i) / columns));
  }

  /**
   * True if a straight walk between two cell centers only steps between open neighbours: walks the cells
   * the line passes through (grid traversal) and checks each step with `canStep`.
   */
  private lineClear(a: number, b: number): boolean {
    const grid = this.grid;
    const columns = grid.columns;
    let i = a % columns;
    let j = (a - i) / columns;
    const bi = b % columns;
    const bj = (b - bi) / columns;
    const dx = bi - i;
    const dz = bj - j;
    const si = Math.sign(dx) as Step;
    const sj = Math.sign(dz) as Step;
    // Distance along the line (in units of the full line) between crossings of vertical and horizontal grid lines.
    const tDeltaX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    const tDeltaZ = dz !== 0 ? 1 / Math.abs(dz) : Infinity;
    // Starting at a cell center, the first crossing is half a cell away.
    let tMaxX = tDeltaX / 2;
    let tMaxZ = tDeltaZ / 2;
    const EPS = 1e-9;
    while (i !== bi || j !== bj) {
      if (Math.abs(tMaxX - tMaxZ) < EPS) {
        // Exactly through a grid point: both ways round the corner must be open.
        if (!grid.canStep(i, j, si, 0) || !grid.canStep(i + si, j, 0, sj) || !grid.canStep(i, j, 0, sj) || !grid.canStep(i, j + sj, si, 0)) {
          return false;
        }
        i += si;
        j += sj;
        tMaxX += tDeltaX;
        tMaxZ += tDeltaZ;
      } else if (tMaxX < tMaxZ) {
        if (!grid.canStep(i, j, si, 0)) return false;
        i += si;
        tMaxX += tDeltaX;
      } else {
        if (!grid.canStep(i, j, 0, sj)) return false;
        j += sj;
        tMaxZ += tDeltaZ;
      }
    }
    return true;
  }

  // ---- Binary min-heap on f ----

  private push(cell: number, f: number): void {
    let n = this.heapSize++;
    if (n >= this.heapCell.length) {
      // Cannot happen with 8 pushes per cell, but never write out of bounds.
      this.heapSize--;
      return;
    }
    const cells = this.heapCell;
    const fs = this.heapF;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (fs[p] <= f) break;
      cells[n] = cells[p];
      fs[n] = fs[p];
      n = p;
    }
    cells[n] = cell;
    fs[n] = f;
  }

  private pop(): number {
    const cells = this.heapCell;
    const fs = this.heapF;
    const top = cells[0];
    const size = --this.heapSize;
    if (size === 0) return top;
    const cell = cells[size];
    const f = fs[size];
    let n = 0;
    for (;;) {
      let child = 2 * n + 1;
      if (child >= size) break;
      if (child + 1 < size && fs[child + 1] < fs[child]) child++;
      if (fs[child] >= f) break;
      cells[n] = cells[child];
      fs[n] = fs[child];
      n = child;
    }
    cells[n] = cell;
    fs[n] = f;
    return top;
  }
}
