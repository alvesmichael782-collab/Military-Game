import type RAPIER from '@dimforge/rapier3d-compat';
import type { Scene } from 'three';
import { config } from '../core/config';
import type { BuildGrid } from './BuildGrid';
import type { DustRidgeMap } from './DustRidge';
import { PropBuilder } from './PropBuilder';
import { addBarrels, addCrateStack, addPoleLine, addSandbagWall, addShrub } from './props/Clutter';
import { addFence } from './props/Fence';
import { addRuinedHouse } from './props/RuinedHouse';
import { addTruck } from './props/Truck';
import { addWatchtower } from './props/Watchtower';
import { createRandom } from './random';

/*
 * Dust Ridge's static dressing, all outside the build area and clear of the lanes from both spawn points
 * (north at (0, -88), east at (88, 0)) to the outpost: three plaster-over-brick buildings, a watchtower, a
 * wrecked truck, chain-link fence runs, crate stacks, drums, sandbag walls, telephone poles and dry brush.
 * Props collide and block their cells on the build grid, so enemy routes go around them. None are destructible.
 */

/** Half the width of the kept-clear lanes along the axes from each spawn to the outpost, in meters. */
const LANE_HALF = 16;
/** No dressing within this distance of the core (the build area plus a margin), in meters. */
const OUTPOST_CLEAR = config.build.buildRadius + 6;
const SHRUBS = 70;

export function createMapProps(scene: Scene, world: RAPIER.World, grid: BuildGrid, map: DustRidgeMap): void {
  const b = new PropBuilder();

  addRuinedHouse(b, {
    x: -36, z: -52, yaw: 0, width: 9, depth: 6.5, height: 3.3, seed: 11, roof: 0.62, awning: true,
    ruin: { cornerX: 1, cornerZ: -1, radius: 3.8, depth: 2.4 },
    openings: [
      { side: 'front', at: -1.6, width: 1.6, bottom: 0, top: 2.4, door: true },
      { side: 'front', at: 2.3, width: 1.1, bottom: 1.1, top: 2.1 },
      { side: 'back', at: -2.4, width: 1.0, bottom: 1.2, top: 2.1 },
      { side: 'left', at: 0, width: 1.2, bottom: 1.1, top: 2.1 },
      { side: 'right', at: 0.6, width: 1.0, bottom: 1.1, top: 2.1 },
    ],
  });
  addRuinedHouse(b, {
    x: -60, z: 24, yaw: 0, width: 10, depth: 7, height: 3.2, seed: 23, roof: 0.85,
    ruin: { cornerX: -1, cornerZ: 1, radius: 3, depth: 1.8 },
    openings: [
      { side: 'right', at: 0, width: 1.6, bottom: 0, top: 2.4, door: true },
      { side: 'front', at: -2.5, width: 1.2, bottom: 1.1, top: 2.1 },
      { side: 'front', at: 2.5, width: 1.2, bottom: 1.1, top: 2.1 },
      { side: 'back', at: 0, width: 1.2, bottom: 1.1, top: 2.1 },
    ],
  });
  addRuinedHouse(b, {
    x: 48, z: -50, yaw: 0, width: 7, depth: 6, height: 3, seed: 37, roof: 0,
    ruin: { cornerX: -1, cornerZ: 1, radius: 5.5, depth: 2.6 },
    openings: [
      { side: 'back', at: 1, width: 1.5, bottom: 0, top: 2.3, door: true },
      { side: 'right', at: 0, width: 1.1, bottom: 1.1, top: 2.1 },
      { side: 'front', at: 1.8, width: 1.0, bottom: 1.1, top: 2.0 },
    ],
  });

  addWatchtower(b, 36, 38, 0.3);
  addTruck(b, -24, 58, 0.6);

  addFence(b, -74, 12, -46, 12, 51, [4], [8]);
  addFence(b, -46, 12, -46, 34, 52, [4, 5]);
  addFence(b, 58, 22, 94, 22, 53, [3], [6, 7]);
  addFence(b, 22, -72, 22, -40, 54, [2], [5]);

  addCrateStack(b, -28, -44, 0.2, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], 61);
  addCrateStack(b, 41, -40, -0.3, [[0, 0, 0], [1, 0, 0], [1, 0, 1]], 62);
  addCrateStack(b, -52, 16, 0.1, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 1, 1]], 63);
  addCrateStack(b, 72, -24, 0.5, [[0, 0, 0], [1, 0, 0]], 64);
  addCrateStack(b, -21, -80, 0.15, [[0, 0, 0], [0, 1, 0], [0, 0, 1]], 65);
  addCrateStack(b, 30, 48, -0.2, [[0, 0, 0], [1, 0, 0]], 66);

  addBarrels(b, -23, -49, 4, 71);
  addBarrels(b, 54, -40, 3, 72);
  addBarrels(b, -64, 33, 5, 73);
  addBarrels(b, 77, -16, 4, 74);
  addBarrels(b, -17, 63, 3, 75);
  addBarrels(b, 40, 44, 3, 76);
  addBarrels(b, 24, -80, 3, 77);

  addSandbagWall(b, -19, -86, 0.3, 4, 3, 81);
  addSandbagWall(b, 19, -84, -0.25, 3.6, 3, 82);
  addSandbagWall(b, 82, -19, Math.PI / 2 - 0.2, 3.6, 3, 83);
  addSandbagWall(b, 83, 19, Math.PI / 2 + 0.3, 4, 3, 84);
  addSandbagWall(b, 40, -57, 0.1, 3, 2, 85);
  addSandbagWall(b, 33, -24, 0.8, 3, 2, 86);

  addPoleLine(b, [-90, -67.5, -45, -22.5, 0, 22.5, 45, 67.5, 90].map((z) => [-84, z] as [number, number]));
  addPoleLine(b, [-60, -35, -10, 15, 40, 65, 90].map((x) => [x, 84] as [number, number]));

  b.build(scene, world, grid, 'props');

  // Dry brush scattered over the open desert, off the lanes and away from everything solid (now blocked on the grid).
  const brush = new PropBuilder();
  const random = createRandom(97);
  const spawns = map.spawnPoints;
  let placed = 0;
  for (let tries = 0; placed < SHRUBS && tries < 2000; tries++) {
    const x = (random() * 2 - 1) * 94;
    const z = (random() * 2 - 1) * 94;
    if (Math.hypot(x, z) < OUTPOST_CLEAR + 4) continue;
    if (inLane(x, z)) continue;
    if (spawns.some((p) => Math.hypot(p.x - x, p.z - z) < 8)) continue;
    if (map.obstacles.some((o) => Math.abs(o.center.x - x) < o.halfSize + 1 && Math.abs(o.center.z - z) < o.halfSize + 1)) continue;
    if (!grid.isWalkable(...cellOf(grid, x, z))) continue;
    addShrub(brush, x, z, 0.7 + random() * 0.9, random() * Math.PI, 0.8 + random() * 0.35);
    placed++;
  }
  brush.build(scene, world, grid, 'brush');
}

/** On the open lanes from the spawns to the outpost, which stay clear of dressing. */
function inLane(x: number, z: number): boolean {
  return (Math.abs(x) < LANE_HALF && z < 0) || (Math.abs(z) < LANE_HALF && x > 0);
}

function cellOf(grid: BuildGrid, x: number, z: number): [number, number] {
  const cell = { i: 0, j: 0 };
  grid.cellAt(x, z, cell);
  return [cell.i, cell.j];
}
