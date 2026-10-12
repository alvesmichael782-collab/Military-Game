import { MathUtils } from 'three';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import { Phase } from '../core/GameState';
import type { EnemyType } from './EnemyType';

/** What the director needs from the enemy manager. */
export interface WaveEnemies {
  readonly aliveCount: number;
  spawnAtPoint(type: EnemyType, index: number): unknown;
  killAll(): void;
  clearCorpses(): void;
}

/** A random whole number from `min` to `max`, both included. */
function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Runs the waves. Each wave has a points budget (wave x `budgetPerWave`) spent on a random mix of the
 * unlocked enemy types, sappers taking at most `maxSapperShare` of it. During FIGHT the wave goes out in
 * squads every few seconds from the spawn points picked for it, held back while `maxAlive` enemies are up.
 * Once the whole budget is out and every enemy is dead it emits `waveCleared`, which ends the fight.
 *
 * The spawn points are picked when the build phase before the wave starts (`wavePlanned`), so the player can
 * see where the next wave will come from. Bodies left at the end of the aftermath are cleared away.
 */
export class WaveDirector {
  private wave = 0;
  private plannedWave = 0;
  private points: number[] = [];
  private fighting = false;
  private cleared = false;
  private _budget = 0;
  /** Enemies of this wave not sent yet, in the order they go out. */
  private readonly queue: EnemyType[] = [];
  /** The current squad's members still waiting for room under the alive cap, and where they come from. */
  private readonly squad: EnemyType[] = [];
  private squadPoint = 0;
  private squadTimer = 0;
  /** Which of the wave's spawn points the next squad uses (they take turns). */
  private nextPoint = 0;
  private announcedRemaining = -1;

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly enemies: WaveEnemies,
    private readonly spawnPointCount: number,
  ) {
    events.on('phaseChanged', ({ from, to, wave }) => {
      if (from === Phase.FIGHT && to !== Phase.FIGHT) this.endFight(to);
      // The aftermath is over: tidy away the bodies before building. Rubble stays.
      if (from === Phase.AFTERMATH) this.enemies.clearCorpses();
      if (to === Phase.BUILD) this.plan(wave);
      if (to === Phase.FIGHT) this.startFight(wave);
    });
  }

  /** The current (or next) wave's budget in points. */
  get budget(): number {
    return this._budget;
  }

  /** Points of this wave's budget not sent out yet. */
  get budgetLeft(): number {
    let left = 0;
    for (const type of this.queue) left += config.waves.costs[type];
    for (const type of this.squad) left += config.waves.costs[type];
    return left;
  }

  /** Enemies of this wave not sent yet (including a squad waiting for room). */
  get queued(): number {
    return this.queue.length + this.squad.length;
  }

  /** Spawn point indexes the current (or next) wave uses. */
  get activeSpawnPoints(): readonly number[] {
    return this.points;
  }

  /** Debug: end the fight now, as if the last enemy just died (everyone left is killed, nobody else comes). */
  endWave(): void {
    if (!this.fighting) return;
    this.queue.length = 0;
    this.squad.length = 0;
    this.enemies.killAll();
  }

  /** Send squads and watch for the wave being cleared. Call once per rendered frame, before the enemies update. */
  update(dt: number): void {
    if (!this.fighting || this.cleared) return;
    const w = config.waves;

    // The next squad's countdown only runs once the last one is all in.
    if (this.squad.length === 0 && this.queue.length > 0) {
      this.squadTimer -= dt;
      if (this.squadTimer <= 0) {
        this.squadTimer = MathUtils.randFloat(w.squadIntervalMin, w.squadIntervalMax);
        this.sendSquad();
      }
    }

    // Squad members come in as soon as there is room under the cap.
    while (this.squad.length > 0 && this.enemies.aliveCount < w.maxAlive) {
      const type = this.squad.shift() as EnemyType;
      this.enemies.spawnAtPoint(type, this.squadPoint);
    }

    this.announceRemaining();
    if (this.queue.length === 0 && this.squad.length === 0 && this.enemies.aliveCount === 0) {
      this.cleared = true;
      this.events.emit('waveCleared', { wave: this.wave });
    }
  }

  /** Pick the spawn points for `wave` and say where it will come from. */
  private plan(wave: number): void {
    if (this.plannedWave === wave) return;
    this.plannedWave = wave;
    const table = config.waves.spawnPointsPerWave;
    const count = Math.min(this.spawnPointCount, table[Math.min(wave, table.length) - 1] ?? 1);
    const all = shuffle(Array.from({ length: this.spawnPointCount }, (_, i) => i));
    this.points = all.slice(0, Math.max(1, count)).sort((a, b) => a - b);
    this._budget = wave * config.waves.budgetPerWave;
    this.events.emit('wavePlanned', { wave, spawnPoints: [...this.points] });
  }

  private startFight(wave: number): void {
    this.plan(wave);
    this.wave = wave;
    this.fighting = true;
    this.cleared = false;
    this.squad.length = 0;
    this.queue.length = 0;
    this.queue.push(...this.composeWave(wave, this._budget));
    this.squadTimer = 0;
    this.nextPoint = Math.floor(Math.random() * this.points.length);
    this.announcedRemaining = -1;
    this.events.emit('waveStarted', { wave, budget: this._budget });
    this.announceRemaining();
  }

  /** The fight is over: cleared, timed out, or lost. Nobody else comes. */
  private endFight(to: Phase): void {
    this.fighting = false;
    this.queue.length = 0;
    this.squad.length = 0;
    // Timed out with enemies still up (one stuck somewhere): remove them so they cannot carry on into the build phase.
    if (to === Phase.AFTERMATH && !this.cleared) this.enemies.killAll();
  }

  /** Spend the budget: a random share of sappers (if unlocked) up to the cap, riflemen for the rest, shuffled. */
  private composeWave(wave: number, budget: number): EnemyType[] {
    const w = config.waves;
    let sappers = 0;
    if (wave >= w.unlockWave.sapper) {
      const most = Math.floor((budget * w.maxSapperShare) / w.costs.sapper);
      if (most > 0) sappers = randomInt(Math.ceil(most / 2), most);
    }
    const riflemen = wave >= w.unlockWave.rifleman ? Math.floor((budget - sappers * w.costs.sapper) / w.costs.rifleman) : 0;
    const list: EnemyType[] = [];
    for (let i = 0; i < sappers; i++) list.push('sapper');
    for (let i = 0; i < riflemen; i++) list.push('rifleman');
    return shuffle(list);
  }

  /** Take the next squad off the queue; it comes in from the next of the wave's spawn points. */
  private sendSquad(): void {
    const w = config.waves;
    const t = w.total > 1 ? (this.wave - 1) / (w.total - 1) : 1;
    const low = Math.round(MathUtils.lerp(w.squadSizeMin, w.squadSizeMax - 1, t));
    const high = Math.round(MathUtils.lerp(w.squadSizeMin + 1, w.squadSizeMax, t));
    const size = Math.min(this.queue.length, randomInt(low, high));
    this.squad.push(...this.queue.splice(0, size));
    this.squadPoint = this.points[this.nextPoint % this.points.length];
    this.nextPoint++;
    let riflemen = 0;
    let sappers = 0;
    for (const type of this.squad) {
      if (type === 'sapper') sappers++;
      else riflemen++;
    }
    this.events.emit('squadSpawned', { wave: this.wave, spawnPoint: this.squadPoint, riflemen, sappers });
  }

  private announceRemaining(): void {
    const count = this.enemies.aliveCount + this.queue.length + this.squad.length;
    if (count === this.announcedRemaining) return;
    this.announcedRemaining = count;
    this.events.emit('enemiesRemaining', { count });
  }
}
