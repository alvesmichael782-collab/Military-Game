import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { createRandom } from './random';

/*
 * Small toolkit for the procedural world textures (props, ground, sky dressing): a float pixel buffer that wraps
 * on both axes, tileable noise, and the step to a texture with the era's crunchy look (mipmaps for distance,
 * nearest filtering up close). Everything is painted at load with a fixed seed, so it looks the same every run.
 */

export type RGB = readonly [number, number, number];

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];

/** RGBA pixels as floats (0..255 color, 0..1 alpha), row 0 at the top. Drawing off the edge wraps around. */
export class Pixels {
  readonly rgb: Float32Array;
  readonly alpha: Float32Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill: RGB,
    opaque = true,
  ) {
    this.rgb = new Float32Array(width * height * 3);
    this.alpha = new Float32Array(width * height).fill(opaque ? 1 : 0);
    for (let k = 0; k < width * height; k++) this.rgb.set(fill, k * 3);
  }

  private index(x: number, y: number): number {
    const w = this.width;
    const h = this.height;
    const xi = ((Math.floor(x) % w) + w) % w;
    const yi = ((Math.floor(y) % h) + h) % h;
    return yi * w + xi;
  }

  /** Paint `color` over pixel (x, y) with opacity `a`. */
  blend(x: number, y: number, color: RGB, a: number): void {
    if (a <= 0) return;
    const k = this.index(x, y);
    const t = Math.min(1, a);
    for (let c = 0; c < 3; c++) this.rgb[k * 3 + c] += (color[c] - this.rgb[k * 3 + c]) * t;
    this.alpha[k] += (1 - this.alpha[k]) * t;
  }

  /** Scale the color at (x, y) by `f`. */
  shade(x: number, y: number, f: number): void {
    const k = this.index(x, y);
    for (let c = 0; c < 3; c++) this.rgb[k * 3 + c] *= f;
  }

  set(x: number, y: number, color: RGB, a = 1): void {
    const k = this.index(x, y);
    this.rgb.set(color, k * 3);
    this.alpha[k] = a;
  }

  get(x: number, y: number): RGB {
    const k = this.index(x, y);
    return [this.rgb[k * 3], this.rgb[k * 3 + 1], this.rgb[k * 3 + 2]];
  }

  /** Run `fn` on every pixel with its coordinates; it returns a shade factor (1 keeps the color). */
  shadeAll(fn: (x: number, y: number) => number): void {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) this.shade(x, y, fn(x, y));
  }

  /** Filled rectangle, wrapping. */
  rect(x0: number, y0: number, w: number, h: number, color: RGB, a = 1): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.blend(x, y, color, a);
  }

  /** A soft-edged ellipse. `edge` is the fraction of the radius that fades. */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: RGB, a: number, edge = 0.3): void {
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
      for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
        if (d < 1) this.blend(x, y, color, a * smoothstep(1, 1 - edge, d));
      }
    }
  }

  /** A line one pixel wide from (x0, y0) to (x1, y1). */
  line(x0: number, y0: number, x1: number, y1: number, color: RGB, a: number, width = 1): void {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let w = 0; w < width; w++) this.blend(x + w, y, color, a);
    }
  }

  /** Into a canvas, for drawing text or shapes on top with the 2D API. */
  toCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    const image = ctx.createImageData(this.width, this.height);
    for (let k = 0; k < this.width * this.height; k++) {
      for (let c = 0; c < 3; c++) image.data[k * 4 + c] = Math.round(Math.min(255, Math.max(0, this.rgb[k * 3 + c])));
      image.data[k * 4 + 3] = Math.round(clamp01(this.alpha[k]) * 255);
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }
}

/** Value noise that tiles every `period` lattice cells on both axes. Returns 0..1. */
export function tileNoise(seed: number): (x: number, y: number, period: number) => number {
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
    const j0 = ((j % period) + period) % period;
    const i1 = (i0 + 1) % period;
    const j1 = (j0 + 1) % period;
    const a = hash(i0, j0) + (hash(i1, j0) - hash(i0, j0)) * u;
    const b = hash(i0, j1) + (hash(i1, j1) - hash(i0, j1)) * u;
    return a + (b - a) * v;
  };
}

/** Octaves of tileable noise over a `size` pixel square, starting at `cells` lattice cells across. About 0..1. */
export function tileFbm(noise: ReturnType<typeof tileNoise>, x: number, y: number, size: number, cells = 4, octaves = 4): number {
  let sum = 0;
  let weight = 0;
  for (let o = 0, c = cells, amp = 1; o < octaves; o++, c *= 2, amp *= 0.5) {
    sum += noise((x / size) * c + o * 31, (y / size) * c + o * 17, c) * amp;
    weight += amp;
  }
  return sum / weight;
}

/** Seeded random helpers for painters. */
export function painterRandom(seed: number): { random: () => number; between: (a: number, b: number) => number } {
  const random = createRandom(seed);
  return { random, between: (a, b) => a + random() * (b - a) };
}

/**
 * A world texture from a painted canvas: sRGB, mipmapped for distance, nearest filtering up close.
 * Repeats on both axes unless `clamp` is set.
 */
export function worldTexture(source: Pixels | HTMLCanvasElement, clamp = false): CanvasTexture {
  const canvas = source instanceof Pixels ? source.toCanvas() : source;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = clamp ? ClampToEdgeWrapping : RepeatWrapping;
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}

/** The 2D context of a canvas made by `Pixels.toCanvas`. */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

/**
 * Stenciled text: bold condensed capitals with the thin vertical bridges a cut stencil leaves.
 * Drawn with the 2D API at (x, y) baseline-centered, in `color` at `alpha`.
 */
export function stencilText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  height: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `700 ${height}px Oswald, "Arial Narrow", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Paint the letters on their own layer so the bridges cut only them.
  const layer = document.createElement('canvas');
  layer.width = ctx.canvas.width;
  layer.height = ctx.canvas.height;
  const l = context2d(layer);
  l.fillStyle = color;
  l.font = ctx.font;
  l.textAlign = 'center';
  l.textBaseline = 'middle';
  l.fillText(text, x, y);
  const width = l.measureText(text).width;
  l.globalCompositeOperation = 'destination-out';
  const letter = width / Math.max(1, text.length);
  for (let k = 0; k < text.length; k++) {
    const cx = x - width / 2 + letter * (k + 0.5);
    l.fillRect(Math.round(cx - height * 0.03), y - height * 0.06, Math.max(1, Math.round(height * 0.06)), height * 0.12);
  }
  // Spray edges: a little overspray around each letter.
  ctx.globalAlpha = alpha * 0.25;
  ctx.drawImage(layer, 1, 1);
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}
