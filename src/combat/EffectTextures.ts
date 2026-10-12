import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';
import { createRandom } from '../world/random';

/**
 * Small procedural textures for combat effects. Low resolution with nearest-pixel magnification,
 * so effects look chunky up close, in keeping with the retro style.
 */

type Painter = (ctx: CanvasRenderingContext2D, size: number, random: () => number) => void;

function makeTexture(size: number, seed: number, paint: Painter): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  paint(ctx, size, createRandom(seed));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  return texture;
}

/** Per-pixel painter: `shade(dx, dy, random)` returns [r, g, b, a] (0..255) for a pixel at distance (dx, dy) from center, in -1..1. */
function paintPixels(shade: (dx: number, dy: number, random: () => number) => [number, number, number, number]): Painter {
  return (ctx, size, random) => {
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = ((x + 0.5) / size) * 2 - 1;
        const dy = ((y + 0.5) / size) * 2 - 1;
        const [r, g, b, a] = shade(dx, dy, random);
        const i = (y * size + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = a;
      }
    }
    ctx.putImageData(image, 0, 0);
  };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** White puff with a lumpy, noisy edge. Tinted per particle for smoke and dust. */
export function createSmokeTexture(): CanvasTexture {
  return makeTexture(
    32,
    11,
    paintPixels((dx, dy, random) => {
      const angle = Math.atan2(dy, dx);
      const lumpy = 0.78 + 0.12 * Math.sin(angle * 5 + 1.3) + 0.06 * Math.sin(angle * 9);
      const d = Math.hypot(dx, dy) / lumpy;
      const body = clamp01(1 - d * d);
      const shade = 200 + random() * 55;
      return [shade, shade, shade, Math.round(255 * clamp01(body * 1.6) * (0.8 + random() * 0.2))];
    }),
  );
}

/** Bright round glow for fire, sparks and flashes. Used with additive blending. */
export function createGlowTexture(): CanvasTexture {
  return makeTexture(
    32,
    23,
    paintPixels((dx, dy, random) => {
      const d = Math.hypot(dx, dy);
      const core = clamp01(1 - d);
      const v = Math.round(255 * clamp01(core * core * 1.8) * (0.85 + random() * 0.15));
      return [v, v, v, v];
    }),
  );
}

/** Four-point star for the muzzle flash. */
export function createMuzzleFlashTexture(): CanvasTexture {
  // A six-pointed star, long and short points alternating, with a white-hot core, yellow body and orange tips.
  const arms = [1, 0.62, 0.9, 0.55, 0.95, 0.66];
  return makeTexture(
    64,
    37,
    paintPixels((dx, dy, random) => {
      const d = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) + Math.PI / 2;
      const sector = (angle / (Math.PI * 2)) * 6;
      const k = ((Math.floor(sector + 0.5) % 6) + 6) % 6;
      // Distance from the nearest point's center line, as a fraction of the sector.
      const off = Math.abs(sector - Math.round(sector));
      const reach = arms[k] * (1 - off * 2.4);
      const star = clamp01((reach - d) / 0.12) * clamp01(1 - off * 2.2);
      const core = clamp01(1 - d * 2.6);
      const a = clamp01(Math.max(star, core * 1.2) * (0.9 + random() * 0.1));
      const heat = clamp01(core * 1.6 + (1 - d) * 0.5);
      const r = 255;
      const g = Math.round(120 + 135 * heat);
      const b = Math.round(30 + 200 * heat * heat * heat);
      return [r, g, b, Math.round(255 * a)];
    }),
  );
}

/** Dark bullet hole with a lighter chipped rim. */
export function createBulletHoleTexture(): CanvasTexture {
  return makeTexture(
    16,
    41,
    paintPixels((dx, dy, random) => {
      const d = Math.hypot(dx, dy) + (random() - 0.5) * 0.15;
      if (d < 0.38) return [18, 14, 12, 250];
      if (d < 0.75) return [70, 58, 46, Math.round(200 * (1 - (d - 0.38) / 0.37))];
      return [0, 0, 0, 0];
    }),
  );
}

/** Blotchy black scorch mark that fades out toward the edge. */
export function createScorchTexture(): CanvasTexture {
  return makeTexture(
    32,
    53,
    paintPixels((dx, dy, random) => {
      const angle = Math.atan2(dy, dx);
      const ragged = 0.85 + 0.1 * Math.sin(angle * 7 + 0.5) + 0.05 * Math.sin(angle * 13);
      const d = Math.hypot(dx, dy) / ragged;
      const a = clamp01(1 - d) ** 0.7 * (0.75 + random() * 0.25);
      const v = Math.round(10 + random() * 20);
      return [v, v, v, Math.round(235 * a)];
    }),
  );
}
