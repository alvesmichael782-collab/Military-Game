import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearMipmapLinearFilter,
  NearestFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { createRandom } from '../world/random';

/*
 * Procedural wall textures in the weathered plaster-over-brick style of the Game Reference images.
 *
 * The base plaster covers one wall face (one grid cell wide, wall height tall) and repeats seamlessly
 * along the wall, with rain streaks from the top and dirt splashed up from the ground. Every piece of
 * every wall samples it by world position, so it runs unbroken across neighbouring walls and joints.
 *
 * On top, each wall face gets one of several wear overlays (chipped plaster showing brick, cracks,
 * repairs, water stains, pock marks). Overlays fade out toward the wall's ends, so any two walls side by
 * side meet on plain base plaster and line up.
 */

const SIZE = 256;
/** Wear overlays in the atlas, laid out in a grid of `WEAR_COLUMNS` by `WEAR_ROWS`. */
export const WEAR_COLUMNS = 4;
export const WEAR_ROWS = 2;
export const WEAR_TILES = WEAR_COLUMNS * WEAR_ROWS;
/** How worn each overlay is, 0 (a few marks) to 1 (heavily chipped). */
const WEAR_AMOUNT = [0.25, 0.55, 1, 0.7, 0.4, 0.9, 0.6, 0.8];

export type RGB = readonly [number, number, number];
export const PLASTER: RGB = [208, 186, 144];
export const PLASTER_FRESH: RGB = [226, 210, 176];
export const PLASTER_DARK: RGB = [186, 162, 120];
export const SCRATCH_COAT: RGB = [176, 164, 140];
export const DIRT: RGB = [126, 102, 72];
export const STAIN: RGB = [112, 96, 74];
export const CRACK: RGB = [74, 60, 44];
export const BRICK: RGB = [150, 82, 58];
export const MORTAR: RGB = [168, 156, 134];

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** RGBA pixels with y up (row 0 is the bottom of the wall), blended in floats and stored as bytes at the end. */
export class Canvas {
  readonly rgb: Float32Array;
  readonly alpha: Float32Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill: RGB,
    opaque: boolean,
    private readonly wrapX: boolean,
  ) {
    this.rgb = new Float32Array(width * height * 3);
    this.alpha = new Float32Array(width * height).fill(opaque ? 1 : 0);
    for (let k = 0; k < width * height; k++) this.rgb.set(fill, k * 3);
  }

  /** Paint `color` over pixel (x, y) with opacity `a`. Off-canvas pixels wrap or are skipped. */
  blend(x: number, y: number, color: RGB, a: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (this.wrapX) x = ((x % this.width) + this.width) % this.width;
    if (a <= 0 || x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const k = y * this.width + x;
    const t = Math.min(1, a);
    for (let c = 0; c < 3; c++) this.rgb[k * 3 + c] += (color[c] - this.rgb[k * 3 + c]) * t;
    this.alpha[k] += (1 - this.alpha[k]) * t;
  }

  /** Scale the color at (x, y) by `f`, keeping its opacity. */
  shade(x: number, y: number, f: number): void {
    const k = y * this.width + x;
    for (let c = 0; c < 3; c++) this.rgb[k * 3 + c] *= f;
  }

  /** Copy into `out` (a wider atlas) at pixel offset (ox, oy). */
  writeTo(out: Uint8Array, outWidth: number, ox: number, oy: number): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const k = y * this.width + x;
        const o = ((oy + y) * outWidth + ox + x) * 4;
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(Math.min(255, Math.max(0, this.rgb[k * 3 + c])));
        out[o + 3] = Math.round(clamp01(this.alpha[k]) * 255);
      }
    }
  }
}

/** Smooth value noise that repeats every `period` lattice cells along x. Returns 0..1. */
export function periodicNoise(seed: number): (x: number, y: number, period: number) => number {
  const hash = (i: number, j: number): number => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y, period) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const i0 = ((i % period) + period) % period;
    const i1 = (i0 + 1) % period;
    const a = hash(i0, j) + (hash(i1, j) - hash(i0, j)) * u;
    const b = hash(i0, j + 1) + (hash(i1, j + 1) - hash(i0, j + 1)) * u;
    return a + (b - a) * v;
  };
}

/** A few octaves of periodic noise over the canvas, repeating once across its width. Returns about 0..1. */
export function fbm(noise: ReturnType<typeof periodicNoise>, x: number, y: number, size: number): number {
  let sum = 0;
  let weight = 0;
  for (let octave = 0, cells = 4, amp = 1; octave < 4; octave++, cells *= 2, amp *= 0.5) {
    sum += noise((x / size) * cells, (y / size) * cells + octave * 17, cells) * amp;
    weight += amp;
  }
  return sum / weight;
}

/**
 * Pixels to a world texture: sRGB, mipmapped, and magnified with nearest filtering for the crisp, slightly
 * crunchy texels of the era. `repeatY` defaults to clamped.
 */
export function toTexture(data: Uint8Array, width: number, height: number, repeatX: boolean, repeatY = false): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = repeatX ? RepeatWrapping : ClampToEdgeWrapping;
  texture.wrapT = repeatY ? RepeatWrapping : ClampToEdgeWrapping;
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Weathered base plaster for one wall face, repeating along the wall. */
export function createWallBaseTexture(): DataTexture {
  const canvas = new Canvas(SIZE, SIZE, PLASTER, true, true);
  const noise = periodicNoise(7);
  const random = createRandom(4021);

  for (let y = 0; y < SIZE; y++) {
    const v = (y + 0.5) / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const mottle = fbm(noise, x, y, SIZE);
      const grain = (random() - 0.5) * 0.05;
      canvas.shade(x, y, 1 + (mottle - 0.5) * 0.16 + grain);
      // Dirt splashed up from the ground, with a ragged top edge.
      const ragged = fbm(noise, x * 2, y + 300, SIZE);
      const dirt = smoothstep(0.24, 0.02, v + (ragged - 0.5) * 0.12);
      canvas.blend(x, y, DIRT, dirt * 0.6);
      // A darker lip of grime along the top, where dust and rain sit.
      canvas.blend(x, y, STAIN, smoothstep(0.95, 1, v) * 0.35);
    }
  }

  // Rain streaks running down from the top.
  for (let k = 0; k < 22; k++) {
    const x0 = random() * SIZE;
    const width = 1.5 + random() * 4;
    const length = (0.12 + random() * 0.5) * SIZE;
    const strength = 0.05 + random() * 0.13;
    const wobble = random() * 6.28;
    for (let t = 0; t < length; t++) {
      const y = SIZE - 1 - t;
      const fade = Math.pow(1 - t / length, 1.4);
      const cx = x0 + Math.sin(wobble + t * 0.05) * 1.2;
      for (let dx = -width; dx <= width; dx++) {
        const edge = 1 - Math.abs(dx) / (width + 0.5);
        canvas.blend(cx + dx, y, STAIN, strength * fade * edge * (0.75 + random() * 0.25));
      }
    }
  }

  const data = new Uint8Array(SIZE * SIZE * 4);
  canvas.writeTo(data, SIZE, 0, 0);
  return toTexture(data, SIZE, SIZE, true);
}

/** All wear overlays, packed into one atlas of `WEAR_COLUMNS` x `WEAR_ROWS` tiles. */
export function createWallWearAtlas(): DataTexture {
  const width = SIZE * WEAR_COLUMNS;
  const height = SIZE * WEAR_ROWS;
  const data = new Uint8Array(width * height * 4);
  for (let tile = 0; tile < WEAR_TILES; tile++) {
    const canvas = paintWear(WEAR_AMOUNT[tile], 9001 + tile * 131);
    canvas.writeTo(data, width, (tile % WEAR_COLUMNS) * SIZE, Math.floor(tile / WEAR_COLUMNS) * SIZE);
  }
  return toTexture(data, width, height, false);
}

/** One wear overlay: transparent where the base plaster shows, fading out at every edge. */
function paintWear(amount: number, seed: number): Canvas {
  const canvas = new Canvas(SIZE, SIZE, PLASTER, false, false);
  const random = createRandom(seed);
  const noise = periodicNoise(seed);
  const between = (a: number, b: number): number => a + random() * (b - a);

  // Water stains first, so everything else sits over them: soft, taller than wide, running down.
  for (let k = Math.round(between(0.5, 1.5 + amount)); k > 0; k--) {
    const fromTop = random() < 0.65;
    const ry = between(34, 70);
    blob(canvas, noise, random, between(64, 192), fromTop ? SIZE - ry * 0.6 : between(40, 100), between(16, 34), ry, (d) =>
      d > 1 ? null : [STAIN, 0.2 * smoothstep(1, 0.5, d) + 0.06 * smoothstep(0.75, 0.95, d) * smoothstep(1, 0.95, d)],
    );
  }

  // Patched repairs: plaster in a slightly different tone.
  for (let k = Math.round(between(0, 2)); k > 0; k--) {
    const tone = random() < 0.5 ? PLASTER_FRESH : PLASTER_DARK;
    blob(canvas, noise, random, between(60, 196), between(60, 200), between(18, 34), between(14, 28), (d) =>
      d > 1 ? null : [tone, 0.65 * smoothstep(1, 0.85, d)],
    );
  }

  // Plaster knocked off down to the scratch coat, and deeper chips down to the brick.
  for (let k = Math.round(amount * 1.3 + random() * 0.8); k > 0; k--) {
    const brick = random() < 0.4 + amount * 0.5;
    const cx = between(76, 180);
    const cy = between(60, 200);
    const rx = between(10, 16 + 24 * amount);
    const ry = rx * between(0.8, 1.7);
    blob(
      canvas,
      noise,
      random,
      cx,
      cy,
      rx,
      ry,
      (d, x, y) => {
        if (d > 1.14) return null;
        if (d > 1) return [PLASTER_FRESH, 0.85 * (1 - (d - 1) / 0.14)];
        if (!brick || d > 0.8) return [SCRATCH_COAT, 0.95];
        return [brickAt(x, y, seed), 1];
      },
      // Recessed: darker toward the rim, most of all in the shadow under the plaster's top edge.
      (d, y) => (d <= 1 ? 1 - smoothstep(0.5, 1, d) * 0.18 - smoothstep(-0.2, 0.9, (y - cy) / ry) * smoothstep(0.3, 1, d) * 0.35 : 1),
    );
  }

  // Hairline cracks wandering down and across.
  for (let k = Math.round(1 + amount * 3 * random() + amount); k > 0; k--) {
    crack(canvas, random, between(50, 206), between(60, 230), between(30, 90));
  }

  // Pock marks and scuffs.
  for (let k = Math.round(3 + amount * 12 * random()); k > 0; k--) {
    const x = between(30, 226);
    const y = between(30, 236);
    const r = between(0.8, 2.6);
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d <= 1) canvas.blend(x + dx, y + dy, CRACK, 0.55 * (1 - d * 0.4));
        else if (d <= 1.5 && dy > 0) canvas.blend(x + dx, y + dy, PLASTER_FRESH, 0.5);
      }
    }
  }

  // Fade to nothing toward every edge, so neighbouring walls always meet on base plaster.
  for (let y = 0; y < SIZE; y++) {
    const v = (y + 0.5) / SIZE;
    const fy = smoothstep(0, 0.06, v) * smoothstep(1, 0.95, v);
    for (let x = 0; x < SIZE; x++) {
      const u = (x + 0.5) / SIZE;
      canvas.alpha[y * SIZE + x] *= fy * smoothstep(0, 0.16, u) * smoothstep(1, 0.84, u);
    }
  }
  return canvas;
}

/**
 * An irregular blob around (cx, cy) with radii (rx, ry). `paint` gets each pixel's normalized distance
 * from the center (1 at the ragged edge) and returns what to paint there, if anything; `shade` darkens it.
 */
export function blob(
  canvas: Canvas,
  noise: ReturnType<typeof periodicNoise>,
  random: () => number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  paint: (d: number, x: number, y: number) => [RGB, number] | null,
  shade?: (d: number, y: number) => number,
): void {
  const offset = random() * 100;
  for (let y = Math.floor(cy - ry * 1.5); y <= cy + ry * 1.5; y++) {
    for (let x = Math.floor(cx - rx * 1.5); x <= cx + rx * 1.5; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const angle = Math.atan2(dy, dx);
      const around = (angle + Math.PI) / (2 * Math.PI);
      // Big lobes, then smaller bites, then a jagged fringe.
      const ragged =
        0.55 + 0.55 * noise(around * 7, offset, 7) + 0.3 * noise(around * 19, offset + 5, 19) + 0.16 * noise(around * 53, offset + 9, 53);
      const d = Math.hypot(dx, dy) / ragged;
      const result = paint(d, x, y);
      if (!result) continue;
      canvas.blend(x, y, result[0], result[1]);
      if (shade && x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) canvas.shade(x, y, shade(d, y));
    }
  }
}

/** Brick and mortar color at pixel (x, y): courses 7 px tall, bricks 24 px long, every other course offset. */
export function brickAt(x: number, y: number, seed: number): RGB {
  const course = Math.floor(y / 7);
  const shifted = x + (course % 2) * 12;
  const brick = Math.floor(shifted / 24);
  if (y % 7 === 0 || shifted % 24 === 0) return MORTAR;
  const h = ((Math.imul(course * 73 + brick * 151 + seed, 2654435761) >>> 0) % 1000) / 1000;
  const f = 0.82 + h * 0.3;
  return [BRICK[0] * f, BRICK[1] * f, BRICK[2] * f];
}

/** A one-pixel crack wandering mostly downward from (x, y), with a faint light edge and the odd branch. */
export function crack(canvas: Canvas, random: () => number, x: number, y: number, length: number, depth = 0): void {
  let angle = -Math.PI / 2 + (random() - 0.5) * 1.6;
  for (let t = 0; t < length; t++) {
    angle += (random() - 0.5) * 0.7;
    angle = Math.min(-0.15, Math.max(-Math.PI + 0.15, angle));
    x += Math.cos(angle);
    y += Math.sin(angle);
    const a = 0.75 * (1 - t / (length * 1.3));
    canvas.blend(x, y, CRACK, a);
    canvas.blend(x + 1, y + 1, PLASTER_FRESH, a * 0.35);
    if (depth < 1 && random() < 0.025) crack(canvas, random, x, y, length * 0.4, depth + 1);
  }
}
