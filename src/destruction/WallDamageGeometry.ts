import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { shade, WALL_BROKEN_ATTRIBUTE, WALL_PROFILE } from '../build/WallGeometry';
import type { DamageState } from './DamageState';
import { SEGMENT_HALF, wallDamageLayout, type LipChip, type Point, type WallDamageLayout } from './WallDamageLayouts';

/*
 * The middle segment of a damaged or breached wall, in the same frame and cross-section as the intact
 * one (see build/WallGeometry): the upright is its ragged outline (chipped top, holes) pushed through the
 * wall's thickness, and the lips run along each side, broken down where the layout chips them. The ends
 * match the intact segment exactly, so the wall's arms and its neighbours still meet it cleanly.
 *
 * Faces where the wall broke (hole sides, bitten tops, chipped lips) carry the `wallBroken` flag and are
 * drawn as bare brick. Every face is cut at the heights where the fake ambient occlusion changes slope,
 * so the vertex shading matches the intact wall's.
 */

const { T, R, H, LIP, BEVEL, AO_SPLIT } = WALL_PROFILE;
/** Heights where the vertex shading changes slope. */
const SHADE_CUTS = [LIP, AO_SPLIT];
/** Broken faces sit in shadow inside the wall. */
const HOLE_SHADE = 0.7;
const BITE_SHADE = 0.86;
/** Length of the slope from a full lip down into a chip, in meters. */
const CHIP_RAMP = 0.05;

type V3 = [number, number, number];

class Builder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly broken: number[] = [];

  /** A convex planar polygon facing `hint`, cut at the shading heights. */
  face(points: V3[], hint: V3, opts: { lip?: boolean; broken?: boolean; shade?: number } = {}): void {
    let pieces: V3[][] = [points];
    for (const cut of SHADE_CUTS) pieces = pieces.flatMap((p) => splitAtY(p, cut));
    for (const piece of pieces) {
      if (piece.length < 3) continue;
      for (let k = 1; k < piece.length - 1; k++) this.triangle(piece[0], piece[k], piece[k + 1], hint, opts);
    }
  }

  private triangle(a: V3, b: V3, c: V3, hint: V3, opts: { lip?: boolean; broken?: boolean; shade?: number }): void {
    const n = cross(sub(b, a), sub(c, a));
    const area = Math.hypot(n[0], n[1], n[2]);
    if (area < 1e-9) return;
    const tri = dot(n, hint) < 0 ? [a, c, b] : [a, b, c];
    for (const p of tri) {
      this.positions.push(p[0], p[1], p[2]);
      const s = shade(p[1], opts.lip ?? false) * (opts.shade ?? 1);
      this.colors.push(s, s, s);
      this.broken.push(opts.broken ? 1 : 0);
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute(WALL_BROKEN_ATTRIBUTE, new Float32BufferAttribute(this.broken, 1));
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

/** Cut a convex polygon by the plane y = `cut` into the part below and the part above (either may be empty). */
function splitAtY(points: V3[], cut: number): V3[][] {
  const below: V3[] = [];
  const above: V3[] = [];
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    const q = points[(k + 1) % points.length];
    if (p[1] <= cut + 1e-6) below.push(p);
    if (p[1] >= cut - 1e-6) above.push(p);
    // The edge crosses the cut: both halves get the crossing point.
    if ((p[1] < cut - 1e-6 && q[1] > cut + 1e-6) || (p[1] > cut + 1e-6 && q[1] < cut - 1e-6)) {
      const t = (cut - p[1]) / (q[1] - p[1]);
      const x: V3 = [p[0] + (q[0] - p[0]) * t, cut, p[2] + (q[2] - p[2]) * t];
      below.push(x);
      above.push(x);
    }
  }
  return [below, above].filter((piece) => piece.length >= 3);
}

/** The upright: both faces with holes, the ragged top, and the sides of every hole. */
function upright(b: Builder, layout: WallDamageLayout): void {
  // Counter-clockwise in (s, v): along the bottom, up the far end, back along the top, down the near end.
  const outline: Point[] = [[-SEGMENT_HALF, 0], [SEGMENT_HALF, 0], ...[...layout.top].reverse()];
  const holes = layout.holeOutlines;
  const triangles = ShapeUtils.triangulateShape(
    outline.map(([s, v]) => new Vector2(s, v)),
    holes.map((hole) => hole.map(([s, v]) => new Vector2(s, v))),
  );
  const all: Point[] = [...outline, ...holes.flat()];
  for (const side of [1, -1]) {
    for (const [i, j, k] of triangles) {
      const pts = [all[i], all[j], all[k]].map(([s, v]): V3 => [s, v, side * T]);
      b.face(pts, [0, 0, side]);
    }
  }

  // The top, from the far end back to the near end: flat runs are the wall's top, the rest is broken.
  const top = [...layout.top].reverse();
  for (let k = 0; k < top.length - 1; k++) {
    const flat = top[k][1] >= H - 1e-6 && top[k + 1][1] >= H - 1e-6;
    edgeFace(b, top[k], top[k + 1], { broken: !flat, shade: flat ? 1 : BITE_SHADE });
  }
  for (const hole of holes) {
    for (let k = 0; k < hole.length; k++) edgeFace(b, hole[k], hole[(k + 1) % hole.length], { broken: true, shade: HOLE_SHADE });
  }
}

/** The face through the wall's thickness along outline edge p -> q, facing out of the solid (to the right of travel). */
function edgeFace(b: Builder, p: Point, q: Point, opts: { broken: boolean; shade: number }): void {
  const ds = q[0] - p[0];
  const dv = q[1] - p[1];
  b.face(
    [
      [p[0], p[1], -T],
      [q[0], q[1], -T],
      [q[0], q[1], T],
      [p[0], p[1], T],
    ],
    [dv, -ds, 0],
    opts,
  );
}

/** Lip height along one side: full height, dipping into each chip with a ragged floor. Returns (s, height, broken) samples. */
function lipProfile(chips: readonly LipChip[], seed: number): [number, number, boolean][] {
  const samples: [number, number, boolean][] = [[-SEGMENT_HALF, LIP, false]];
  let k = seed;
  const jitter = (): number => {
    k = (k * 1103515245 + 12345) & 0x7fffffff;
    return k / 0x7fffffff;
  };
  for (const chip of [...chips].sort((a, c) => a.s0 - c.s0)) {
    const s0 = Math.max(-SEGMENT_HALF + 0.02, chip.s0);
    const s1 = Math.min(SEGMENT_HALF - 0.02, chip.s1);
    samples.push([s0, LIP, false]);
    const inner = 3;
    for (let n = 0; n <= inner; n++) {
      const s = s0 + CHIP_RAMP + ((s1 - s0 - CHIP_RAMP * 2) * n) / inner;
      samples.push([s, Math.max(BEVEL + 0.02, chip.height * (0.75 + jitter() * 0.5)), true]);
    }
    samples.push([s1, LIP, true]);
  }
  samples.push([SEGMENT_HALF, LIP, false]);
  return samples;
}

/** One lip (side +1 is +z), following its height profile. */
function lip(b: Builder, side: 1 | -1, chips: readonly LipChip[], seed: number): void {
  const samples = lipProfile(
    chips.filter((c) => c.side === side),
    seed,
  );
  const z = (u: number): number => side * u;
  for (let k = 0; k < samples.length - 1; k++) {
    const [s0, h0] = samples[k];
    const [s1, h1, broken] = samples[k + 1];
    if (s1 - s0 < 1e-5) continue;
    const opts = { lip: true, broken };
    // Top, bevel, outer face: the intact lip's cross-section, at this stretch's heights.
    b.face([[s0, h0, z(T)], [s0, h0, z(R - BEVEL)], [s1, h1, z(R - BEVEL)], [s1, h1, z(T)]], [0, 1, 0], opts);
    b.face([[s0, h0, z(R - BEVEL)], [s0, h0 - BEVEL, z(R)], [s1, h1 - BEVEL, z(R)], [s1, h1, z(R - BEVEL)]], [0, 1, side], opts);
    b.face([[s0, h0 - BEVEL, z(R)], [s0, 0, z(R)], [s1, 0, z(R)], [s1, h1 - BEVEL, z(R)]], [0, 0, side], { lip: true });
  }
}

const cache = new Map<string, BufferGeometry>();

/** The middle segment of a damaged or breached wall in the given variant. Built once per variant and shared. */
export function damagedSegmentGeometry(state: typeof DamageState.DAMAGED | typeof DamageState.BREACHED, variant: number): BufferGeometry {
  const key = `${state}-${variant}`;
  let geometry = cache.get(key);
  if (!geometry) {
    const layout = wallDamageLayout(state, variant);
    const b = new Builder();
    upright(b, layout);
    lip(b, 1, layout.lipChips, layout.seed);
    lip(b, -1, layout.lipChips, layout.seed + 7);
    geometry = b.build();
    cache.set(key, geometry);
  }
  return geometry;
}
