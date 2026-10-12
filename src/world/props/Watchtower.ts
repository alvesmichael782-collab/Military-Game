import type { PropBuilder } from '../PropBuilder';
import { PropMaterials } from '../PropMaterials';

/** Base and top spread of the legs, platform height and railing height, in meters. */
const BASE = 3.2;
const TOP = 2.5;
const DECK = 5.2;
const RAIL = 1.1;
const ROOF = 2.1;
const LEG = 0.2;

/**
 * A wooden watchtower (FPS-Model(2)): four tapering legs with cross braces, a plank deck with a railing, a
 * corrugated roof on corner posts and a ladder. The legs and the deck collide; the whole base is blocked for routes.
 */
export function addWatchtower(b: PropBuilder, x: number, z: number, yaw: number): void {
  const wood = PropMaterials.pole();
  const planks = PropMaterials.planks();
  const roofMat = PropMaterials.corrugated();
  b.at(x, z, yaw);

  const lean = Math.atan2((BASE - TOP) / 2, DECK);
  const legLength = Math.hypot(DECK, (BASE - TOP) / 2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const mx = (sx * (BASE + TOP)) / 4;
      const mz = (sz * (BASE + TOP)) / 4;
      b.box(wood, LEG, legLength, LEG, mx, DECK / 2, mz, { rx: -sz * lean, rz: sx * lean, uv: 'native', collide: 'wood' });
    }
  }
  // Cross braces on every side, two levels, and a ring beam under the deck.
  for (const level of [0.25, 0.62]) {
    const y0 = DECK * level;
    const y1 = DECK * (level + 0.33);
    const half0 = (BASE - (BASE - TOP) * level) / 2;
    const half1 = (BASE - (BASE - TOP) * (level + 0.33)) / 2;
    const span = half0 + half1;
    const rise = y1 - y0;
    const len = Math.hypot(span, rise);
    const tilt = Math.atan2(rise, span);
    for (const side of [-1, 1]) {
      const off = (half0 + half1) / 2;
      // Along x, on the faces at z = +-off.
      b.box(wood, len, 0.1, 0.08, 0, (y0 + y1) / 2, side * off, { rz: tilt, uv: 'native', ao: false });
      b.box(wood, len, 0.1, 0.08, 0, (y0 + y1) / 2, side * off, { rz: -tilt, uv: 'native', ao: false });
      b.box(wood, 0.08, 0.1, len, side * off, (y0 + y1) / 2, 0, { rx: tilt, uv: 'native', ao: false });
      b.box(wood, 0.08, 0.1, len, side * off, (y0 + y1) / 2, 0, { rx: -tilt, uv: 'native', ao: false });
    }
  }
  // Deck and its joists.
  const deck = TOP + 0.6;
  b.box(planks, deck, 0.14, deck, 0, DECK, 0, { uv: 1.5, ao: false, collide: 'wood' });
  for (const side of [-1, 1]) b.box(wood, deck, 0.18, 0.14, 0, DECK - 0.15, side * (TOP / 2), { uv: 'native', ao: false });
  // Railing: plank walls with a gap where the ladder comes up.
  const railY = DECK + 0.07 + RAIL / 2;
  const half = deck / 2 - 0.04;
  b.box(planks, deck, RAIL, 0.06, 0, railY, -half, { uv: 1.5, ao: false, tint: 0.92 });
  b.box(planks, 0.06, RAIL, deck, -half, railY, 0, { uv: 1.5, ao: false, tint: 0.92 });
  b.box(planks, 0.06, RAIL, deck, half, railY, 0, { uv: 1.5, ao: false, tint: 0.92 });
  b.box(planks, deck * 0.55, RAIL, 0.06, -deck * 0.225, railY, half, { uv: 1.5, ao: false, tint: 0.92 });
  // Corner posts and the roof, tipped back a little.
  const postHeight = ROOF + RAIL;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box(wood, 0.12, postHeight, 0.12, sx * half, DECK + postHeight / 2, sz * half, { uv: 'native', ao: false });
  }
  b.box(roofMat, deck + 0.5, 0.04, deck + 0.5, 0, DECK + postHeight + 0.05, 0, { rx: 0.12, uv: 2, ao: false });
  // Ladder up the open side.
  const ladderZ = BASE / 2 + 0.25;
  const ladderLen = Math.hypot(DECK, 0.6);
  const ladderTilt = Math.atan2(0.6, DECK);
  for (const side of [-0.28, 0.28]) {
    b.box(wood, 0.07, ladderLen, 0.07, deck * 0.25 + side, DECK / 2, ladderZ - 0.25, { rx: ladderTilt, uv: 'native' });
  }
  for (let k = 1; k < 16; k++) {
    const t = k / 16;
    b.box(wood, 0.62, 0.05, 0.05, deck * 0.25, DECK * t, ladderZ - 0.55 * t, { uv: 'native', ao: false });
  }
  b.block(BASE / 2 + 0.3, BASE / 2 + 0.6);
}
