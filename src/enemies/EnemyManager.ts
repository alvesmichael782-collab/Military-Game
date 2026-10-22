import { profiler } from '../core/FrameProfiler';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, type Scene } from 'three';
import { CORE_SIZE } from '../build/OutpostCore';
import type { StructureManager } from '../build/StructureManager';
import { applyDamage } from '../combat/Damage';
import type { DamageableRegistry } from '../combat/DamageableRegistry';
import type { Explosions } from '../combat/Explosion';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { BuildGrid, Cell } from '../world/BuildGrid';
import { createEnemyController, Enemy } from './Enemy';
import type { CoreTarget, EnemyContext, PlayerTarget } from './EnemyContext';
import type { EnemyType } from './EnemyType';
import { Pathfinder } from './Pathfinder';
import { Rifleman } from './Rifleman';
import { Sapper } from './Sapper';
import { Satchels } from './Satchels';
import { SightBudget } from './SightBudget';
import { UNIFORM_COLORS } from './SoldierGeometry';
import { SoldierRenderer } from './SoldierRenderer';

/** Seconds before an enemy whose path search failed asks again. */
const PATH_RETRY = 1;
/** Enemies spawn within this distance of a spawn point's center, in meters (the pads are 3 m in radius). */
const SPAWN_SCATTER = 2.5;

/**
 * Owns every enemy: a fixed pool per type (nothing is created during play), the soldier renderer, the
 * satchel pool, the path queue (searched within a per-frame budget) and the sight budget. Runs movement in
 * the fixed step and thinking, timers and drawing per frame. Re-plans routes after the walls change
 * (debounced), and turns `damageDealt` on enemies into `enemyDamaged` and `enemyKilled`.
 */
export class EnemyManager {
  readonly satchels: Satchels;
  private readonly renderer: SoldierRenderer;
  private readonly pools: Record<EnemyType, Enemy[]>;
  private readonly all: Enemy[] = [];
  private readonly pathfinder: Pathfinder;
  private readonly queue: Enemy[] = [];
  private readonly sight: SightBudget;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly ctx: EnemyContext;
  private time = 0;
  private readonly retryAt = new Map<Enemy, number>();
  private readonly spawnOrder: Enemy[] = [];
  private _frozen = false;
  private repathTimer = -1;
  private repathAll = false;
  private readonly repathCells = new Set<number>();
  private pathsThisWindow = 0;
  private windowStart = 0;
  private _pathRate = 0;
  private readonly from = new Vector3();
  /** Multiplayer client: the host runs the AI; these soldiers only show what the host's snapshots say. */
  private replica = false;
  /** Uniform color of each soldier slot, for the host's snapshots. */
  private readonly uniforms: number[] = [];

  constructor(
    scene: Scene,
    world: RAPIER.World,
    private readonly grid: BuildGrid,
    registry: DamageableRegistry,
    private readonly events: EventBus<GameEvents>,
    structures: StructureManager,
    explosions: Explosions,
    players: readonly PlayerTarget[],
    core: CoreTarget,
    private readonly spawnPoints: readonly Vector3[],
  ) {
    const capacity = config.enemies.maxActive;
    this.renderer = new SoldierRenderer(scene, capacity * 2);
    this.satchels = new Satchels(scene, explosions, events);
    this.sight = new SightBudget(world);
    this.controller = createEnemyController(world);
    this.pathfinder = new Pathfinder(grid, (id) => structures.byId(id), this.coreCells(core));
    this.ctx = {
      world,
      grid,
      registry,
      events,
      players,
      core,
      sight: this.sight,
      satchels: this.satchels,
      wall: (id) => structures.byId(id),
      requestPath: (enemy) => this.requestPath(enemy),
      now: () => this.time,
    };

    // Riflemen take renderer slots 0..capacity-1, sappers the next block.
    this.pools = {
      rifleman: Array.from({ length: capacity }, (_, i) => new Rifleman(i, this.ctx)),
      sapper: Array.from({ length: capacity }, (_, i) => new Sapper(capacity + i, this.ctx)),
    };
    this.all.push(...this.pools.rifleman, ...this.pools.sapper);

    events.on('navChanged', ({ edge, blocked }) => {
      if (!blocked) this.scheduleRepath(null);
      else {
        const a: Cell = { i: 0, j: 0 };
        const b: Cell = { i: 0, j: 0 };
        grid.edgeCells(edge, a, b);
        this.scheduleRepath([a, b]);
      }
    });
    events.on('navCellsChanged', ({ cells, blocked }) => this.scheduleRepath(blocked ? cells : null));
    events.on('damageDealt', ({ target, amount, source, headshot, killed, player, routed }) => {
      // A routed hit was sent to the host, which reports the kill.
      if (!(target instanceof Enemy) || routed) return;
      const position = target.currFeet.clone();
      if (killed) events.emit('enemyKilled', { id: target.slot, type: target.type, position, source, headshot, killer: player });
      else events.emit('enemyDamaged', { id: target.slot, type: target.type, position, amount, hp: target.hp, maxHp: target.maxHp, source, headshot });
    });
  }

  /** Multiplayer client: stop all AI; the soldiers are driven by `replica*` calls from the host's snapshots. */
  setReplica(on: boolean): void {
    this.replica = on;
  }

  /** The pooled soldier in renderer slot `slot`, if any. */
  bySlot(slot: number): Enemy | undefined {
    return this.all[slot];
  }

  /** The uniform color soldier `slot` was given at its last spawn. */
  uniformOf(slot: number): number {
    return this.uniforms[slot] ?? UNIFORM_COLORS.tan;
  }

  /** Multiplayer client: bring soldier `slot` in as the host's. */
  replicaSpawn(slot: number, at: Vector3, yaw: number, uniform: number): Enemy | undefined {
    const enemy = this.all[slot];
    if (!enemy) return undefined;
    if (enemy.active) this.release(enemy);
    enemy.replicaSpawn(at, yaw);
    this.renderer.setUniform(slot, uniform);
    return enemy;
  }

  /** Multiplayer client: the host no longer has soldier `slot` on the field. */
  replicaRelease(slot: number): void {
    const enemy = this.all[slot];
    if (enemy?.active) this.release(enemy);
  }

  /** Every pooled enemy, for the debug view. */
  get enemies(): readonly Enemy[] {
    return this.all;
  }

  get aliveCount(): number {
    let n = 0;
    for (const enemy of this.all) if (enemy.isAlive) n++;
    return n;
  }

  /** Path searches run during the last second. */
  get pathRequestsPerSecond(): number {
    return this._pathRate;
  }

  /** Sight checks made during the last frame. */
  get sightChecksPerFrame(): number {
    return this.sight.lastFrameChecks;
  }

  get frozen(): boolean {
    return this._frozen;
  }

  /** The live structure with this id, for the debug view's breach highlight. */
  wall(id: number): ReturnType<EnemyContext['wall']> {
    return this.ctx.wall(id);
  }

  /** Debug: stop or restart all AI and movement. */
  toggleFreeze(): void {
    this._frozen = !this._frozen;
  }

  /**
   * Bring an enemy in at a random spawn point (or at `at`). Returns null if the pool is full of living
   * enemies; a corpse still lying around is cleared early to make room.
   */
  spawn(type: EnemyType, at?: Vector3, scatter = at ? 0 : SPAWN_SCATTER): Enemy | null {
    let active = 0;
    for (const enemy of this.all) if (enemy.active) active++;
    if (active >= config.enemies.maxActive && !this.clearOldestCorpse()) return null;
    const enemy = this.pools[type].find((e) => !e.active);
    if (!enemy) return null;

    const point = at ?? this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * scatter;
    const position = new Vector3(point.x + Math.cos(angle) * r, 0, point.z + Math.sin(angle) * r);
    const core = this.ctx.core.base;
    enemy.spawn(position, Math.atan2(core.x - position.x, core.z - position.z));
    // Riflemen come in desert tan or olive, picked per soldier; sappers have their own darker kit.
    const uniform = type === 'sapper' ? UNIFORM_COLORS.sapper : Math.random() < 0.5 ? UNIFORM_COLORS.tan : UNIFORM_COLORS.olive;
    this.uniforms[enemy.slot] = uniform;
    this.renderer.setUniform(enemy.slot, uniform);
    // Stagger thinking across the pool.
    enemy.thinkTimer = Math.random() * config.enemies.thinkInterval;
    this.retryAt.delete(enemy);
    this.spawnOrder.push(enemy);
    this.events.emit('enemySpawned', { id: enemy.slot, type, position: position.clone() });
    return enemy;
  }

  /** Bring an enemy in somewhere on the pad of spawn point `index`. Same as `spawn` otherwise. */
  spawnAtPoint(type: EnemyType, index: number): Enemy | null {
    const point = this.spawnPoints[index];
    return point ? this.spawn(type, point, SPAWN_SCATTER) : null;
  }

  /** Take every dead body off the field now (they normally sink away on their own). */
  clearCorpses(): void {
    for (const enemy of this.all) if (enemy.state === 'dead') this.release(enemy);
  }

  /** Kill every living enemy (debug keys, and a fight that timed out). No cash, and carried satchels are not dropped. */
  killAll(): void {
    for (const enemy of this.all) {
      if (!enemy.isAlive) continue;
      enemy.quietDeath = true;
      const angle = Math.random() * Math.PI * 2;
      this.from.set(enemy.currFeet.x + Math.cos(angle), 1, enemy.currFeet.z + Math.sin(angle));
      applyDamage(enemy, enemy.hp + 1, 'ballistic', this.from, { source: 'environment' });
    }
  }

  /** Movement for one fixed step, with separation steering. Call before the physics step. */
  fixedUpdate(dt: number): void {
    if (this._frozen || this.replica) return;
    const radius = config.enemies.separationRadius;
    const all = this.all;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a.isAlive) continue;
      let sx = 0;
      let sz = 0;
      for (let j = 0; j < all.length; j++) {
        if (i === j) continue;
        const b = all[j];
        if (!b.isAlive) continue;
        const dx = a.currFeet.x - b.currFeet.x;
        const dz = a.currFeet.z - b.currFeet.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-4) {
          // Exactly on top of each other: split by slot so they never cancel out.
          sx += i < j ? 1 : -1;
          continue;
        }
        const push = 1 - d / radius;
        sx += (dx / d) * push;
        sz += (dz / d) * push;
      }
      a.fixedUpdate(dt, sx, sz, this.controller);
    }
  }

  /** Thinking, timers, path searches and drawing. Call once per rendered frame. */
  update(dt: number, alpha: number): void {
    this.sight.beginFrame();
    if (this.replica) {
      // The host's satchels, mirrored here so they blink, beep and blow up (harmlessly) in sync.
      this.satchels.update(dt);
    } else if (!this._frozen) {
      this.time += dt;
      this.updateRepath(dt);
      profiler.begin('path');
      this.runPathQueue();
      profiler.end('path');
      const interval = config.enemies.thinkInterval;
      for (const enemy of this.all) {
        if (!enemy.active) continue;
        enemy.update(dt);
        if (enemy.isAlive) {
          enemy.thinkTimer -= dt;
          if (enemy.thinkTimer <= 0) {
            enemy.think();
            enemy.thinkTimer = Math.max(enemy.thinkTimer + interval, interval * 0.5);
          }
          this.retryFailedPath(enemy);
        } else if (enemy.finished) {
          this.release(enemy);
        }
      }
      this.satchels.update(dt);
    }
    for (const enemy of this.all) if (enemy.active) enemy.render(alpha, this.renderer);
    this.renderer.flush();
  }

  /** The grid cells under the core's footprint. */
  private coreCells(core: CoreTarget): Cell[] {
    const half = CORE_SIZE / 2 - 0.01;
    const min: Cell = { i: 0, j: 0 };
    const max: Cell = { i: 0, j: 0 };
    this.grid.cellAt(core.base.x - half, core.base.z - half, min);
    this.grid.cellAt(core.base.x + half, core.base.z + half, max);
    const cells: Cell[] = [];
    for (let j = min.j; j <= max.j; j++) for (let i = min.i; i <= max.i; i++) cells.push({ i, j });
    return cells;
  }

  private requestPath(enemy: Enemy): void {
    if (this.replica || enemy.pathQueued || !enemy.isAlive) return;
    enemy.pathQueued = true;
    this.queue.push(enemy);
  }

  /** Run queued path searches, up to the per-frame budgets (count and time). */
  private runPathQueue(): void {
    let budget = config.pathfinding.budgetPerFrame;
    const deadline = performance.now() + config.pathfinding.budgetMsPerFrame;
    let first = true;
    while (budget > 0 && this.queue.length > 0 && (first || performance.now() < deadline)) {
      first = false;
      const enemy = this.queue.shift();
      if (!enemy) break;
      if (!enemy.isAlive) {
        enemy.pathQueued = false;
        continue;
      }
      const found = this.pathfinder.findPath(enemy.currFeet.x, enemy.currFeet.z, enemy.path);
      enemy.pathReady(found);
      if (!found) this.retryAt.set(enemy, this.time + PATH_RETRY);
      else this.retryAt.delete(enemy);
      this.pathsThisWindow++;
      budget--;
    }
    if (this.time - this.windowStart >= 1) {
      this._pathRate = this.pathsThisWindow;
      this.pathsThisWindow = 0;
      this.windowStart = this.time;
    }
  }

  private retryFailedPath(enemy: Enemy): void {
    const at = this.retryAt.get(enemy);
    if (at === undefined || this.time < at) return;
    this.retryAt.delete(enemy);
    this.requestPath(enemy);
  }

  /**
   * The walls changed. An opening (a wall down, a structure gone) can shorten anyone's route, so everyone
   * re-plans; a new blocker only affects routes through its cells. Waits `repathDebounce` seconds of quiet.
   */
  private scheduleRepath(cells: readonly Cell[] | null): void {
    if (cells === null) this.repathAll = true;
    else for (const { i, j } of cells) if (this.grid.contains(i, j)) this.repathCells.add(j * this.grid.columns + i);
    this.repathTimer = config.pathfinding.repathDebounce;
  }

  private updateRepath(dt: number): void {
    if (this.repathTimer < 0) return;
    this.repathTimer -= dt;
    if (this.repathTimer > 0) return;
    this.repathTimer = -1;
    for (const enemy of this.all) {
      if (!enemy.isAlive) continue;
      let affected = this.repathAll;
      if (!affected) for (const cell of this.repathCells) if (enemy.pathUsesCell(cell)) affected = true;
      if (affected) this.requestPath(enemy);
    }
    this.repathAll = false;
    this.repathCells.clear();
  }

  private release(enemy: Enemy): void {
    enemy.release();
    this.renderer.hideAll(enemy.slot);
    this.retryAt.delete(enemy);
    const index = this.spawnOrder.indexOf(enemy);
    if (index >= 0) this.spawnOrder.splice(index, 1);
  }

  private clearOldestCorpse(): boolean {
    const corpse = this.spawnOrder.find((e) => e.state === 'dead');
    if (!corpse) return false;
    this.release(corpse);
    return true;
  }
}
