import { WALL_PROFILE } from '../build/WallGeometry';
import { config } from '../core/config';
import { createRandom } from '../world/random';
import { DAMAGE_VARIANTS, DamageState } from './DamageState';

/*
 * Where a damaged or breached wall is broken, in the wall's own frame: `s` runs along the wall from its
 * middle (meters, -1..1 for a 2 m cell), `v` is the height above the ground. Only the middle segment of
 * a wall changes shape (it spans |s| <= SEGMENT_HALF); the arms at each end keep their shape so joints
 * always meet their neighbours cleanly. The same layout drives the segment's geometry, its damage
 * texture and, for breached walls, the gaps in its bullet collider.
 */

const { H } = WALL_PROFILE;
/** Half the length of a wall's middle segment: a cell minus a joint at each end. */
export const SEGMENT_HALF = config.build.cellSize / 2 - WALL_PROFILE.R;

export type Point = [s: number, v: number];

/** A bite out of the top of the upright: centered at `s`, `width` wide, `depth` deep. */
export interface TopNotch {
  s: number;
  width: number;
  depth: number;
}

/** A ragged hole right through the upright, centered at (s, v) with half sizes (rs, rv). */
export interface Hole {
  s: number;
  v: number;
  rs: number;
  rv: number;
}

/** A stretch of one lip broken down to `height`. `side` is +1 for the lip on the wall's +z face, -1 for -z. */
export interface LipChip {
  side: 1 | -1;
  s0: number;
  s1: number;
  height: number;
}

export interface WallDamageLayout {
  readonly seed: number;
  readonly notches: readonly TopNotch[];
  readonly holes: readonly Hole[];
  readonly lipChips: readonly LipChip[];
  /** Top edge of the upright from s = -SEGMENT_HALF to +SEGMENT_HALF, ragged where notches bite in. */
  readonly top: readonly Point[];
  /** Each hole as a ragged closed outline, clockwise in (s, v). */
  readonly holeOutlines: readonly (readonly Point[])[];
}

/** Hand-placed layouts per variant, so every one reads clearly at a glance and none overlap badly. */
const DAMAGED: Omit<WallDamageLayout, 'top' | 'holeOutlines'>[] = [
  {
    seed: 101,
    notches: [
      { s: -0.3, width: 0.3, depth: 0.13 },
      { s: 0.27, width: 0.2, depth: 0.08 },
    ],
    holes: [],
    lipChips: [{ side: 1, s0: 0.1, s1: 0.34, height: 0.15 }],
  },
  {
    seed: 202,
    notches: [{ s: 0.05, width: 0.38, depth: 0.19 }],
    holes: [],
    lipChips: [{ side: -1, s0: -0.42, s1: -0.2, height: 0.16 }],
  },
  {
    seed: 303,
    notches: [
      { s: -0.4, width: 0.16, depth: 0.08 },
      { s: -0.06, width: 0.24, depth: 0.11 },
      { s: 0.37, width: 0.2, depth: 0.15 },
    ],
    holes: [],
    lipChips: [],
  },
];

const BREACHED: Omit<WallDamageLayout, 'top' | 'holeOutlines'>[] = [
  {
    seed: 404,
    notches: [
      { s: -0.36, width: 0.3, depth: 0.24 },
      { s: 0.3, width: 0.28, depth: 0.17 },
    ],
    holes: [{ s: 0.02, v: 1.32, rs: 0.34, rv: 0.48 }],
    lipChips: [
      { side: 1, s0: -0.46, s1: -0.08, height: 0.09 },
      { side: -1, s0: 0.08, s1: 0.42, height: 0.11 },
    ],
  },
  {
    seed: 505,
    notches: [{ s: -0.05, width: 0.36, depth: 0.22 }],
    holes: [
      { s: -0.24, v: 0.86, rs: 0.22, rv: 0.28 },
      { s: 0.23, v: 1.72, rs: 0.23, rv: 0.3 },
    ],
    lipChips: [
      { side: -1, s0: -0.5, s1: -0.16, height: 0.08 },
      { side: 1, s0: 0.18, s1: 0.5, height: 0.1 },
    ],
  },
  {
    seed: 606,
    // A big bite out of the top, plus a low hole beside it.
    notches: [{ s: 0.14, width: 0.68, depth: 0.92 }],
    holes: [{ s: -0.27, v: 0.84, rs: 0.2, rv: 0.25 }],
    lipChips: [
      { side: 1, s0: -0.34, s1: 0.22, height: 0.09 },
      { side: -1, s0: 0.2, s1: 0.5, height: 0.12 },
    ],
  },
];

/** The ragged top edge: flat at full height, with jagged bites where the notches are. */
function topEdge(notches: readonly TopNotch[], random: () => number): Point[] {
  const points: Point[] = [[-SEGMENT_HALF, H]];
  for (const n of [...notches].sort((a, b) => a.s - b.s)) {
    const left = n.s - n.width / 2;
    const right = n.s + n.width / 2;
    // Broken edges step down unevenly: a shoulder, the deepest point off center, a second shoulder.
    const steps: [number, number][] = [
      [0, 0],
      [0.14 + random() * 0.08, 0.35 + random() * 0.25],
      [0.36 + random() * 0.08, 0.85 + random() * 0.15],
      [0.55 + random() * 0.08, 1],
      [0.74 + random() * 0.08, 0.55 + random() * 0.25],
      [0.9, 0.2 + random() * 0.2],
      [1, 0],
    ];
    for (const [t, d] of steps) points.push([left + (right - left) * t, H - n.depth * d]);
  }
  points.push([SEGMENT_HALF, H]);
  return points;
}

/** A hole's ragged outline, clockwise in (s, v) so the solid wall is on the left walking around it. */
function holeOutline(hole: Hole, random: () => number): Point[] {
  const count = 14;
  const points: Point[] = [];
  const phase = random() * Math.PI * 2;
  for (let k = 0; k < count; k++) {
    // Clockwise: decreasing angle.
    const a = phase - ((k + (random() - 0.5) * 0.4) / count) * Math.PI * 2;
    // Alternate deeper bites and jutting bricks for a broken, not round, edge.
    const r = (k % 2 === 0 ? 0.92 : 0.78) + random() * 0.2;
    points.push([hole.s + Math.cos(a) * hole.rs * r, hole.v + Math.sin(a) * hole.rv * r]);
  }
  return points;
}

function complete(base: Omit<WallDamageLayout, 'top' | 'holeOutlines'>): WallDamageLayout {
  const random = createRandom(base.seed);
  return { ...base, top: topEdge(base.notches, random), holeOutlines: base.holes.map((h) => holeOutline(h, random)) };
}

const layouts = {
  damaged: DAMAGED.map(complete),
  breached: BREACHED.map(complete),
};

/** The layout for a damaged or breached wall's variant. */
export function wallDamageLayout(state: typeof DamageState.DAMAGED | typeof DamageState.BREACHED, variant: number): WallDamageLayout {
  return layouts[state][variant % DAMAGE_VARIANTS];
}

/** A rectangle in the wall's (s, v) plane. */
export interface Rect {
  s0: number;
  s1: number;
  v0: number;
  v1: number;
}

/**
 * Where bullets and grenades pass through a breached wall: each hole's box shrunk by
 * `holeColliderScale` (the ragged rim stays solid), and deep top bites open to the sky.
 */
export function wallOpenings(layout: WallDamageLayout): Rect[] {
  const scale = config.destruction.holeColliderScale;
  const rects: Rect[] = layout.holes.map((h) => ({
    s0: h.s - h.rs * scale,
    s1: h.s + h.rs * scale,
    v0: h.v - h.rv * scale,
    v1: h.v + h.rv * scale,
  }));
  for (const n of layout.notches) {
    // Shallow chips are not worth a gap; deep bites are.
    if (n.depth < 0.3) continue;
    rects.push({ s0: n.s - (n.width / 2) * scale, s1: n.s + (n.width / 2) * scale, v0: H - n.depth * scale, v1: H + 0.01 });
  }
  return rects;
}

/**
 * Split the rectangle s0..s1 by v0..v1 into solid boxes around the `openings`: cut it into a grid at
 * every opening edge, keep the cells outside every opening, then merge them into as few boxes as possible.
 */
export function solidBoxes(openings: readonly Rect[], s0: number, s1: number, v0: number, v1: number): Rect[] {
  const clampS = (x: number): number => Math.min(s1, Math.max(s0, x));
  const clampV = (x: number): number => Math.min(v1, Math.max(v0, x));
  const xs = [...new Set([s0, s1, ...openings.flatMap((r) => [clampS(r.s0), clampS(r.s1)])])].sort((a, b) => a - b);
  const ys = [...new Set([v0, v1, ...openings.flatMap((r) => [clampV(r.v0), clampV(r.v1)])])].sort((a, b) => a - b);
  const open = (s: number, v: number): boolean => openings.some((r) => s > r.s0 && s < r.s1 && v > r.v0 && v < r.v1);

  // Runs of solid cells along each row.
  const rows: Rect[][] = [];
  for (let y = 0; y < ys.length - 1; y++) {
    const runs: Rect[] = [];
    const vm = (ys[y] + ys[y + 1]) / 2;
    for (let x = 0; x < xs.length - 1; x++) {
      if (xs[x + 1] - xs[x] < 1e-4 || open((xs[x] + xs[x + 1]) / 2, vm)) continue;
      const last = runs[runs.length - 1];
      if (last && Math.abs(last.s1 - xs[x]) < 1e-6) last.s1 = xs[x + 1];
      else runs.push({ s0: xs[x], s1: xs[x + 1], v0: ys[y], v1: ys[y + 1] });
    }
    rows.push(runs);
  }
  // Stack runs with the same span from one row to the next.
  const boxes: Rect[] = [];
  let previous: Rect[] = [];
  for (const runs of rows) {
    const next: Rect[] = [];
    for (const run of runs) {
      const below = previous.find((b) => Math.abs(b.s0 - run.s0) < 1e-6 && Math.abs(b.s1 - run.s1) < 1e-6 && Math.abs(b.v1 - run.v0) < 1e-6);
      if (below) {
        below.v1 = run.v1;
        next.push(below);
      } else {
        boxes.push(run);
        next.push(run);
      }
    }
    previous = next;
  }
  return boxes.filter((b) => b.v1 - b.v0 > 1e-4);
}
