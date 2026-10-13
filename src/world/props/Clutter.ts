import { BoxGeometry, BufferGeometry, CylinderGeometry, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shadeKind, type InstanceKind, type PropBuilder } from '../PropBuilder';
import { forInstances, PropMaterials } from '../PropMaterials';
import { createRandom } from '../random';

/*
 * Repeated small props, each one instanced mesh for the whole map: wooden supply crates, steel drums, sandbags,
 * dry shrubs and telephone poles. Helpers here place them in stacks, clusters, walls and lines with colliders.
 */

const CRATE = 1;
const BARREL_RADIUS = 0.29;
const BARREL_HEIGHT = 0.88;
const BAG = { length: 0.62, height: 0.26, depth: 0.38 };
const POLE_HEIGHT = 8;
/** Steel drum paint colors, as multipliers on the light gray texture. */
const BARREL_TINTS = [0x8e9a64, 0xa8503a, 0x6f8090, 0xd8d4c6, 0xb89a48];

let kinds: Record<'crate' | 'barrel' | 'bag' | 'shrub' | 'pole', InstanceKind> | null = null;

/** The shared instance kinds, built on first use. */
function getKinds(): NonNullable<typeof kinds> {
  if (kinds) return kinds;
  const crate = shadeKind(new BoxGeometry(CRATE, CRATE, CRATE).translate(0, CRATE / 2, 0), 1, 0.62, 1);
  const barrel = shadeKind(new CylinderGeometry(BARREL_RADIUS, BARREL_RADIUS, BARREL_HEIGHT, 12).translate(0, BARREL_HEIGHT / 2, 0), 1, 0.62, 0.9);
  kinds = {
    crate: { name: 'crates', geometry: crate, material: forInstances(PropMaterials.crate()) },
    barrel: { name: 'barrels', geometry: barrel, material: forInstances(PropMaterials.barrel()) },
    bag: { name: 'sandbags', geometry: sandbagGeometry(), material: forInstances(PropMaterials.burlap()) },
    shrub: { name: 'shrubs', geometry: shrubGeometry(), material: forInstances(PropMaterials.shrub()) },
    pole: { name: 'poles', geometry: poleGeometry(), material: forInstances(PropMaterials.pole()) },
  };
  return kinds;
}

/** The shared sandbag kind, for models outside the map dressing (the outpost bunker). */
export function sandbagKind(): InstanceKind {
  return getKinds().bag;
}

/** Sandbag size, in meters. */
export const SANDBAG = BAG;

/** A plump sandbag: a box with its ends and edges pinched in, bottom at y = 0. */
function sandbagGeometry(): BufferGeometry {
  const g = new BoxGeometry(BAG.length, BAG.height, BAG.depth, 4, 2, 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (BAG.length / 2);
    const y = p.getY(i) / (BAG.height / 2);
    const z = p.getZ(i) / (BAG.depth / 2);
    const pinch = 1 - 0.16 * y * y;
    p.setXYZ(i, p.getX(i) * (1 - 0.08 * y * y), p.getY(i) * (1 - 0.35 * x ** 4) * (1 - 0.2 * z ** 4), p.getZ(i) * pinch);
  }
  g.computeVertexNormals();
  g.translate(0, BAG.height / 2, 0);
  return shadeKind(g, 1, 0.72, BAG.height);
}

/** Two crossed upright cards, 1 m square, bottom at y = 0, darker at the base. */
function shrubGeometry(): BufferGeometry {
  const a = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const b = new PlaneGeometry(1, 1).rotateY(Math.PI / 2).translate(0, 0.5, 0);
  const merged = mergeGeometries([a, b]);
  a.dispose();
  b.dispose();
  if (!merged) throw new Error('Shrub geometry failed');
  // Light from above, not from the card's facing, so both cards shade alike.
  const n = merged.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return shadeKind(merged, 1, 0.6, 0.8);
}

/** A telephone pole with its crossarm and insulators, foot at y = 0. */
function poleGeometry(): BufferGeometry {
  const parts = [
    new CylinderGeometry(0.11, 0.15, POLE_HEIGHT, 7).translate(0, POLE_HEIGHT / 2, 0),
    new BoxGeometry(1.8, 0.12, 0.12).translate(0, POLE_HEIGHT - 0.6, 0),
    new BoxGeometry(0.12, 0.6, 0.08).translate(0.45, POLE_HEIGHT - 0.85, 0).rotateZ(0),
    ...[-0.75, -0.25, 0.25, 0.75].map((x) => new CylinderGeometry(0.04, 0.05, 0.16, 5).translate(x, POLE_HEIGHT - 0.46, 0)),
  ];
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  if (!merged) throw new Error('Pole geometry failed');
  return shadeKind(merged, 1, 0.6, 1.5);
}

/**
 * A stack of supply crates around (x, z): `layout` lists [column, row, level] slots on a 1 m grid,
 * relative to the stack's center. Each crate collides; the stack's footprint is blocked.
 */
export function addCrateStack(b: PropBuilder, x: number, z: number, yaw: number, layout: [number, number, number][], seed: number): void {
  const k = getKinds();
  const random = createRandom(seed);
  b.at(x, z, yaw);
  let maxX = 0;
  let maxZ = 0;
  for (const [cx, cz, level] of layout) {
    const s = 0.9 + random() * 0.15;
    const ry = (random() - 0.5) * 0.25;
    const tone = 0.85 + random() * 0.25;
    const py = level * CRATE * 0.98;
    b.instance(k.crate, cx * 1.05, py, cz * 1.05, { ry, scale: s, color: toneColor(tone) });
    b.collider((CRATE * s) / 2, (CRATE * s) / 2, (CRATE * s) / 2, cx * 1.05, py + (CRATE * s) / 2, cz * 1.05, ry, 'wood');
    maxX = Math.max(maxX, Math.abs(cx * 1.05) + 0.6);
    maxZ = Math.max(maxZ, Math.abs(cz * 1.05) + 0.6);
  }
  b.block(maxX, maxZ);
}

/** A loose cluster of `count` steel drums around (x, z), a few tipped over. */
export function addBarrels(b: PropBuilder, x: number, z: number, count: number, seed: number): void {
  const k = getKinds();
  const random = createRandom(seed);
  b.at(x, z, 0);
  let reach = 0;
  for (let n = 0; n < count; n++) {
    const angle = (n / count) * Math.PI * 2 + random() * 0.6;
    const r = n === 0 ? 0 : 0.62 + random() * 0.5 * (n / count);
    const px = Math.cos(angle) * r;
    const pz = Math.sin(angle) * r;
    const tint = BARREL_TINTS[Math.floor(random() * BARREL_TINTS.length)];
    if (n > 1 && random() < 0.25) {
      // Lying on its side.
      const ry = random() * Math.PI;
      b.instance(k.barrel, px, BARREL_RADIUS, pz, { rz: Math.PI / 2, ry, color: tint });
      b.cylinderCollider(BARREL_HEIGHT / 2, BARREL_RADIUS, px, BARREL_RADIUS, pz, 0, ry, Math.PI / 2, 'metal');
    } else {
      b.instance(k.barrel, px, 0, pz, { ry: random() * Math.PI * 2, color: tint });
      b.cylinderCollider(BARREL_HEIGHT / 2, BARREL_RADIUS, px, BARREL_HEIGHT / 2, pz, 0, 0, 0, 'metal');
    }
    reach = Math.max(reach, r + 0.6);
  }
  b.block(reach, reach);
}

/** A straight sandbag wall `length` meters long and `rows` bags high, centered on (x, z), rows staggered. */
export function addSandbagWall(b: PropBuilder, x: number, z: number, yaw: number, length: number, rows: number, seed: number): void {
  const k = getKinds();
  const random = createRandom(seed);
  b.at(x, z, yaw);
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : BAG.length / 2;
    // Each row a little shorter than the one below.
    const half = length / 2 - row * 0.15;
    for (let d = -half + offset; d <= half - BAG.length * 0.4; d += BAG.length * 0.98) {
      b.instance(k.bag, d + BAG.length / 2, row * BAG.height * 0.92, (random() - 0.5) * 0.06, {
        ry: (random() - 0.5) * 0.14,
        scale: [1, 0.9 + random() * 0.15, 0.95 + random() * 0.1],
        color: toneColor(0.82 + random() * 0.3),
      });
    }
  }
  const height = rows * BAG.height * 0.92;
  b.collider(length / 2, height / 2, BAG.depth / 2, 0, height / 2, 0, 0, 'sand');
  b.block(length / 2, BAG.depth / 2 + 0.1);
}

/** A dry shrub at (x, z). Soft brush: no collider, and enemies walk through it. */
export function addShrub(b: PropBuilder, x: number, z: number, size: number, yaw: number, tone: number): void {
  b.at(x, z, yaw).instance(getKinds().shrub, 0, -0.05, 0, { scale: [size * 1.3, size, size * 1.3], color: toneColor(tone) });
}

/**
 * Telephone poles along `points` (x, z), with three wires sagging between each pair. Poles collide and block
 * their cell; the wires are only drawn.
 */
export function addPoleLine(b: PropBuilder, points: [number, number][]): void {
  const k = getKinds();
  for (let n = 0; n < points.length; n++) {
    const [x, z] = points[n];
    const next = points[n + 1];
    const yaw = next ? Math.atan2(-(next[1] - z), next[0] - x) + Math.PI / 2 : 0;
    b.at(x, z, yaw).instance(k.pole, 0, 0, 0, { rz: (n % 3) * 0.015 - 0.015 });
    b.cylinderCollider(POLE_HEIGHT / 2, 0.15, 0, POLE_HEIGHT / 2, 0, 0, 0, 0, 'wood');
    b.block(0.3, 0.3);
    if (!next) continue;
    // Three wires sagging from crossarm to crossarm.
    const dx = next[0] - x;
    const dz = next[1] - z;
    const span = Math.hypot(dx, dz);
    const segments = 10;
    b.at(x, z, Math.atan2(-dz, dx));
    for (const side of [-0.75, 0.25, 0.75]) {
      const points: [number, number, number][] = [];
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        points.push([t * span, POLE_HEIGHT - 0.38 - Math.sin(t * Math.PI) * 0.9, side]);
      }
      b.wire(points);
    }
  }
}

/** A gray tone as a color number. */
function toneColor(tone: number): number {
  const v = Math.round(Math.min(1, Math.max(0, tone)) * 255);
  return (v << 16) | (v << 8) | v;
}
