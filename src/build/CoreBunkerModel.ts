import { Object3D, type MeshLambertMaterial } from 'three';
import { PropBuilder } from '../world/PropBuilder';
import { PropMaterials } from '../world/PropMaterials';
import { sandbagKind, SANDBAG } from '../world/props/Clutter';
import { createRandom } from '../world/random';

/*
 * The outpost core as a small command bunker, inside the core's square footprint and collider height: a
 * board-marked concrete block with chipped plaster, a thick roof slab, a steel door facing south (toward the
 * player's start), a firing slit, a ring of sandbags around the base with a gap at the door, a radio antenna
 * on the roof and a couple of ammo boxes.
 */

export interface CoreBunker {
  readonly object: Object3D;
  /** The bunker's own materials (not shared with the map props), darkened when it is destroyed. */
  readonly materials: MeshLambertMaterial[];
}

export function createCoreBunker(size: number, height: number): CoreBunker {
  const half = size / 2;
  const concrete = PropMaterials.concrete().clone();
  const door = PropMaterials.steelDoor().clone();
  const metal = PropMaterials.darkMetal().clone();
  const olive = PropMaterials.oliveMetal().clone();
  const random = createRandom(4401);
  const b = new PropBuilder().at(0, 0, 0);

  // The block, set in from the footprint by the sandbag ring, and the roof slab over it.
  const body = size - 0.5;
  const roof = 0.24;
  b.box(concrete, body, height - roof, body, 0, (height - roof) / 2, 0, { uv: 2 });
  b.box(concrete, size - 0.08, roof, size - 0.08, 0, height - roof / 2, 0, { uv: 2, tint: 0.9, ao: false });
  // Steel door and its frame on the south face (+z), a firing slit on the north face.
  const face = body / 2;
  b.box(metal, 0.92, 1.62, 0.06, 0, 0.82, face + 0.01, { tint: 0.55, ao: false });
  b.box(door, 0.8, 1.52, 0.05, 0, 0.78, face + 0.04, { uv: 'native' });
  b.box(metal, 1.1, 0.14, 0.08, 0, height * 0.62, -face - 0.02, { tint: 0.15, ao: false });
  b.box(concrete, 1.3, 0.1, 0.24, 0, height * 0.62 + 0.12, -face - 0.08, { uv: 2, ao: false });

  // Sandbags around the base, two rows, open in front of the door.
  const bag = sandbagKind();
  const ring = half - SANDBAG.depth / 2;
  const doorGap = 0.55;
  for (let row = 0; row < 2; row++) {
    const y = row * SANDBAG.height * 0.92;
    for (const side of ['north', 'south', 'east', 'west'] as const) {
      const offset = row % 2 === 0 ? 0 : SANDBAG.length / 2;
      for (let d = -half + offset + SANDBAG.length / 2; d < half - SANDBAG.length * 0.4; d += SANDBAG.length * 0.96) {
        if (side === 'south' && Math.abs(d) < doorGap) continue;
        // Corners belong to the north and south runs.
        if ((side === 'east' || side === 'west') && Math.abs(d) > ring - SANDBAG.depth / 2) continue;
        const x = side === 'east' ? ring : side === 'west' ? -ring : d;
        const z = side === 'north' ? -ring : side === 'south' ? ring : d;
        const ry = (side === 'east' || side === 'west' ? Math.PI / 2 : 0) + (random() - 0.5) * 0.12;
        b.instance(bag, x, y, z, { ry, scale: [0.96, 0.9 + random() * 0.15, 1], color: tone(0.8 + random() * 0.3) });
      }
    }
  }

  // Radio antenna on the roof: a box set, a mast and a whip.
  const top = height;
  b.box(olive, 0.42, 0.26, 0.3, -half + 0.45, top + 0.13, -half + 0.4, { uv: 'native', ao: false });
  b.cylinder(metal, 0.02, 0.03, 2.4, 6, -half + 0.3, top + 1.2, -half + 0.3, { tint: 0.7, ao: false });
  b.cylinder(metal, 0.008, 0.012, 1.4, 4, -half + 0.3, top + 3.0, -half + 0.3, { tint: 0.5, ao: false, rz: 0.05 });
  // Ammo boxes on the roof and stacked by the door.
  b.box(olive, 0.5, 0.24, 0.26, half - 0.5, top + 0.12, half - 0.45, { ry: 0.3, uv: 'native', ao: false });
  b.box(olive, 0.48, 0.26, 0.26, half - 0.32, 0.13 + SANDBAG.height * 1.84, half - 0.2, { ry: -0.2, uv: 'native' });
  b.box(olive, 0.48, 0.26, 0.26, half - 0.36, 0.13 + SANDBAG.height * 1.84 + 0.26, half - 0.22, { ry: 0.15, uv: 'native', ao: false });
  // Sandbags on the roof edge, as cover for the radio.
  for (let k = 0; k < 3; k++) {
    b.instance(bag, -half + 0.45 + k * 0.58, top, half - 0.3, { color: tone(0.85 + random() * 0.2) });
  }

  const object = new Object3D();
  object.name = 'outpostCore';
  b.buildMeshes(object, 'outpostCore');
  return { object, materials: [concrete, door, metal, olive] };
}

function tone(t: number): number {
  const v = Math.round(Math.min(1, t) * 255);
  return (v << 16) | (v << 8) | v;
}
