import type { CanvasTexture } from 'three';
import { mix, painterRandom, Pixels, scale, smoothstep, tileFbm, tileNoise, worldTexture, type RGB } from './TextureKit';

/*
 * Dust Ridge ground textures: tiling sand and gravel, and the tire ruts that run from the spawn points in.
 */

const SAND: RGB = [206, 176, 128];
const SAND_PALE: RGB = [224, 200, 156];
const SAND_DARK: RGB = [176, 144, 100];
const GRAVEL: RGB = [150, 128, 100];
const PEBBLE_LIGHT: RGB = [196, 184, 162];
const PEBBLE_DARK: RGB = [112, 96, 78];
const SPECK: RGB = [92, 74, 56];
const RUT: RGB = [120, 94, 64];
const RUT_DARK: RGB = [92, 70, 48];

/** Sand and gravel, 512 px, tiling on both axes. Covers `GROUND_TILE` meters. */
export function createSandTexture(): CanvasTexture {
  const size = 512;
  const p = new Pixels(size, size, SAND);
  const noise = tileNoise(311);
  const { random, between } = painterRandom(9127);

  // Mottled sand: soft patches of pale and dark, gravel showing through in the low spots.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const broad = tileFbm(noise, x, y, size, 3, 4);
      const fine = tileFbm(noise, x + 97, y + 41, size, 24, 2);
      let c = mix(SAND_DARK, SAND_PALE, smoothstep(0.3, 0.72, broad));
      c = mix(c, GRAVEL, smoothstep(0.62, 0.8, fine) * 0.45);
      // Wind ripples: faint bands across the sand.
      const ripple = Math.sin((y / size) * Math.PI * 2 * 22 + Math.sin((x / size) * Math.PI * 2 * 3) * 2.5 + broad * 6);
      c = scale(c, 1 + ripple * 0.025 + (random() - 0.5) * 0.09);
      p.set(x, y, c);
    }
  }

  // Grit: single dark and light specks.
  for (let k = 0; k < 2600; k++) p.blend(random() * size, random() * size, random() < 0.55 ? SPECK : SAND_PALE, between(0.25, 0.6));

  // Pebbles: lit on top, a shadow under, a dark rim.
  for (let k = 0; k < 340; k++) {
    const x = random() * size;
    const y = random() * size;
    const r = random() < 0.85 ? between(1, 2.6) : between(3, 5.5);
    const tone = mix(PEBBLE_DARK, PEBBLE_LIGHT, random());
    p.ellipse(x + r * 0.35, y + r * 0.45, r * 1.15, r * 0.9, SPECK, 0.35);
    p.ellipse(x, y, r, r * 0.8, tone, 0.95, 0.25);
    p.ellipse(x - r * 0.3, y - r * 0.3, r * 0.45, r * 0.35, PEBBLE_LIGHT, 0.5);
  }
  return worldTexture(p);
}

/**
 * Two tire ruts with tread marks, across the width of a track ribbon (u) and repeating along it (v), on a
 * transparent background so the sand shows between them. 128 x 256 px covers the track's width by 4 m.
 */
export function createTireTrackTexture(): CanvasTexture {
  const width = 128;
  const height = 256;
  const p = new Pixels(width, height, RUT, false);
  const noise = tileNoise(57);
  const { random } = painterRandom(733);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const wobble = (noise(y / 16, 3, 16) - 0.5) * 0.04;
      // Ruts centered at u = 0.2 and 0.8, about a fifth of the width each.
      const d = Math.min(Math.abs(u - 0.2 - wobble), Math.abs(u - 0.8 - wobble));
      const rut = smoothstep(0.13, 0.06, d);
      // Tread: chevrons repeating every 8 px along the rut.
      const side = u < 0.5 ? 1 : -1;
      const tread = ((y + Math.abs(u - (u < 0.5 ? 0.2 : 0.8)) * 60 * side) % 8 + 8) % 8 < 3 ? 1 : 0;
      // A faint packed strip down the middle where the axle dragged.
      const middle = smoothstep(0.16, 0.0, Math.abs(u - 0.5)) * 0.18;
      const breakup = tileFbm(noise, x, y, height, 4, 3);
      const a = Math.max(rut * (0.55 + tread * 0.25), middle) * smoothstep(0.2, 0.55, breakup + 0.15) + (random() - 0.5) * 0.06 * rut;
      p.set(x, y, tread && rut > 0.5 ? RUT_DARK : RUT, Math.max(0, Math.min(0.85, a)));
    }
  }
  return worldTexture(p);
}
