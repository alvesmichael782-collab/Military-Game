import { Vector3 } from 'three';
import { config } from './config';
import type { Explosions } from '../combat/Explosion';
import type { StructureManager } from '../build/StructureManager';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { PlayerArmor } from '../player/PlayerArmor';
import type { PlayerHealth } from '../player/PlayerHealth';
import type { BuildGrid, Edge } from '../world/BuildGrid';

/** Grid points of the ring's corners: 15 edges a side, 60 walls, about 15 m out from the core. */
const RING_MIN = 43;
const RING_MAX = 58;
/** Most enemies alive at once during the test. */
const ENEMIES = 20;
/** Seconds between grenade blasts, satchel charges, enemy top-ups and wall rebuilds. */
const GRENADE_GAP = 0.4;
const SATCHEL_GAP = 1.5;
const SPAWN_GAP = 0.5;
const REBUILD_GAP = 2;
/** Every this many enemies spawned, one is a sapper. */
const SAPPER_EVERY = 4;
/** How far outside a wall's face the blasts go off, in meters. */
const BLAST_OFFSET = 0.6;

export interface StressTargets {
  grid: BuildGrid;
  structures: StructureManager;
  enemies: EnemyManager;
  explosions: Explosions;
  health: PlayerHealth;
  armor: PlayerArmor;
}

/**
 * Debug load test (`?stress` in the URL, or F9): a ring of 60 walls around the core, kept rebuilt; enemies topped
 * up to 20 alive; a grenade blast every 0.4 s and a satchel every 1.5 s against random walls, so debris and rubble
 * pile up; the player kept alive. Runs until toggled off. The debug overlay (F3) shows the frame time split.
 */
export class StressTest {
  private _active = false;
  private readonly ring: Edge[] = [];
  private grenadeTimer = 0;
  private satchelTimer = 0;
  private spawnTimer = 0;
  private rebuildTimer = 0;
  private spawned = 0;
  private readonly point = new Vector3();

  constructor(private readonly t: StressTargets) {
    for (let k = RING_MIN; k < RING_MAX; k++) {
      this.ring.push({ axis: 'x', i: k, j: RING_MIN }, { axis: 'x', i: k, j: RING_MAX });
      this.ring.push({ axis: 'z', i: RING_MIN, j: k }, { axis: 'z', i: RING_MAX, j: k });
    }
  }

  get active(): boolean {
    return this._active;
  }

  toggle(): void {
    this._active = !this._active;
    if (this._active) this.rebuild();
    console.info(`[stress] ${this._active ? 'on' : 'off'}`);
  }

  /** Call once per rendered frame. */
  update(dt: number): void {
    if (!this._active) return;
    const t = this.t;
    t.health.refill();
    t.armor.refill();

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_GAP;
      if (t.enemies.aliveCount < ENEMIES) {
        const type = ++this.spawned % SAPPER_EVERY === 0 ? 'sapper' : 'rifleman';
        t.enemies.spawnAtPoint(type, this.spawned % config.map.spawnPoints.length);
      }
    }

    this.grenadeTimer -= dt;
    if (this.grenadeTimer <= 0) {
      this.grenadeTimer = GRENADE_GAP;
      const g = config.grenade;
      t.explosions.explode(this.blastPoint(0.5), g.radius, g.damage, 'environment');
    }

    this.satchelTimer -= dt;
    if (this.satchelTimer <= 0) {
      this.satchelTimer = SATCHEL_GAP;
      t.enemies.satchels.arm(this.blastPoint(0), 0, config.satchel.fuse, false);
    }

    this.rebuildTimer -= dt;
    if (this.rebuildTimer <= 0) {
      this.rebuildTimer = REBUILD_GAP;
      this.rebuild();
    }
  }

  /** Put back every ring wall that is gone. */
  private rebuild(): void {
    for (const edge of this.ring) if (this.t.grid.isEdgeFree(edge)) this.t.structures.placeWall(edge, 0);
  }

  /** A point just off a random ring wall (either side), at `height`, written to `point`. */
  private blastPoint(height: number): Vector3 {
    const edge = this.ring[Math.floor(Math.random() * this.ring.length)];
    const grid = this.t.grid;
    const off = Math.random() < 0.5 ? -BLAST_OFFSET : BLAST_OFFSET;
    const half = config.build.cellSize / 2;
    if (edge.axis === 'x') this.point.set(grid.vertexX(edge.i) + half, height, grid.vertexZ(edge.j) + off);
    else this.point.set(grid.vertexX(edge.i) + off, height, grid.vertexZ(edge.j) + half);
    return this.point;
  }
}
