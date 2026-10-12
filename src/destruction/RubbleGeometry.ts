import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Euler, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { config } from '../core/config';
import { createRandom } from '../world/random';

/*
 * Low-poly rubble piles, vertex colored, in their own frame on the ground:
 * - A wall's pile runs along +x over the wall's length: a low mound of dust and broken plaster with brick
 *   halves, plaster slabs and a few big broken blocks lying on it.
 * - The MG nest's pile is a slumped ring of split sandbags around a low mound, with the wrecked gun in the middle.
 * The shapes are what the eye sees; colliders are simple sloped prisms (see `wallRubbleHull`).
 */

const r = config.destruction.rubble;

const PLASTER = new Color(0xc9b28a);
const PLASTER_DARK = new Color(0xa89070);
const BRICK = new Color(0x93533b);
const BRICK_DARK = new Color(0x74402e);
const DUST = new Color(0xb39a76);
const BAGS = [0xa59b6c, 0x968f60, 0xb2a577, 0x8d875a].map((c) => new Color(c));
const SAND = new Color(0xb9a679);
const GUN = new Color(0x34362f);

/** Fake contact shadow: darker toward the ground. */
function groundShade(y: number, height: number): number {
  return 0.58 + 0.42 * Math.min(1, Math.max(0, y / height));
}

/** Bake `color` into a geometry's vertices, shaded by height (non-indexed, no uvs). */
function painted(geometry: BufferGeometry, color: Color, height: number): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute('uv');
  flat.deleteAttribute('normal');
  const positions = flat.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const s = groundShade(positions.getY(i), height);
    colors.set([color.r * s, color.g * s, color.b * s], i * 3);
  }
  flat.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return flat;
}

/**
 * A low heightfield mound over `length` x `width`, `height` at its peak, faded to the ground at the edges.
 * `profile` shapes it (0..1 at each local point); colors are mixed per vertex from `colors`.
 */
function mound(
  random: () => number,
  length: number,
  width: number,
  height: number,
  nx: number,
  nz: number,
  profile: (x: number, z: number) => number,
  colors: readonly Color[],
): { geometry: BufferGeometry; heightAt: (x: number, z: number) => number } {
  const heights: number[] = [];
  const tints: Color[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx - 0.5) * length;
      const z = (j / nz - 0.5) * width;
      const edge = i === 0 || j === 0 || i === nx || j === nz;
      // Edges tuck just under the ground so there is never a gap.
      heights.push(edge ? -0.02 : height * profile(x, z) * (0.7 + random() * 0.55));
      tints.push(colors[Math.floor(random() * colors.length)].clone().multiplyScalar(0.92 + random() * 0.16));
    }
  }
  const positions: number[] = [];
  const vertexColors: number[] = [];
  const at = (i: number, j: number): [number, number, number] => [(i / nx - 0.5) * length, heights[j * (nx + 1) + i], (j / nz - 0.5) * width];
  const push = (i: number, j: number): void => {
    const p = at(i, j);
    positions.push(...p);
    const c = tints[j * (nx + 1) + i];
    const s = groundShade(p[1], height);
    vertexColors.push(c.r * s, c.g * s, c.b * s);
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      // Counter-clockwise from above, alternating the diagonal so the facets do not line up.
      if ((i + j) % 2 === 0) {
        push(i, j); push(i, j + 1); push(i + 1, j);
        push(i + 1, j); push(i, j + 1); push(i + 1, j + 1);
      } else {
        push(i, j); push(i + 1, j + 1); push(i + 1, j);
        push(i, j); push(i, j + 1); push(i + 1, j + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(vertexColors, 3));
  const heightAt = (x: number, z: number): number => {
    const fi = Math.min(nx - 1e-3, Math.max(0, (x / length + 0.5) * nx));
    const fj = Math.min(nz - 1e-3, Math.max(0, (z / width + 0.5) * nz));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const h = (a: number, b: number): number => Math.max(0, heights[b * (nx + 1) + a]);
    const tx = fi - i;
    const tz = fj - j;
    return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - tz) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * tz;
  };
  return { geometry, heightAt };
}

const matrix = new Matrix4();
const rotation = new Quaternion();
const euler = new Euler();
const ONE = new Vector3(1, 1, 1);

/** Drop a piece at (x, z) onto the surface, half sunk in, at a random tilt. */
function lay(piece: BufferGeometry, random: () => number, x: number, z: number, surface: number, sink: number, tilt: number): BufferGeometry {
  euler.set((random() - 0.5) * tilt, random() * Math.PI * 2, (random() - 0.5) * tilt);
  rotation.setFromEuler(euler);
  return piece.applyMatrix4(matrix.compose(new Vector3(x, surface + sink, z), rotation, ONE));
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('Rubble geometry failed to merge');
  merged.computeVertexNormals();
  return merged;
}

/** A wall's rubble pile, along +x, in variant `variant` (each variant scatters its pieces differently). */
export function createWallRubbleGeometry(variant: number): BufferGeometry {
  const random = createRandom(8801 + variant * 7919);
  const L = r.length;
  const W = r.width;
  const peak = r.height * 0.62;
  const { geometry, heightAt } = mound(
    random,
    L,
    W,
    peak,
    9,
    5,
    (x, z) => Math.pow(Math.cos((Math.PI / 2) * Math.min(1, Math.abs(x) / (L / 2))), 0.5) * Math.cos((Math.PI / 2) * Math.min(1, Math.abs(z) / (W / 2))),
    [DUST, PLASTER_DARK, BRICK_DARK, DUST],
  );
  const parts: BufferGeometry[] = [geometry];
  const height = r.height;
  const spot = (): [number, number] => [(random() - 0.5) * L * 0.82, (random() - 0.5) * W * 0.62];

  // Broken blocks of wall: plaster on one face, brick through the break.
  for (let k = 0; k < 2 + (variant % 2); k++) {
    const [x, z] = spot();
    const w = 0.32 + random() * 0.18;
    const h = 0.18 + random() * 0.1;
    const d = 0.26 + random() * 0.12;
    const block = painted(new BoxGeometry(w, h, d), random() < 0.5 ? PLASTER : BRICK, height);
    parts.push(lay(block, random, x, z, heightAt(x, z), h * 0.25, 0.7));
  }
  // Plaster slabs.
  for (let k = 0; k < 6; k++) {
    const [x, z] = spot();
    const slab = painted(new BoxGeometry(0.2 + random() * 0.16, 0.045, 0.14 + random() * 0.12), random() < 0.7 ? PLASTER : PLASTER_DARK, height);
    parts.push(lay(slab, random, x, z, heightAt(x, z), 0.01, 0.9));
  }
  // Bricks, whole and broken.
  for (let k = 0; k < 11; k++) {
    const [x, z] = spot();
    const length = random() < 0.6 ? 0.22 : 0.12;
    const brick = painted(new BoxGeometry(length, 0.07, 0.11), random() < 0.7 ? BRICK : BRICK_DARK, height);
    parts.push(lay(brick, random, x, z, heightAt(x, z), 0.02, 1.2));
  }
  return merge(parts);
}

/** The MG nest's pile: a slumped ring of split sandbags around a low mound, and the wrecked gun. */
export function createNestRubbleGeometry(variant: number): BufferGeometry {
  const random = createRandom(4409 + variant * 6151);
  const size = r.nestSize;
  const ring = 1.55;
  const peak = r.nestHeight * 0.55;
  const { geometry, heightAt } = mound(
    random,
    size,
    size,
    peak,
    8,
    8,
    (x, z) => {
      // Highest along the old sandbag ring, lower in the middle, nothing at the edge.
      const d = Math.max(Math.abs(x), Math.abs(z));
      return Math.max(0, 1 - Math.abs(d - ring) / 0.9) * 0.85 + 0.15 * Math.max(0, 1 - d / (size / 2));
    },
    [SAND, BAGS[1], SAND, BAGS[3]],
  );
  const parts: BufferGeometry[] = [geometry];
  const height = r.nestHeight;
  for (let k = 0; k < 22; k++) {
    // Somewhere along the square ring, scattered a little either way.
    const side = Math.floor(random() * 4);
    const t = (random() - 0.5) * ring * 2;
    const off = ring + (random() - 0.5) * 0.7;
    const [x, z] = side === 0 ? [t, -off] : side === 1 ? [off, t] : side === 2 ? [t, off] : [-off, t];
    const bag = painted(new BoxGeometry(0.58, 0.16 + random() * 0.06, 0.34), BAGS[Math.floor(random() * BAGS.length)], height);
    parts.push(lay(bag, random, x, z, heightAt(x, z), 0.02, 0.6));
  }
  // The gun on its side, and a tripod leg.
  const receiver = painted(new BoxGeometry(0.62, 0.16, 0.18), GUN, height);
  parts.push(lay(receiver, random, -0.1, -0.4, heightAt(-0.1, -0.4), 0.06, 0.5));
  const barrel = painted(new CylinderGeometry(0.045, 0.045, 0.6, 6).rotateZ(Math.PI / 2), GUN, height);
  parts.push(lay(barrel, random, 0.25, -0.75, heightAt(0.25, -0.75), 0.05, 0.3));
  const leg = painted(new CylinderGeometry(0.025, 0.03, 0.95, 5).rotateZ(Math.PI / 2), GUN, height);
  parts.push(lay(leg, random, -0.35, 0.1, heightAt(-0.35, 0.1), 0.03, 0.4));
  return merge(parts);
}

/**
 * Convex collider points for a wall's pile: a low ridge along the wall with gentle slopes on every side,
 * so the player walks up and over it and can crouch behind it.
 */
export function wallRubbleHull(): Float32Array {
  const halfL = r.length / 2;
  const halfW = r.width / 2;
  const top = r.height * 0.84;
  const topHalfL = halfL - 0.55;
  const topHalfW = 0.2;
  return prism(halfL, halfW, topHalfL, topHalfW, top);
}

/** Convex collider points for the nest's pile: a low square mound. */
export function nestRubbleHull(): Float32Array {
  const half = r.nestSize / 2;
  return prism(half, half, half - 0.55, half - 0.55, r.nestHeight * 0.75);
}

/** A flat-topped prism: a `halfX` x `halfZ` base on the ground, a smaller top at `height`. */
function prism(halfX: number, halfZ: number, topX: number, topZ: number, height: number): Float32Array {
  const points: number[] = [];
  for (const [hx, hz, y] of [
    [halfX, halfZ, 0],
    [topX, topZ, height],
  ]) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) points.push(sx * hx, y, sz * hz);
  }
  return new Float32Array(points);
}
