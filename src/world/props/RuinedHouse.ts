import type { PropBuilder } from '../PropBuilder';
import { PropMaterials } from '../PropMaterials';
import { createRandom } from '../random';

/*
 * Dust-style plaster-over-brick buildings (FPS-Model(3)): thick walls with a doorway and window holes, a flat
 * concrete roof with a low parapet, and a broken-down corner where the wall tops come down in jagged steps and
 * the roof has fallen in. Walls collide piece by piece, so the player can walk in through the doorway; the whole
 * footprint is blocked for enemy routes.
 */

export type WallSide = 'front' | 'back' | 'left' | 'right';

export interface Opening {
  side: WallSide;
  /** Center along the wall from its middle, in meters (positive toward +x on front/back, +z on the sides). */
  at: number;
  width: number;
  /** Bottom and top of the hole, in meters above the ground. A door starts at 0. */
  bottom: number;
  top: number;
  /** A door gets two wooden leaves swung open, a window a lintel and a sill. */
  door?: boolean;
}

export interface HouseSpec {
  x: number;
  z: number;
  yaw: number;
  /** Outer size along the house's x and z, and wall height, in meters. */
  width: number;
  depth: number;
  height: number;
  openings: Opening[];
  /** The broken corner (signs of x and z in the house's frame), how far the damage reaches and how deep it cuts. */
  ruin?: { cornerX: 1 | -1; cornerZ: 1 | -1; radius: number; depth: number };
  /** Fraction of the roof still standing, from the side away from the broken corner (0 for none). */
  roof: number;
  /** Corrugated awning over the first door. */
  awning?: boolean;
  seed: number;
}

const WALL = 0.32;
/** Ruined wall tops break into columns this wide. */
const COLUMN = 0.42;
const PARAPET = 0.3;
const ROOF = 0.22;

export function addRuinedHouse(b: PropBuilder, s: HouseSpec): void {
  const random = createRandom(s.seed);
  const plaster = PropMaterials.plaster();
  const concrete = PropMaterials.concrete();
  const planks = PropMaterials.planks();
  const hw = s.width / 2;
  const hd = s.depth / 2;
  b.at(s.x, s.z, s.yaw);
  for (const cx of [-1, 1]) for (const cz of [-1, 1]) b.corner(cx * (hw - WALL), cz * (hd - WALL));

  /** Wall top height at a point of the house's frame, lowered in jagged steps near the broken corner. */
  const topAt = (x: number, z: number): number => {
    if (!s.ruin) return s.height;
    const d = Math.hypot(x - s.ruin.cornerX * hw, z - s.ruin.cornerZ * hd);
    const t = Math.max(0, 1 - d / s.ruin.radius);
    const jag = (random() - 0.5) * 0.5;
    return Math.max(0.35, s.height - s.ruin.depth * Math.min(1, t * 1.4) - (t > 0 ? Math.abs(jag) * 0.9 : 0));
  };

  const walls: { side: WallSide; length: number; place: (u: number) => [number, number]; along: 'x' | 'z' }[] = [
    { side: 'front', length: s.width, place: (u) => [u, hd - WALL / 2], along: 'x' },
    { side: 'back', length: s.width, place: (u) => [u, -hd + WALL / 2], along: 'x' },
    { side: 'left', length: s.depth - WALL * 2, place: (u) => [-hw + WALL / 2, u], along: 'z' },
    { side: 'right', length: s.depth - WALL * 2, place: (u) => [hw - WALL / 2, u], along: 'z' },
  ];

  for (const wall of walls) {
    const holes = s.openings.filter((o) => o.side === wall.side);
    const half = wall.length / 2;
    // Break the wall where openings start and end, and into narrow columns where it is ruined.
    const cuts = new Set<number>([-half, half]);
    for (const o of holes) {
      cuts.add(Math.max(-half, o.at - o.width / 2));
      cuts.add(Math.min(half, o.at + o.width / 2));
    }
    const ruined = (u: number): boolean => {
      const [px, pz] = wall.place(u);
      return topAt(px, pz) < s.height - 0.01;
    };
    for (let u = -half + COLUMN; u < half; u += COLUMN) if (ruined(u) || ruined(u - COLUMN)) cuts.add(u);
    const sorted = [...cuts].sort((a, c) => a - c);

    for (let k = 0; k < sorted.length - 1; k++) {
      const a = sorted[k];
      const c = sorted[k + 1];
      if (c - a < 0.02) continue;
      const mid = (a + c) / 2;
      const [px, pz] = wall.place(mid);
      const top = topAt(px, pz);
      const hole = holes.find((o) => mid > o.at - o.width / 2 && mid < o.at + o.width / 2);
      const spans: [number, number][] = hole ? [[0, hole.bottom], [hole.top, top]] : [[0, top]];
      for (const [y0, y1] of spans) {
        if (y1 - y0 < 0.05) continue;
        const len = c - a;
        const [w, d] = wall.along === 'x' ? [len, WALL] : [WALL, len];
        b.box(plaster, w, y1 - y0, d, px, (y0 + y1) / 2, pz, { uv: 4, collide: 'concrete' });
      }
    }

    for (const o of holes) {
      const [px, pz] = wall.place(o.at);
      const top = topAt(px, pz);
      const along = wall.along === 'x';
      // Wooden lintel over every opening that still has wall above it.
      if (top > o.top + 0.12) {
        const [w, d] = along ? [o.width + 0.3, WALL + 0.04] : [WALL + 0.04, o.width + 0.3];
        b.box(planks, w, 0.14, d, px, o.top + 0.07, pz, { uv: 2, ao: false, tint: 0.85 });
      }
      if (o.door) {
        addDoorLeaves(b, o, wall.side, px, pz);
      } else {
        const out = sideNormal(wall.side);
        const [w, d] = along ? [o.width + 0.12, WALL + 0.12] : [WALL + 0.12, o.width + 0.12];
        b.box(concrete, w, 0.08, d, px + out[0] * 0.04, o.bottom - 0.04, pz + out[1] * 0.04, { uv: 2, tint: 0.95 });
      }
    }
  }

  // Flat concrete roof with a parapet, from the sound side across to where it has fallen in.
  if (s.roof > 0) {
    const fromX = s.ruin ? -s.ruin.cornerX : 1;
    const length = s.width * s.roof;
    const edge = fromX * hw - fromX * length;
    // The broken edge is ragged: the roof ends in three strips of different lengths.
    const strips = 3;
    for (let k = 0; k < strips; k++) {
      const z0 = -hd + (s.depth / strips) * k;
      const stripLength = k === 0 && s.ruin ? length : length - (s.roof < 1 ? random() * 1.4 : 0);
      const cx = fromX * hw - (fromX * stripLength) / 2;
      b.box(concrete, stripLength, ROOF, s.depth / strips, cx, s.height + ROOF / 2, z0 + s.depth / strips / 2, {
        uv: 2,
        tint: 0.92,
        collide: 'concrete',
      });
    }
    // Parapet along the standing roof edges.
    const parapetX = fromX * hw - (fromX * length) / 2;
    for (const z of [-hd + WALL / 2, hd - WALL / 2]) {
      b.box(plaster, length, PARAPET, WALL, parapetX, s.height + ROOF + PARAPET / 2, z, { uv: 4, ao: false });
    }
    b.box(plaster, WALL, PARAPET, s.depth - WALL * 2, fromX * (hw - WALL / 2), s.height + ROOF + PARAPET / 2, 0, { uv: 4, ao: false });
    // Rebar sticking out of the broken edge.
    if (s.roof < 1) {
      const dark = PropMaterials.darkMetal();
      for (let k = 0; k < 7; k++) {
        b.box(dark, 0.025, 0.025, 0.5 + random() * 0.5, edge + fromX * -0.15, s.height + ROOF * 0.4, -hd + 0.4 + random() * (s.depth - 0.8), {
          ry: Math.PI / 2 + (random() - 0.5) * 0.6,
          rz: (random() - 0.5) * 0.5,
          ao: false,
          tint: [0.7, 0.45, 0.3],
        });
      }
    }
  }

  // Rubble from the broken corner, inside and out.
  if (s.ruin) {
    for (let k = 0; k < 14; k++) {
      const size = 0.2 + random() * 0.55;
      const inside = k % 2 === 0;
      const r = 0.6 + random() * (s.ruin.radius * 0.7);
      const angle = random() * Math.PI * 2;
      let x = s.ruin.cornerX * (hw - (inside ? r * 0.7 : -r * 0.4));
      let z = s.ruin.cornerZ * (hd - (inside ? r * 0.5 : -r * 0.3));
      x += Math.cos(angle) * 0.4;
      z += Math.sin(angle) * 0.4;
      b.box(random() < 0.6 ? plaster : concrete, size * 1.4, size * 0.7, size, x, size * 0.3, z, {
        ry: random() * Math.PI,
        rx: (random() - 0.5) * 0.5,
        rz: (random() - 0.5) * 0.5,
        uv: 2,
      });
    }
  }

  // A corrugated awning on two poles over the first door.
  const door = s.openings.find((o) => o.door);
  if (s.awning && door) {
    const n = sideNormal(door.side);
    const [px, pz] = walls.find((w) => w.side === door.side)!.place(door.at);
    const along = door.side === 'front' || door.side === 'back';
    const span = door.width + 1.2;
    const reach = 1.3;
    const ax = px + n[0] * (reach / 2 + WALL / 2);
    const az = pz + n[1] * (reach / 2 + WALL / 2);
    const tilt = 0.18;
    b.box(PropMaterials.corrugated(), along ? span : reach, 0.03, along ? reach : span, ax, door.top + 0.45, az, {
      rx: along ? n[1] * tilt : 0,
      rz: along ? 0 : -n[0] * tilt,
      uv: 2,
      ao: false,
    });
    const pole = PropMaterials.pole();
    for (const side of [-1, 1]) {
      const ox = along ? (side * span) / 2 - side * 0.1 : n[0] * (reach - 0.1);
      const oz = along ? n[1] * (reach - 0.1) : (side * span) / 2 - side * 0.1;
      b.box(pole, 0.1, door.top + 0.3, 0.1, px + (along ? ox : ox + n[0] * WALL / 2), (door.top + 0.3) / 2, pz + (along ? oz + n[1] * WALL / 2 : oz), {
        uv: 'native',
        collide: 'wood',
      });
    }
  }

  b.block(hw + 0.2, hd + 0.2);
}

/** Outward direction (x, z) of a wall side, in the house's frame. */
function sideNormal(side: WallSide): [number, number] {
  switch (side) {
    case 'front':
      return [0, 1];
    case 'back':
      return [0, -1];
    case 'left':
      return [-1, 0];
    case 'right':
      return [1, 0];
  }
}

/** Two wooden door leaves hinged at the sides of a doorway, swung open outward at different angles. */
function addDoorLeaves(b: PropBuilder, o: Opening, side: WallSide, px: number, pz: number): void {
  const planks = PropMaterials.planks();
  const leaf = o.width / 2;
  const height = o.top - o.bottom - 0.04;
  const n = sideNormal(side);
  const along = side === 'front' || side === 'back';
  // The wall's run direction, and the outer face of the wall.
  const runX = along ? 1 : 0;
  const runZ = along ? 0 : 1;
  const faceX = px + n[0] * (WALL / 2);
  const faceZ = pz + n[1] * (WALL / 2);
  const wallYaw = Math.atan2(-runZ, runX);
  for (const [hinge, swing] of [[-1, 1.9], [1, 0.75]] as const) {
    const hx = faceX + runX * hinge * leaf;
    const hz = faceZ + runZ * hinge * leaf;
    // The leaf turns about its hinge, outward, from lying in the doorway.
    const angle = wallYaw + (hinge < 0 ? 1 : -1) * swing * (n[0] + n[1] > 0 ? 1 : -1) * (along ? 1 : -1);
    const cx = hx - Math.cos(angle) * hinge * (leaf / 2);
    const cz = hz + Math.sin(angle) * hinge * (leaf / 2);
    b.box(planks, leaf - 0.04, height, 0.06, cx, o.bottom + height / 2 + 0.02, cz, { ry: angle, uv: 1.5, tint: [0.92, 0.8, 0.66], collide: 'wood' });
  }
}
