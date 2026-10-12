import { BufferGeometry, Float32BufferAttribute } from 'three';
import { config } from '../core/config';

/*
 * Wall pieces, built as low-poly prisms from one cross-section:
 *
 *         ||            upright: `thickness` wide, `height` tall
 *      ___||___         lips: `lipWidth` out and `lipHeight` tall on each side, top outer edge beveled
 *     |________|
 *
 * A wall runs along a grid edge from one grid point to the next: a middle segment plus an arm piece at
 * each end. Arms cover the last R (half the thickness plus a lip) up to the grid point, and their shape
 * depends on the other walls meeting there: a flat open end, a straight join, half of a 45 degree corner,
 * a T (straight through, or the branch), or a quarter of a cross. Every wall owns exactly its own share
 * of the joint, so walls never overlap and a wall looks the same in preview as once built.
 *
 * Arm lips end in one of three ways: flat (they continue straight into the next arm), a 45 degree inside
 * miter (they meet a neighbouring arm's lip), or a 45 degree outside miter (they wrap round the outside of
 * a corner and meet the other arm's lip). Faces hidden inside the wall are never built.
 */

const w = config.structures.wall;
/** Half the upright's thickness, and the lip's outer edge, from the wall's center line. */
const T = w.thickness / 2;
const R = T + w.lipWidth;
const H = w.height;
const LIP = w.lipHeight;
const BEVEL = w.lipBevel;
/** Extra row of vertices up the upright so the dark base shading fades out instead of spanning the whole face. */
const AO_SPLIT = LIP + 0.7;

/** Half the side of the square a joint covers. Segments stop this far from each grid point. */
export const JOINT_RADIUS = R;

/** The cross-section numbers above, for damaged wall pieces built elsewhere (see destruction/WallDamageGeometry). */
export const WALL_PROFILE = { T, R, H, LIP, BEVEL, AO_SPLIT } as const;

/**
 * Per-vertex flag (`wallBroken`): 1 on broken faces (hole sides, chipped tops and lips), which the wall
 * material draws as bare brick; 0 everywhere else. Every wall geometry carries it.
 */
export const WALL_BROKEN_ATTRIBUTE = 'wallBroken';

/** Joint shapes, each a canonical direction mask (bits: +x, +z, -x, -z). */
export const JOINT_SHAPES = {
  end: 0b0001,
  straight: 0b0101,
  corner: 0b0011,
  tee: 0b0111,
  cross: 0b1111,
} as const;
export type JointShape = keyof typeof JOINT_SHAPES;

/** Unit vectors (x, z) for the four directions, in mask bit order. */
const DIRS: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

type V3 = [number, number, number];

/** Vertex shade by height: dark at the foot of the wall and on the lips, full brightness up the upright. */
export function shade(y: number, lip: boolean): number {
  if (lip) return 0.6 + 0.16 * Math.min(1, y / LIP);
  if (y <= LIP + 1e-4) return 0.62;
  const t = Math.min(1, (y - LIP) / (AO_SPLIT - LIP));
  return 0.62 + 0.3 * t + (y >= H - 1e-4 ? 0.04 : y > AO_SPLIT ? 0.08 * ((y - AO_SPLIT) / (H - AO_SPLIT)) : 0);
}

/** Collects flat-shaded triangles with per-vertex shade colors. */
class Builder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];

  /** A convex planar polygon, wound so it faces `hint`. */
  face(points: V3[], hint: V3, lip: boolean): void {
    const [a, b, c] = points;
    const n = cross(sub(b, a), sub(c, a));
    const pts = dot(n, hint) < 0 ? [...points].reverse() : points;
    for (let k = 1; k < pts.length - 1; k++) {
      for (const p of [pts[0], pts[k], pts[k + 1]]) {
        this.positions.push(p[0], p[1], p[2]);
        const s = shade(p[1], lip);
        this.colors.push(s, s, s);
      }
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute(WALL_BROKEN_ATTRIBUTE, new Float32BufferAttribute(new Float32Array(this.positions.length / 3), 1));
    geometry.computeVertexNormals();
    return geometry;
  }
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Point `s` along direction `d`, `u` out along direction `n`, at height `v`. */
function at(d: number, n: number, s: number, u: number, v: number): V3 {
  return [DIRS[d][0] * s + DIRS[n][0] * u, v, DIRS[d][1] * s + DIRS[n][1] * u];
}

function hintOf(d: number): V3 {
  return [DIRS[d][0], 0, DIRS[d][1]];
}

const UP: V3 = [0, 1, 0];

/** One side of the upright (side `n` of a wall running along `d`), from `s0` to `s1`, above the lips. */
function side(b: Builder, d: number, n: number, s0: number, s1: number): void {
  for (const [v0, v1] of [[LIP, AO_SPLIT], [AO_SPLIT, H]]) {
    b.face([at(d, n, s0, T, v0), at(d, n, s1, T, v0), at(d, n, s1, T, v1), at(d, n, s0, T, v1)], hintOf(n), false);
  }
}

/** Flat full-height end of the upright at `s`, facing back along `d`, for an open wall end. */
function endCap(b: Builder, d: number, s: number): void {
  const left = (d + 1) % 4;
  for (const [v0, v1] of [[0, LIP], [LIP, AO_SPLIT], [AO_SPLIT, H]]) {
    b.face([at(d, left, s, T, v0), at(d, left, s, -T, v0), at(d, left, s, -T, v1), at(d, left, s, T, v1)], hintOf((d + 2) % 4), false);
  }
}

/** Upright running along direction `d` from `s0` to `s1`: top and both sides. */
function upright(b: Builder, d: number, s0: number, s1: number): void {
  const left = (d + 1) % 4;
  side(b, d, left, s0, s1);
  side(b, d, (d + 3) % 4, s0, s1);
  b.face([at(d, left, s0, T, H), at(d, left, s1, T, H), at(d, left, s1, -T, H), at(d, left, s0, -T, H)], UP, false);
}

/** How a lip strip's inner end is cut, as the start position for a point `u` out from the center line. */
type LipCut = (u: number) => number;
const flatAt = (s: number): LipCut => () => s;
const insideMiter: LipCut = (u) => u;
const outsideMiter: LipCut = (u) => -u;

/**
 * Lip on side `n` of a wall running along `d`, from its inner cut to `s1`: top, bevel and outer face.
 * `capStart` closes the start (a flat open end).
 */
function lip(b: Builder, d: number, n: number, start: LipCut, s1: number, capStart: boolean): void {
  // Cross-section from the upright outward: top inner, bevel start, bevel end, outer foot.
  const profile: [number, number][] = [
    [T, LIP],
    [R - BEVEL, LIP],
    [R, LIP - BEVEL],
    [R, 0],
  ];
  const out = hintOf(n);
  const hints: V3[] = [UP, [out[0] + 0, 1, out[2]], out];
  for (let k = 0; k < 3; k++) {
    const [u0, v0] = profile[k];
    const [u1, v1] = profile[k + 1];
    b.face([at(d, n, start(u0), u0, v0), at(d, n, start(u1), u1, v1), at(d, n, s1, u1, v1), at(d, n, s1, u0, v0)], hints[k], true);
  }
  if (capStart) {
    const s = start(T);
    b.face(
      [at(d, n, s, T, 0), at(d, n, s, R, 0), at(d, n, s, R, LIP - BEVEL), at(d, n, s, R - BEVEL, LIP), at(d, n, s, T, LIP)],
      hintOf((d + 2) % 4),
      true,
    );
  }
}

/** The middle of a wall: one cell long minus a joint at each end, centered on the origin, running along +x. */
export function createSegmentGeometry(): BufferGeometry {
  const b = new Builder();
  const half = config.build.cellSize / 2 - R;
  upright(b, 0, -half, half);
  lip(b, 0, 1, flatAt(-half), half, false);
  lip(b, 0, 3, flatAt(-half), half, false);
  return b.build();
}

/** Arm shape flags: the other walls at the arm's grid point, relative to the arm's own direction. */
export const ARM_LEFT = 0b001;
/** A wall straight on past the grid point. */
export const ARM_ON = 0b010;
export const ARM_RIGHT = 0b100;
/** Arm shapes are the eight combinations of the flags above; 0 is an open end. */
export const ARM_SHAPE_COUNT = 8;

/** The arm shape for a wall leaving a grid point in direction `d`, given the point's direction `mask`. */
export function armShapeOf(mask: number, d: number): number {
  const has = (k: number): number => (mask >> ((d + k) % 4)) & 1;
  return has(1) | (has(2) << 1) | (has(3) << 2);
}

/**
 * The arm piece of a wall leaving a grid point along +x, in that point's frame: the wall's share of the
 * joint there, from the grid point (or the joint's diagonal) out to R, where the middle segment starts.
 * Left is +z. Corners split on the 45 degree diagonal, a T's straight walls own the middle and the
 * branch stops at their face, and a cross splits four ways.
 */
export function createArmGeometry(shape: number): BufferGeometry {
  const b = new Builder();
  const on = (shape & ARM_ON) !== 0;
  const left = (shape & ARM_LEFT) !== 0;
  const right = (shape & ARM_RIGHT) !== 0;
  const end = shape === 0;
  const sides = [
    { n: 1, has: left, other: right },
    { n: 3, has: right, other: left },
  ];
  // Where each side face starts: at the neighbour's face, at the grid point, or round the outside of a corner.
  const sideStart = (has: boolean, other: boolean): number => (has ? T : on ? 0 : other ? -T : 0);
  // The top follows the sides, except that straight-through walls own the middle of a T.
  const topStart = (has: boolean, other: boolean): number => (on ? (left && right ? T : 0) : sideStart(has, other));

  for (const { n, has, other } of sides) side(b, 0, n, sideStart(has, other), R);
  const top: V3[] = [at(0, 1, topStart(right, left), -T, H), at(0, 1, R, -T, H), at(0, 1, R, T, H), at(0, 1, topStart(left, right), T, H)];
  if (on && left && right) top.push([0, H, 0]);
  b.face(top, UP, false);
  if (end) endCap(b, 0, 0);
  for (const { n, has, other } of sides) {
    const cut = has ? insideMiter : on ? flatAt(0) : other ? outsideMiter : flatAt(0);
    lip(b, 0, n, cut, R, end);
  }
  return b.build();
}

/** Turn a direction mask by `k` quarter turns (+x toward +z). */
function rotateMask(mask: number, k: number): number {
  return ((mask << k) | (mask >> (4 - k))) & 0b1111;
}

/** Which joint shape a grid point's direction mask needs, and how many quarter turns (+x toward +z) to place it. */
export function jointShapeOf(mask: number): { shape: JointShape; turns: number } | null {
  if (mask === 0) return null;
  for (const [shape, canonical] of Object.entries(JOINT_SHAPES) as [JointShape, number][]) {
    for (let k = 0; k < 4; k++) {
      if (rotateMask(canonical, k) === mask) return { shape, turns: k };
    }
  }
  return null;
}

/** Yaw (Three.js, about +y) that turns +x toward +z by `turns` quarter turns. */
export function yawOfTurns(turns: number): number {
  return (-turns * Math.PI) / 2;
}
