import type { CanvasTexture } from 'three';
import { brickAt } from '../build/WallTextures';
import {
  context2d,
  mix,
  painterRandom,
  Pixels,
  scale,
  smoothstep,
  stencilText,
  tileFbm,
  tileNoise,
  worldTexture,
  type RGB,
} from './TextureKit';

/*
 * Procedural textures for the map props, the outpost bunker and the armor crate, painted to match the Game
 * Reference images: sun-bleached plaster chipped down to brick, board-marked concrete, weathered planks,
 * stenciled crates, galvanized and painted metal, burlap. No real-world markings: stencils are numbers and arrows.
 * Each is made once and shared (see `PropMaterials`).
 */

const PLASTER: RGB = [218, 204, 172];
const PLASTER_LIGHT: RGB = [234, 224, 200];
const DIRT: RGB = [128, 102, 72];
const STAIN: RGB = [116, 98, 74];
const CRACK: RGB = [78, 62, 46];
const CONCRETE: RGB = [170, 162, 148];
const CONCRETE_DARK: RGB = [128, 120, 108];
const WOOD: RGB = [150, 112, 70];
const WOOD_DARK: RGB = [96, 68, 40];
const WOOD_GAP: RGB = [52, 38, 24];
const GALVANIZED: RGB = [150, 152, 148];
const RUST: RGB = [132, 74, 40];
const OLIVE: RGB = [92, 96, 62];
const OLIVE_DARK: RGB = [64, 68, 42];
const BURLAP: RGB = [176, 156, 112];
const STENCIL = 'rgb(40, 34, 26)';

/** Shared painting for any weathered surface: broad mottling, fine grain. */
function weather(p: Pixels, seed: number, amount: number, cells = 4): void {
  const noise = tileNoise(seed);
  const { random } = painterRandom(seed + 1);
  const size = p.width;
  p.shadeAll((x, y) => 1 + (tileFbm(noise, x, y, size, cells, 4) - 0.5) * amount + (random() - 0.5) * amount * 0.4);
}

/** Dirt splashed up from the ground along the bottom rows, `height` pixels tall with a ragged top. */
function groundDirt(p: Pixels, seed: number, height: number, strength: number): void {
  const noise = tileNoise(seed);
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const fromBottom = p.height - 1 - y;
      const ragged = (tileFbm(noise, x, y, p.width, 8, 3) - 0.5) * height * 0.8;
      p.blend(x, y, DIRT, smoothstep(height, 0, fromBottom + ragged) * strength);
    }
  }
}

/** Rain streaks running down from the top edge. */
function streaks(p: Pixels, seed: number, count: number, color: RGB, strength: number): void {
  const { random, between } = painterRandom(seed);
  for (let k = 0; k < count; k++) {
    const x0 = random() * p.width;
    const width = between(1, 3.5);
    const length = between(0.1, 0.45) * p.height;
    const a = between(0.04, 0.12) * strength;
    for (let t = 0; t < length; t++) {
      const fade = (1 - t / length) ** 1.5;
      for (let dx = -width; dx <= width; dx++) p.blend(x0 + dx + Math.sin(t * 0.07) * 1.2, t, color, a * fade * (1 - Math.abs(dx) / (width + 0.5)));
    }
  }
}

/** A thin wandering crack from (x, y), mostly downward, with a light lower edge. */
function crack(p: Pixels, seed: number, x: number, y: number, length: number): void {
  const { random } = painterRandom(seed);
  let angle = Math.PI / 2 + (random() - 0.5) * 1.4;
  for (let t = 0; t < length; t++) {
    angle += (random() - 0.5) * 0.7;
    x += Math.cos(angle);
    y += Math.sin(angle);
    p.blend(x, y, CRACK, 0.7 * (1 - t / (length * 1.3)));
    p.blend(x + 1, y + 1, PLASTER_LIGHT, 0.25);
  }
}

/** A ragged patch of plaster knocked off down to the brick, with a lit lip and a shadowed top edge. */
function chip(p: Pixels, noise: ReturnType<typeof tileNoise>, cx: number, cy: number, rx: number, ry: number, seed: number): void {
  const off = seed * 7.13;
  for (let y = Math.floor(cy - ry * 1.4); y <= cy + ry * 1.4; y++) {
    for (let x = Math.floor(cx - rx * 1.4); x <= cx + rx * 1.4; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const around = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
      const ragged = 0.6 + 0.5 * noise(around * 7 + off, off, 7) + 0.25 * noise(around * 23 + off, off + 3, 23);
      const d = Math.hypot(dx, dy) / ragged;
      if (d > 1.12) continue;
      if (d > 1) {
        p.blend(x, y, PLASTER_LIGHT, 0.8 * (1 - (d - 1) / 0.12));
        continue;
      }
      const brick = brickAt(x, p.height - y, seed);
      // Recessed: darker under the plaster's upper edge.
      const shadow = smoothstep(0.45, 1, d) * smoothstep(0.2, -0.9, dy) * 0.45;
      p.set(x, y, scale(brick, 1 - shadow - smoothstep(0.6, 1, d) * 0.12));
    }
  }
}

/**
 * Sun-bleached plaster over brick for the ruined buildings: 512 px covering 4 x 4 m. Dirt along the bottom,
 * rain streaks from the top, cracks, and big chips showing the brick underneath, as in FPS-Model(3).
 */
export function createPlasterBrickTexture(): CanvasTexture {
  const size = 512;
  const p = new Pixels(size, size, PLASTER);
  weather(p, 101, 0.16, 4);
  const noise = tileNoise(103);
  const { random, between } = painterRandom(107);
  // Repaired patches in a slightly different tone.
  for (let k = 0; k < 5; k++) {
    p.ellipse(between(0, size), between(60, size - 80), between(30, 70), between(24, 60), random() < 0.5 ? PLASTER_LIGHT : [200, 176, 134], 0.45, 0.4);
  }
  // A few big chips down to the brick, mostly low on the wall where it gets knocked, as in FPS-Model(3).
  for (let k = 0; k < 2; k++) chip(p, noise, between(0, size), between(size * 0.35, size * 0.8), between(40, 64), between(50, 84), 200 + k);
  // And a scatter of small flakes down to the scratch coat.
  for (let k = 0; k < 10; k++) p.ellipse(between(0, size), between(0, size), between(4, 10), between(3, 8), [184, 172, 150], 0.7, 0.3);
  for (let k = 0; k < 9; k++) crack(p, 300 + k, between(0, size), between(0, size * 0.7), between(30, 120));
  streaks(p, 109, 34, STAIN, 1.2);
  groundDirt(p, 111, 70, 0.75);
  // Bullet pocks.
  for (let k = 0; k < 40; k++) {
    const x = between(0, size);
    const y = between(0, size);
    p.ellipse(x, y, between(1.2, 2.6), between(1.2, 2.6), CRACK, 0.55, 0.2);
    p.blend(x + 1, y + 2, PLASTER_LIGHT, 0.4);
  }
  return worldTexture(p);
}

/** Board-marked concrete with chipped patches, for the bunker and roof slabs: 256 px covering 2 x 2 m. */
export function createConcreteTexture(): CanvasTexture {
  const size = 256;
  const p = new Pixels(size, size, CONCRETE);
  weather(p, 121, 0.2, 6);
  const { between, random } = painterRandom(123);
  // Formwork board lines every 32 px (25 cm), with the odd seam bleed.
  for (let y = 0; y < size; y += 32) {
    for (let x = 0; x < size; x++) {
      p.blend(x, y, CONCRETE_DARK, 0.45);
      p.blend(x, y + 1, PLASTER_LIGHT, 0.12);
      if (random() < 0.02) p.blend(x, y + 2, CONCRETE_DARK, 0.4);
    }
  }
  // Pitted aggregate.
  for (let k = 0; k < 900; k++) p.blend(random() * size, random() * size, random() < 0.6 ? CONCRETE_DARK : PLASTER_LIGHT, between(0.2, 0.5));
  // Plaster skim left in patches over the concrete.
  for (let k = 0; k < 6; k++) p.ellipse(between(0, size), between(0, size), between(14, 36), between(12, 30), PLASTER, 0.55, 0.15);
  for (let k = 0; k < 6; k++) crack(p, 130 + k, between(0, size), between(0, size), between(20, 60));
  streaks(p, 141, 18, STAIN, 1.3);
  groundDirt(p, 143, 40, 0.6);
  return worldTexture(p);
}

/** Weathered horizontal planks with dark gaps, grain and nail heads: 256 px covering 2 x 2 m. */
export function createPlankTexture(): CanvasTexture {
  const size = 256;
  const p = new Pixels(size, size, WOOD);
  const noise = tileNoise(151);
  const { random, between } = painterRandom(153);
  const board = 32;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / board);
    const tone = 0.82 + ((Math.imul(row + 7, 2654435761) >>> 0) % 1000) / 1000 * 0.32;
    for (let x = 0; x < size; x++) {
      const grain = tileFbm(noise, x * 0.25, y * 3 + row * 40, size, 4, 3);
      const c = mix(WOOD_DARK, WOOD, smoothstep(0.25, 0.75, grain));
      p.set(x, y, scale(c, tone));
    }
    if (y % board === 0 || y % board === board - 1) for (let x = 0; x < size; x++) p.blend(x, y, WOOD_GAP, 0.85);
  }
  // Board ends and nails.
  for (let row = 0; row < size / board; row++) {
    const end = Math.floor(between(0, size));
    for (let y = row * board; y < (row + 1) * board; y++) p.blend(end, y, WOOD_GAP, 0.8);
    for (const x of [end + 6, end - 6, (end + size / 2) % size]) {
      p.ellipse(x, row * board + 8, 1.6, 1.6, [60, 56, 52], 0.9, 0.1);
      p.ellipse(x, row * board + board - 9, 1.6, 1.6, [60, 56, 52], 0.9, 0.1);
      p.blend(x, row * board + 11, RUST, 0.35);
    }
  }
  weather(p, 157, 0.12, 4);
  for (let k = 0; k < 400; k++) p.blend(random() * size, random() * size, WOOD_GAP, between(0.1, 0.3));
  groundDirt(p, 159, 36, 0.45);
  return worldTexture(p);
}

/** Plank face of a supply crate: frame boards around the edge, a diagonal brace and a stenciled number and arrows. */
function paintCrateFace(seed: number): Pixels {
  const size = 256;
  const p = new Pixels(size, size, [160, 124, 80]);
  const noise = tileNoise(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = tileFbm(noise, x * 3, y * 0.3, size, 4, 3);
      p.shade(x, y, 0.82 + grain * 0.32);
    }
  }
  // Vertical slats with gaps.
  for (let x = 0; x < size; x += 43) for (let y = 0; y < size; y++) p.blend(x, y, WOOD_GAP, 0.8);
  // Frame boards: darker, raised.
  const frame = 24;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (edge < frame) p.blend(x, y, WOOD_DARK, 0.55);
      if (edge === frame || edge === frame + 1) p.blend(x, y, WOOD_GAP, 0.7);
      if (edge === 0 || edge === 1) p.blend(x, y, WOOD_GAP, 0.6);
    }
  }
  // Nails at the frame corners and middles.
  for (const cx of [12, size / 2, size - 12]) for (const cy of [12, size / 2, size - 12]) if (cx !== size / 2 || cy !== size / 2) p.ellipse(cx, cy, 2.2, 2.2, [70, 66, 60], 0.95, 0.1);
  weather(p, seed + 5, 0.1, 4);
  return p;
}

/** Wooden supply crate side, with a generic stenciled lot number and "this way up" arrows. */
export function createCrateTexture(): CanvasTexture {
  const p = paintCrateFace(171);
  const canvas = p.toCanvas();
  const ctx = context2d(canvas);
  stencilText(ctx, '07-3', 128, 112, 54, STENCIL, 0.8);
  // Two up arrows.
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = STENCIL;
  for (const x of [78, 178]) {
    ctx.beginPath();
    ctx.moveTo(x, 150);
    ctx.lineTo(x + 16, 172);
    ctx.lineTo(x + 6, 172);
    ctx.lineTo(x + 6, 200);
    ctx.lineTo(x - 6, 200);
    ctx.lineTo(x - 6, 172);
    ctx.lineTo(x - 16, 172);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  return worldTexture(canvas, true);
}

/** The armor crate's sides: same planks with "ARMOR" stenciled big across the middle. */
export function createArmorCrateTexture(): CanvasTexture {
  const p = paintCrateFace(181);
  const canvas = p.toCanvas();
  const ctx = context2d(canvas);
  stencilText(ctx, 'ARMOR', 128, 118, 74, STENCIL, 0.85);
  stencilText(ctx, 'LOT 14', 128, 178, 24, STENCIL, 0.65);
  return worldTexture(canvas, true);
}

/** Galvanized corrugated sheet, vertical ribs, rust bleeding from the bottom and along the laps: 256 px covering 2 x 2 m. */
export function createCorrugatedTexture(): CanvasTexture {
  const size = 256;
  const p = new Pixels(size, size, GALVANIZED);
  // Ribs every 16 px: lit flank, dark flank.
  p.shadeAll((x) => 0.78 + 0.32 * (0.5 + 0.5 * Math.sin((x / 16) * Math.PI * 2)));
  weather(p, 191, 0.2, 4);
  const noise = tileNoise(193);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rust = tileFbm(noise, x, y, size, 6, 4);
      p.blend(x, y, RUST, smoothstep(0.58, 0.75, rust) * 0.7 + smoothstep(size * 0.75, size, y) * 0.35);
    }
  }
  // Sheet laps every 128 px.
  for (let y = 0; y < size; y++) {
    p.blend(0, y, [60, 60, 58], 0.7);
    p.blend(128, y, [60, 60, 58], 0.7);
  }
  streaks(p, 197, 20, RUST, 1.5);
  return worldTexture(p);
}

/** Painted olive metal with dirt, chips and rust, for the truck and ammo boxes: 256 px covering 2 x 2 m. */
export function createOliveMetalTexture(): CanvasTexture {
  const size = 256;
  const p = new Pixels(size, size, OLIVE);
  weather(p, 201, 0.18, 4);
  const { random, between } = painterRandom(203);
  // Paint chips down to bare metal and rust.
  for (let k = 0; k < 60; k++) {
    const x = random() * size;
    const y = random() * size;
    const r = between(1, 4);
    p.ellipse(x, y, r * 1.4, r, random() < 0.6 ? RUST : [120, 118, 110], 0.8, 0.2);
  }
  // Panel seams.
  for (let x = 0; x < size; x++) {
    p.blend(x, 0, OLIVE_DARK, 0.8);
    p.blend(x, 127, OLIVE_DARK, 0.6);
  }
  streaks(p, 207, 22, [70, 62, 44], 1.5);
  groundDirt(p, 209, 60, 0.7);
  return worldTexture(p);
}

/** A steel drum's side wrapped once around (u) and top to bottom (v): two rolling hoops, scrapes and rust. Light gray, tinted per barrel. */
export function createBarrelTexture(): CanvasTexture {
  const size = 256;
  const p = new Pixels(size, size, [200, 200, 196]);
  weather(p, 211, 0.16, 4);
  // Rolling hoops at a third and two thirds, and the rims.
  for (const hoop of [size / 3, (size * 2) / 3]) {
    for (let x = 0; x < size; x++) {
      for (let d = -5; d <= 5; d++) p.shade(x, hoop + d, d < 0 ? 1.12 : 0.78);
    }
  }
  for (let x = 0; x < size; x++) for (const y of [0, 1, 2, size - 3, size - 2, size - 1]) p.shade(x, y, 0.7);
  const noise = tileNoise(213);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rust = tileFbm(noise, x, y, size, 5, 4);
      p.blend(x, y, RUST, smoothstep(0.6, 0.78, rust) * 0.8);
    }
  }
  streaks(p, 217, 16, RUST, 1.4);
  groundDirt(p, 219, 50, 0.6);
  // Generic stencil band.
  const canvas = p.toCanvas();
  stencilText(context2d(canvas), '200 L', 64, 128, 26, STENCIL, 0.55);
  return worldTexture(canvas);
}

/** Diamond chain-link mesh on a transparent background, with a little rust: 256 px covering 2 x 2 m. Use with alphaTest. */
export function createChainLinkTexture(): CanvasTexture {
  const size = 256;
  const p = new Pixels(size, size, [150, 150, 144], false);
  const cell = 22;
  const { random } = painterRandom(221);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + y) % cell + cell) % cell;
      const v = ((x - y) % cell + cell) % cell;
      if (u < 4 || v < 4) p.set(x, y, random() < 0.15 ? RUST : scale([150, 150, 144], 0.8 + random() * 0.3), 1);
    }
  }
  return worldTexture(p);
}

/** Dry desert brush on a transparent background: twigs fanning up from the base with sparse gray-green leaves. */
export function createShrubTexture(): CanvasTexture {
  const size = 256;
  const p = new Pixels(size, size, [110, 92, 66], false);
  const { random, between } = painterRandom(231);
  const leafColors: RGB[] = [[118, 120, 82], [140, 132, 92], [104, 96, 66], [150, 138, 98]];
  const branch = (x: number, y: number, angle: number, length: number, width: number, depth: number): void => {
    for (let t = 0; t < length; t++) {
      angle += (random() - 0.5) * 0.25;
      x += Math.cos(angle);
      y -= Math.sin(angle);
      for (let w = 0; w < width; w++) p.set(x + w, y, scale([96, 76, 52], 0.8 + random() * 0.3));
      if (depth > 0 && random() < 0.05) branch(x, y, angle + (random() - 0.5) * 1.4, length * 0.5, Math.max(1, width - 1), depth - 1);
      if (t > length * 0.4 && random() < 0.25) p.ellipse(x + between(-3, 3), y + between(-3, 3), between(1.5, 3.5), between(1.2, 2.5), leafColors[Math.floor(random() * 4)], 1, 0.05);
    }
  };
  for (let k = 0; k < 16; k++) branch(size / 2 + between(-14, 14), size - 2, between(0.5, Math.PI - 0.5), between(70, 150), 2, 2);
  return worldTexture(p, true);
}

/** Burlap sacking: a coarse weave, seams and dust, for sandbags: 128 px covering one bag face. */
export function createBurlapTexture(): CanvasTexture {
  const size = 128;
  const p = new Pixels(size, size, BURLAP);
  p.shadeAll((x, y) => 0.9 + ((x % 3 === 0 ? 0.08 : 0) + (y % 3 === 0 ? 0.06 : 0)) * ((x + y) % 2 ? 1 : -1) + 0.05);
  weather(p, 241, 0.22, 4);
  const { random } = painterRandom(243);
  for (let k = 0; k < 300; k++) p.blend(random() * size, random() * size, DIRT, 0.25);
  // A stitched seam near one end.
  for (let y = 0; y < size; y += 4) p.rect(14, y, 2, 2, [110, 96, 68], 0.8);
  groundDirt(p, 247, 30, 0.5);
  return worldTexture(p);
}

/** Dark, bare weathered wood for poles and tower legs: vertical grain, 128 x 256 px covering 0.5 x 2 m. */
export function createPoleTexture(): CanvasTexture {
  const p = new Pixels(128, 256, [112, 92, 70]);
  const noise = tileNoise(251);
  p.shadeAll((x, y) => 0.78 + tileFbm(noise, x * 4, y * 0.4, 128, 4, 3) * 0.38);
  groundDirt(p, 253, 30, 0.4);
  return worldTexture(p);
}

/** Painted steel door: a recessed panel, rivets and scuffed paint. 128 x 256 px for one door. */
export function createSteelDoorTexture(): CanvasTexture {
  const p = new Pixels(128, 256, [86, 92, 82]);
  weather(p, 261, 0.2, 4);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 128; x++) {
      const edge = Math.min(x, y, 127 - x, 255 - y);
      if (edge < 3) p.shade(x, y, 0.6);
      else if (edge === 14) p.shade(x, y, 0.65);
      else if (edge === 15) p.shade(x, y, 1.2);
    }
  }
  for (const y of [8, 128, 248]) for (const x of [8, 64, 120]) p.ellipse(x, y, 2, 2, [130, 134, 124], 1, 0.2);
  p.rect(100, 120, 14, 10, [52, 52, 50]);
  streaks(p, 263, 10, RUST, 1.5);
  groundDirt(p, 265, 40, 0.6);
  return worldTexture(p, true);
}
