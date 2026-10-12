import { BoxGeometry, Color, CylinderGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom } from '../world/random';

/*
 * MG nest layout in its own frame: centered on the 2 x 2 cell block (4 x 4 m), gun facing -Z.
 * A ring of three-high staggered sandbags with a gap at the back to step in, and a machine gun on a tripod.
 */

export const NEST = {
  /** Distance from the center to the middle of each sandbag wall, in meters. */
  ring: 1.62,
  /** Half the width of the entry gap in the back wall. */
  gapHalf: 0.65,
  bagLength: 0.62,
  bagHeight: 0.27,
  bagDepth: 0.38,
  rows: 3,
  /** Where the tripod stands. */
  gunZ: -0.75,
  gunHeight: 1.08,
} as const;

/** Height of the sandbag wall. */
export const NEST_WALL_HEIGHT = NEST.bagHeight * NEST.rows;

/** Tints over the burlap texture, so no two neighbouring bags look quite alike. */
const BAG_COLORS = [0xf2eee4, 0xe0dccd, 0xfbf7ee, 0xd6d0bf].map((c) => new Color(c));
const GUN_COLOR = new Color(0x3a3d37);
const GUN_DARK = new Color(0x2a2c28);
/** The turning gun as a ghost-only stand-in color (the built nest shows the textured model). */
const GHOST_GUN = new Color(0x3a3d37);
/** Vertex shade at the bottom of each bag (fake contact shadow). */
const BAG_BASE_SHADE = 0.62;

const matrix = new Matrix4();
const rotation = new Quaternion();
const scale = new Vector3(1, 1, 1);
const position = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Bake a solid vertex color into `geometry`, darkening vertices near its bottom by `baseShade`. */
function paint(geometry: BufferGeometry, color: Color, baseShade = 1): BufferGeometry {
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox!.min.y;
  const maxY = geometry.boundingBox!.max.y;
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const t = maxY > minY ? (positions.getY(i) - minY) / (maxY - minY) : 1;
    const shade = baseShade + (1 - baseShade) * t;
    colors.set([color.r * shade, color.g * shade, color.b * shade], i * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

function place(geometry: BufferGeometry, x: number, y: number, z: number, yaw = 0, pitch = 0): BufferGeometry {
  rotation.setFromAxisAngle(UP, yaw);
  if (pitch !== 0) rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
  return geometry.applyMatrix4(matrix.compose(position.set(x, y, z), rotation, scale));
}

/** Sandbags along a straight run from (x0, z0) to (x1, z1), rows staggered by half a bag. */
function bagRun(parts: BufferGeometry[], random: () => number, x0: number, z0: number, x1: number, z1: number): void {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(-(z1 - z0), x1 - x0);
  for (let row = 0; row < NEST.rows; row++) {
    const offset = row % 2 === 0 ? 0 : NEST.bagLength / 2;
    for (let d = offset; d < length - NEST.bagLength * 0.3; d += NEST.bagLength) {
      const span = Math.min(NEST.bagLength, length - d);
      const t = (d + span / 2) / length;
      const bag = new BoxGeometry(span * 0.96, NEST.bagHeight * (0.88 + random() * 0.12), NEST.bagDepth * (0.92 + random() * 0.12));
      paint(bag, BAG_COLORS[Math.floor(random() * BAG_COLORS.length)], BAG_BASE_SHADE);
      place(
        bag,
        x0 + (x1 - x0) * t,
        NEST.bagHeight * (row + 0.5),
        z0 + (z1 - z0) * t,
        yaw + (random() - 0.5) * 0.12,
      );
      parts.push(bag);
    }
  }
}

/** Where the gun turns: the tripod hub, where the legs meet, in the nest's frame. */
export const MG_HUB = { x: 0, y: NEST.gunHeight - 0.12, z: NEST.gunZ } as const;

/** The tripod's three legs, which stay put while the gun turns. */
function tripodParts(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const hub = new Vector3(MG_HUB.x, MG_HUB.y, MG_HUB.z);
  const legLength = 1.05;
  for (let k = 0; k < 3; k++) {
    // Two legs splay forward, one back.
    const a = (k / 3) * Math.PI * 2 + Math.PI;
    const leg = paint(new CylinderGeometry(0.025, 0.03, legLength, 5), GUN_DARK);
    leg.translate(0, -legLength / 2, 0);
    const lean = 0.5;
    rotation.setFromAxisAngle(new Vector3(Math.cos(a), 0, -Math.sin(a)), lean);
    leg.applyMatrix4(matrix.compose(hub, rotation, scale));
    parts.push(leg);
  }
  return parts;
}

/** The tripod head: a short collar at the hub that the gun's mount post drops into. */
function tripodHead(): BufferGeometry {
  return place(paint(new CylinderGeometry(0.045, 0.06, 0.12, 8), GUN_COLOR), MG_HUB.x, MG_HUB.y - 0.02, MG_HUB.z);
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('MG nest geometry failed to merge');
  return merged;
}

/** The sandbag ring. Same seed every time, so every nest (and its ghost) matches. */
function sandbagParts(): BufferGeometry[] {
  const random = createRandom(7451);
  const r = NEST.ring;
  const end = r + NEST.bagDepth / 2;
  const parts: BufferGeometry[] = [];
  bagRun(parts, random, -end, -r, end, -r); // front
  bagRun(parts, random, -r, -r + NEST.bagDepth / 2, -r, end); // left side
  bagRun(parts, random, r, -r + NEST.bagDepth / 2, r, end); // right side
  bagRun(parts, random, -r + NEST.bagDepth / 2, r, -NEST.gapHalf, r); // back, left of the gap
  bagRun(parts, random, NEST.gapHalf, r, r - NEST.bagDepth / 2, r); // back, right of the gap
  return parts;
}

/**
 * The static part of a built nest, in the nest's frame: the sandbags (vertex-colored, with box texture
 * coordinates for the burlap texture), the tripod legs and its head. The gun (`MgGunAsset`) turns on the hub.
 */
export function createMgNestBaseGeometry(): BufferGeometry {
  return merge([...sandbagParts(), ...tripodParts(), tripodHead()]);
}

/** The whole nest as one geometry, gun facing forward, for the build ghost. `gun` has its origin at the hub. */
export function createMgNestGeometry(gun: BufferGeometry): BufferGeometry {
  const placed = gun.clone().translate(MG_HUB.x, MG_HUB.y, MG_HUB.z);
  for (const name of Object.keys(placed.attributes)) if (name !== 'position' && name !== 'normal') placed.deleteAttribute(name);
  paint(placed, GHOST_GUN);
  const base = [...sandbagParts(), ...tripodParts(), tripodHead()].map((p) => {
    p.deleteAttribute('uv');
    return p;
  });
  return merge([...base, placed]);
}

/** Box colliders matching the nest in its own frame: [halfX, halfY, halfZ, x, y, z]. */
export function mgNestColliderBoxes(): [number, number, number, number, number, number][] {
  const r = NEST.ring;
  const t = NEST.bagDepth / 2;
  const h = NEST_WALL_HEIGHT / 2;
  const end = r + t;
  const backHalf = (r - NEST.gapHalf) / 2;
  return [
    [end, h, t, 0, h, -r],
    [t, h, end, -r, h, 0],
    [t, h, end, r, h, 0],
    [backHalf, h, t, -(NEST.gapHalf + backHalf), h, r],
    [backHalf, h, t, NEST.gapHalf + backHalf, h, r],
    // The gun and tripod, so the player cannot walk through them.
    [0.3, NEST.gunHeight / 2 + 0.05, 0.55, 0, NEST.gunHeight / 2 + 0.05, NEST.gunZ - 0.1],
  ];
}
