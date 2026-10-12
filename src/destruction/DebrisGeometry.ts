import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, IcosahedronGeometry, Vector3 } from 'three';
import { createRandom } from '../world/random';

/** Debris chunk kinds. Walls throw bricks, plaster slabs and broken blocks; the MG nest throws torn sandbags. */
export const DEBRIS_KINDS = ['brick', 'plaster', 'block', 'bag'] as const;
export type DebrisKind = (typeof DEBRIS_KINDS)[number];

/** Each kind's collider half sizes, in meters. */
export const DEBRIS_HALF_EXTENTS: Record<DebrisKind, Vector3> = {
  brick: new Vector3(0.11, 0.036, 0.055),
  plaster: new Vector3(0.13, 0.022, 0.1),
  block: new Vector3(0.13, 0.09, 0.1),
  bag: new Vector3(0.25, 0.075, 0.15),
};

const BRICK = new Color(0x93533b);
const MORTAR = new Color(0xa89c86);
const PLASTER = new Color(0xd0ba90);
const SCRATCH = new Color(0xb0a48c);
const BAG = new Color(0x9d936a);
const BAG_DARK = new Color(0x837c55);

/** Color each triangle (non-indexed) by `pick(normal, centroid)`, and drop the uvs. */
function colorFaces(geometry: BufferGeometry, pick: (normal: Vector3, center: Vector3) => Color): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute('uv');
  flat.computeVertexNormals();
  const positions = flat.getAttribute('position');
  const normals = flat.getAttribute('normal');
  const colors = new Float32Array(positions.count * 3);
  const normal = new Vector3();
  const center = new Vector3();
  for (let i = 0; i < positions.count; i += 3) {
    normal.fromBufferAttribute(normals, i);
    center.set(0, 0, 0);
    for (let k = 0; k < 3; k++) center.x += positions.getX(i + k) / 3;
    for (let k = 0; k < 3; k++) center.y += positions.getY(i + k) / 3;
    for (let k = 0; k < 3; k++) center.z += positions.getZ(i + k) / 3;
    const c = pick(normal, center);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  flat.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return flat;
}

/** A low-poly chunk for each debris kind, sized to its collider. */
export function createDebrisGeometry(kind: DebrisKind): BufferGeometry {
  const h = DEBRIS_HALF_EXTENTS[kind];
  switch (kind) {
    case 'brick':
      // Mortar still stuck to one face.
      return colorFaces(new BoxGeometry(h.x * 2, h.y * 2, h.z * 2), (n) => (n.y > 0.9 ? MORTAR : BRICK));
    case 'plaster':
      // Painted plaster on top, scratch coat underneath.
      return colorFaces(new BoxGeometry(h.x * 2, h.y * 2, h.z * 2), (n) => (n.y > 0.9 ? PLASTER : SCRATCH));
    case 'block': {
      // A rough broken lump: plaster on its outer face, brick everywhere it broke.
      const lump = new IcosahedronGeometry(1, 0);
      const random = createRandom(311);
      const positions = lump.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const f = 0.8 + random() * 0.35;
        positions.setXYZ(i, positions.getX(i) * h.x * f, positions.getY(i) * h.y * f, positions.getZ(i) * h.z * f);
      }
      return colorFaces(lump, (n) => (n.z > 0.55 ? PLASTER : BRICK));
    }
    case 'bag':
      return colorFaces(new BoxGeometry(h.x * 2, h.y * 2, h.z * 2), (n) => (n.y > 0.9 ? BAG : BAG_DARK));
  }
}
