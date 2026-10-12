import { RepeatWrapping, type DataTexture } from 'three';
import { WALL_PROFILE } from '../build/WallGeometry';
import {
  blob,
  BRICK,
  Canvas,
  crack,
  CRACK,
  MORTAR,
  periodicNoise,
  PLASTER,
  PLASTER_FRESH,
  SCRATCH_COAT,
  smoothstep,
  STAIN,
  toTexture,
  type RGB,
} from '../build/WallTextures';
import { config } from '../core/config';
import { createRandom } from '../world/random';
import { DAMAGE_VARIANTS, DamageState } from './DamageState';
import { wallDamageLayout, type WallDamageLayout } from './WallDamageLayouts';

/*
 * Damage overlays for wall faces, in the chipped plaster-over-brick look of FPS-Model(3).jpeg: plaster
 * knocked off in ragged patches down to the brick, with a lighter broken rim, a shadow under the plaster's
 * upper edge, and cracks running out of them. Breached walls lose plaster over large areas and show
 * brick all round their holes and bites.
 *
 * One tile per state, variant and face, covering a whole wall (one cell long, wall height tall) in the
 * wall's own frame, so patches line up with the holes and bites in the variant's geometry.
 * Also a tiling bare-brick texture for the broken faces themselves (hole sides, bitten tops, chipped lips).
 */

const SIZE = 256;
export const DAMAGE_COLUMNS = 4;
export const DAMAGE_ROWS = 3;
/** Atlas tile for a state, variant and face (0 for the wall's +z face, 1 for -z). */
export function damageTileOf(state: typeof DamageState.DAMAGED | typeof DamageState.BREACHED, variant: number, face: 0 | 1): number {
  return ((state === DamageState.BREACHED ? DAMAGE_VARIANTS : 0) + variant) * 2 + face;
}

const CELL = config.build.cellSize;
const { H } = WALL_PROFILE;
/** Pixels per meter along the wall and up it. */
const PX_S = SIZE / CELL;
const PX_V = SIZE / H;
/** Brick courses and brick length, in pixels; both divide the tile so the bare-brick texture repeats. */
const COURSE = 8;
const BRICK_LENGTH = 32;
const SOOT: RGB = [62, 54, 46];

const toX = (s: number): number => (s / CELL + 0.5) * SIZE;
const toY = (v: number): number => (v / H) * SIZE;

/** Brick and mortar at pixel (x, y), bricks varying in tone, every other course offset by half a brick. */
function brickAt(x: number, y: number, seed: number): RGB {
  const course = Math.floor(y / COURSE);
  const shifted = x + (course % 2) * (BRICK_LENGTH / 2);
  const brick = Math.floor(shifted / BRICK_LENGTH);
  const fy = ((y % COURSE) + COURSE) % COURSE;
  const fx = ((shifted % BRICK_LENGTH) + BRICK_LENGTH) % BRICK_LENGTH;
  if (fy === 0 || fx === 0) return MORTAR;
  const h = ((Math.imul(course * 73 + brick * 151 + seed, 2654435761) >>> 0) % 1000) / 1000;
  // Darker toward the bottom and top of each brick, like worn arrises.
  const edge = fy === 1 || fy === COURSE - 1 ? 0.88 : 1;
  const f = (0.78 + h * 0.34) * edge;
  return [BRICK[0] * f, BRICK[1] * f, BRICK[2] * f];
}

/**
 * Plaster knocked off down to the brick in a ragged patch at (s, v) with half sizes (rs, rv), in meters.
 * Recessed: a pale broken rim, then darker toward the edge and in the shadow under the plaster's top lip.
 */
function chipPatch(
  canvas: Canvas,
  noise: ReturnType<typeof periodicNoise>,
  random: () => number,
  seed: number,
  s: number,
  v: number,
  rs: number,
  rv: number,
): void {
  const cx = toX(s);
  const cy = toY(v);
  const ry = rv * PX_V;
  blob(
    canvas,
    noise,
    random,
    cx,
    cy,
    rs * PX_S,
    ry,
    (d, x, y) => {
      if (d > 1.16) return null;
      if (d > 1) return [PLASTER_FRESH, 0.9 * (1 - (d - 1) / 0.16)];
      if (d > 0.9) return [SCRATCH_COAT, 0.95];
      return [brickAt(x, y, seed), 1];
    },
    (d, y) => (d <= 1 ? 1 - smoothstep(0.55, 1, d) * 0.2 - smoothstep(-0.1, 0.9, (y - cy) / ry) * smoothstep(0.35, 1, d) * 0.4 : 1),
  );
}

/** A soft darkening around (s, v): soot and dust thrown out of a hole or a hit. */
function soot(canvas: Canvas, noise: ReturnType<typeof periodicNoise>, random: () => number, s: number, v: number, rs: number, rv: number, strength: number): void {
  blob(canvas, noise, random, toX(s), toY(v), rs * PX_S, rv * PX_V, (d) => (d > 1 ? null : [SOOT, strength * smoothstep(1, 0.3, d)]));
}

function paintDamage(layout: WallDamageLayout, breached: boolean, face: 0 | 1): Canvas {
  const seed = layout.seed * 17 + face * 977;
  const canvas = new Canvas(SIZE, SIZE, PLASTER, false, false);
  const random = createRandom(seed);
  const noise = periodicNoise(seed);
  const between = (a: number, b: number): number => a + random() * (b - a);

  // Big areas of plaster gone on breached walls, the brick behind dusty and dark.
  if (breached) {
    for (const hole of layout.holes) soot(canvas, noise, random, hole.s, hole.v, hole.rs * 2.4, hole.rv * 2, 0.45);
    for (let k = 0; k < 2; k++) {
      chipPatch(canvas, noise, random, seed, between(-0.55, 0.55), between(0.5, 2), between(0.26, 0.4), between(0.3, 0.5));
    }
  }

  // Brick round every hole (the plaster around it fell away first) and under every bite in the top.
  for (const hole of layout.holes) chipPatch(canvas, noise, random, seed, hole.s, hole.v, hole.rs * 1.5, hole.rv * 1.4);
  for (const notch of layout.notches) {
    chipPatch(canvas, noise, random, seed, notch.s, H - notch.depth * 0.5, notch.width * 0.75, notch.depth * 0.5 + 0.16);
  }
  // Lip chips leave the plaster at the foot of the wall broken too.
  for (const chip of layout.lipChips) {
    if ((chip.side === 1) !== (face === 0)) continue;
    chipPatch(canvas, noise, random, seed, (chip.s0 + chip.s1) / 2, 0.32, (chip.s1 - chip.s0) * 0.55, 0.14);
  }

  // Patches chipped out where hits landed, like the bare patch on the wall in FPS-Model(3).jpeg.
  const patches = breached ? 2 : 2 + Math.floor(random() * 2);
  for (let k = 0; k < patches; k++) {
    const rs = between(0.1, breached ? 0.24 : 0.26);
    chipPatch(canvas, noise, random, seed, between(-0.62, 0.62), between(0.55, 2.15), rs, rs * between(1, 1.6));
  }

  // Cracks spreading out of the damage.
  const cracks = breached ? 7 : 4 + Math.floor(random() * 2);
  const sources: [number, number][] = [...layout.holes.map((h): [number, number] => [h.s, h.v]), ...layout.notches.map((n): [number, number] => [n.s, H - n.depth])];
  for (let k = 0; k < cracks; k++) {
    const [s, v] = sources[k % sources.length];
    crack(canvas, random, toX(s + between(-0.3, 0.3)), toY(v + between(-0.2, 0.2)), between(40, 90));
  }

  // Shrapnel and bullet pocks.
  const pocks = breached ? 30 : 14;
  for (let k = 0; k < pocks; k++) {
    const x = between(16, SIZE - 16);
    const y = between(20, SIZE - 10);
    const r = between(0.8, 2.2);
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d <= 1) canvas.blend(x + dx, y + dy, CRACK, 0.6 * (1 - d * 0.4));
        else if (d <= 1.5 && dy > 0) canvas.blend(x + dx, y + dy, PLASTER_FRESH, 0.45);
      }
    }
  }
  // Dust settled along the foot of the wall.
  for (let y = 0; y < SIZE; y++) {
    const fade = smoothstep(0.16, 0, y / SIZE) * (breached ? 0.3 : 0.18);
    for (let x = 0; x < SIZE; x++) canvas.blend(x, y, STAIN, fade * (0.7 + noise(x / 16, y / 16, SIZE / 16) * 0.6));
  }

  // Fade out at the very ends, so damage never stops in a hard line at a joint with an intact neighbour.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x + 0.5) / SIZE;
      canvas.alpha[y * SIZE + x] *= smoothstep(0, 0.05, u) * smoothstep(1, 0.95, u);
    }
  }
  return canvas;
}

/** Every damage overlay, packed into one atlas (see `damageTileOf`). */
export function createWallDamageAtlas(): DataTexture {
  const width = SIZE * DAMAGE_COLUMNS;
  const height = SIZE * DAMAGE_ROWS;
  const data = new Uint8Array(width * height * 4);
  for (const state of [DamageState.DAMAGED, DamageState.BREACHED] as const) {
    for (let variant = 0; variant < DAMAGE_VARIANTS; variant++) {
      for (const face of [0, 1] as const) {
        const tile = damageTileOf(state, variant, face);
        const canvas = paintDamage(wallDamageLayout(state, variant), state === DamageState.BREACHED, face);
        canvas.writeTo(data, width, (tile % DAMAGE_COLUMNS) * SIZE, Math.floor(tile / DAMAGE_COLUMNS) * SIZE);
      }
    }
  }
  return toTexture(data, width, height, false);
}

/** Bare brick, one tile per cell length and wall height, repeating both ways, a little dusty and darker in the mortar. */
export function createBrickTexture(): DataTexture {
  const canvas = new Canvas(SIZE, SIZE, MORTAR, true, true);
  const noise = periodicNoise(91);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      canvas.blend(x, y, brickAt(x, y, 5), 1);
      canvas.blend(x, y, STAIN, 0.25 * noise(x / 16, y / 16, SIZE / 16));
    }
  }
  const data = new Uint8Array(SIZE * SIZE * 4);
  canvas.writeTo(data, SIZE, 0, 0);
  const texture = toTexture(data, SIZE, SIZE, true);
  texture.wrapT = RepeatWrapping;
  return texture;
}
