import { config } from './config';
import type { EventBus, GameEvents, GameOverReason } from './EventBus';
import { Phase } from './GameState';
import type { EnemyType } from '../enemies/EnemyType';

/** Who or what hurt the player. */
type PlayerDamageSource = 'rifleman' | 'satchel' | 'ownGrenade' | 'other';
/** What got a kill: a gun in the player's hands, the knife, the MG or a grenade, a satchel, or anything else. */
type KillWeapon = 'gun' | 'knife' | 'mg' | 'grenade' | 'satchel' | 'other';

interface Split {
  armor: number;
  health: number;
}

interface WaveRecord {
  wave: number;
  /** Seconds spent in each phase of this wave. */
  seconds: { build: number; fight: number; aftermath: number };
  enemies: {
    spawned: Record<EnemyType, number>;
    /** Every death, whoever caused it. */
    killed: Record<EnemyType, number>;
    /** Deaths the player caused (the ones that pay). */
    killedByPlayer: Record<EnemyType, number>;
    headshots: number;
    killsByWeapon: Record<KillWeapon, number>;
    /** Gun kills split by gun id (m4, pistol...). */
    killsByGun: Record<string, number>;
  };
  damageTaken: Split & { bySource: Record<PlayerDamageSource, Split> };
  plates: { applied: number; bought: number };
  cashEarned: { total: number; kills: number; headshots: number; waveBonus: number; refunds: number; debug: number };
  cashSpent: { total: number; walls: number; mgNest: number; repairs: number; plates: number; weapons: number; ammo: number; weaponCrate: number };
  walls: { built: number; lost: number; repaired: number; removed: number };
  mgNest: { built: number; lost: number; repaired: number };
  core: { hpStart: number; hpEnd: number; maxHp: number };
  satchels: { planted: number; dropped: number; wallsDestroyed: number };
}

type RunResult = 'inProgress' | 'won' | 'lostCore' | 'died' | 'forced';

interface RunRecord {
  game: 'Last Stand Fortress';
  startedAt: string;
  result: RunResult;
  /** Highest wave reached (the one being played when the run ended). */
  wavesReached: number;
  wavesCleared: number;
  totalSeconds: number;
  waves: WaveRecord[];
  /** Config at the time of the run, so balance changes between runs can be told apart. */
  config: typeof config;
}

const RESULTS: Record<GameOverReason, RunResult> = {
  held: 'won',
  coreDestroyed: 'lostCore',
  playerDied: 'died',
  forced: 'forced',
};

const zeroSplit = (): Split => ({ armor: 0, health: 0 });
const byType = (): Record<EnemyType, number> => ({ rifleman: 0, sapper: 0 });

function newWave(wave: number, coreHp: number, coreMaxHp: number): WaveRecord {
  return {
    wave,
    seconds: { build: 0, fight: 0, aftermath: 0 },
    enemies: {
      spawned: byType(),
      killed: byType(),
      killedByPlayer: byType(),
      headshots: 0,
      killsByWeapon: { gun: 0, knife: 0, mg: 0, grenade: 0, satchel: 0, other: 0 },
      killsByGun: {},
    },
    damageTaken: {
      ...zeroSplit(),
      bySource: { rifleman: zeroSplit(), satchel: zeroSplit(), ownGrenade: zeroSplit(), other: zeroSplit() },
    },
    plates: { applied: 0, bought: 0 },
    cashEarned: { total: 0, kills: 0, headshots: 0, waveBonus: 0, refunds: 0, debug: 0 },
    cashSpent: { total: 0, walls: 0, mgNest: 0, repairs: 0, plates: 0, weapons: 0, ammo: 0, weaponCrate: 0 },
    walls: { built: 0, lost: 0, repaired: 0, removed: 0 },
    mgNest: { built: 0, lost: 0, repaired: 0 },
    core: { hpStart: coreHp, hpEnd: coreHp, maxHp: coreMaxHp },
    satchels: { planted: 0, dropped: 0, wallsDestroyed: 0 },
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const money = (v: number): string => `$${Math.round(v).toLocaleString('en-US')}`;

function duration(seconds: number): string {
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/**
 * Records a playtest run from game events only: per wave, what spawned and died and how, the damage the player
 * took and from what, plates, cash in and out by reason, walls built, lost and repaired, the core's HP and the
 * sappers' satchels; per run, how far it got, how it ended and how long it took. Prints a short summary of each
 * wave to the console when the wave is over, and saves the whole run as JSON on request (F8) and at game over.
 */
export class PlaytestLog {
  private readonly run: RunRecord;
  private current: WaveRecord;
  private phase: Phase | null = null;
  private phaseStartedAt = 0;
  private readonly startedAt = performance.now();
  private coreHp: number = config.structures.core.hp;
  private coreMaxHp: number = config.structures.core.hp;
  private mounted = false;
  /** The weapon in the player's hands (a def id), for crediting gun kills. */
  private held = '';
  /** The armor/health split of the player's last hit, waiting for its `damageDealt` to say who dealt it. */
  private pendingHit: Split | null = null;
  /** The type of structure that just collapsed, waiting for its `damageDealt` to say what brought it down. */
  private pendingCollapse: string | null = null;

  constructor(events: EventBus<GameEvents>) {
    this.current = newWave(1, this.coreHp, this.coreMaxHp);
    this.run = {
      game: 'Last Stand Fortress',
      startedAt: new Date().toISOString(),
      result: 'inProgress',
      wavesReached: 1,
      wavesCleared: 0,
      totalSeconds: 0,
      waves: [this.current],
      config,
    };

    events.on('phaseChanged', ({ from, to, wave }) => {
      this.closePhase();
      // A new build phase starts the next wave's record; the last one is finished and printed.
      if (to === Phase.BUILD && from !== null) {
        this.print(this.current);
        this.current = newWave(wave, this.coreHp, this.coreMaxHp);
        this.run.waves.push(this.current);
      }
      if (to === Phase.FIGHT) this.current.core.hpStart = this.coreHp;
      this.run.wavesReached = wave;
      this.phase = to;
    });
    events.on('waveCleared', () => this.run.wavesCleared++);
    events.on('gameOver', ({ reason, wave }) => {
      this.closePhase();
      this.run.result = RESULTS[reason];
      this.run.wavesReached = wave;
      this.print(this.current);
      console.info(
        `[playtest] Run over: ${this.run.result}, wave ${wave}, ${this.run.wavesCleared} cleared, ${duration(this.run.totalSeconds)}. F8 saves the log again.`,
      );
      this.download();
    });

    events.on('enemySpawned', ({ type }) => this.current.enemies.spawned[type]++);
    events.on('enemyKilled', ({ type, source, headshot }) => {
      const e = this.current.enemies;
      e.killed[type]++;
      if (source !== 'player') return;
      e.killedByPlayer[type]++;
      if (headshot) e.headshots++;
    });

    events.on('weaponEquipped', ({ weapon }) => (this.held = weapon));
    events.on('mgMounted', () => (this.mounted = true));
    events.on('mgDismounted', () => (this.mounted = false));
    events.on('playerDamaged', ({ armorDamage, healthDamage }) => {
      this.pendingHit = { armor: armorDamage, health: healthDamage };
    });
    events.on('segmentDestroyed', ({ type }) => (this.pendingCollapse = type));
    events.on('damageDealt', ({ target, type, source, killed }) => {
      if (target.kind === 'player' && this.pendingHit) {
        const from: PlayerDamageSource =
          source === 'enemy' ? (type === 'explosive' ? 'satchel' : 'rifleman') : source === 'player' ? 'ownGrenade' : 'other';
        const d = this.current.damageTaken;
        d.armor += this.pendingHit.armor;
        d.health += this.pendingHit.health;
        d.bySource[from].armor += this.pendingHit.armor;
        d.bySource[from].health += this.pendingHit.health;
        this.pendingHit = null;
      } else if (target.kind === 'enemy' && killed) {
        const weapon: KillWeapon =
          source === 'player'
            ? type === 'explosive'
              ? 'grenade'
              : type === 'melee'
                ? 'knife'
                : this.mounted
                  ? 'mg'
                  : 'gun'
            : source === 'enemy' && type === 'explosive'
              ? 'satchel'
              : 'other';
        const e = this.current.enemies;
        e.killsByWeapon[weapon]++;
        if (weapon === 'gun') e.killsByGun[this.held] = (e.killsByGun[this.held] ?? 0) + 1;
      } else if (target.kind === 'structure' && killed) {
        if (this.pendingCollapse === 'wall' && source === 'enemy' && type === 'explosive') this.current.satchels.wallsDestroyed++;
        this.pendingCollapse = null;
      }
    });

    events.on('plateApplied', () => this.current.plates.applied++);
    events.on('platePurchased', () => this.current.plates.bought++);
    events.on('cashEarned', ({ amount, reason }) => {
      const c = this.current.cashEarned;
      if (reason === 'kill') {
        c.kills += amount;
        c.total += amount;
      } else if (reason === 'waveBonus') {
        c.waveBonus += amount;
        c.total += amount;
      } else if (reason === 'refund') c.refunds += amount;
      else c.debug += amount;
    });
    // The kill payment includes the headshot bonus; split it out.
    events.on('enemyKilled', ({ source, headshot }) => {
      if (source !== 'player' || !headshot) return;
      const bonus = config.economy.killRewards.headshotBonus;
      this.current.cashEarned.headshots += bonus;
      this.current.cashEarned.kills -= bonus;
    });
    events.on('cashSpent', ({ amount, reason }) => {
      const c = this.current.cashSpent;
      c.total += amount;
      if (reason === 'wall') c.walls += amount;
      else if (reason === 'mgNest') c.mgNest += amount;
      else if (reason === 'repair') c.repairs += amount;
      else if (reason === 'weapon') c.weapons += amount;
      else if (reason === 'ammo') c.ammo += amount;
      else if (reason === 'weaponCrate') c.weaponCrate += amount;
      else c.plates += amount;
    });

    events.on('structurePlaced', ({ type }) => {
      if (type === 'wall') this.current.walls.built++;
      else if (type === 'mgNest') this.current.mgNest.built++;
    });
    events.on('structureRemoved', ({ type }) => {
      if (type === 'wall') this.current.walls.removed++;
    });
    events.on('segmentDestroyed', ({ type }) => (type === 'wall' ? this.current.walls.lost++ : this.current.mgNest.lost++));
    events.on('structureRepaired', ({ type }) => (type === 'wall' ? this.current.walls.repaired++ : this.current.mgNest.repaired++));
    events.on('coreDamaged', ({ hp, maxHp }) => {
      this.coreHp = round1(hp);
      this.coreMaxHp = maxHp;
      this.current.core.hpEnd = this.coreHp;
      this.current.core.maxHp = maxHp;
    });
    events.on('satchelArmed', ({ dropped }) => (dropped ? this.current.satchels.dropped++ : this.current.satchels.planted++));
  }

  /** Save the whole run so far as a JSON file. */
  download(): void {
    this.updateTimes();
    const blob = new Blob([JSON.stringify(this.run, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = this.run.startedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    link.href = url;
    link.download = `last-stand-run-${stamp}.json`;
    link.click();
    // Give the browser a moment to start the download before the URL goes.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** The run so far, for tests. */
  get record(): Readonly<RunRecord> {
    this.updateTimes();
    return this.run;
  }

  private updateTimes(): void {
    this.run.totalSeconds = round1((performance.now() - this.startedAt) / 1000);
  }

  /** Add the time spent in the phase that just ended to the current wave. */
  private closePhase(): void {
    const now = performance.now();
    const seconds = (now - this.phaseStartedAt) / 1000;
    this.phaseStartedAt = now;
    const s = this.current.seconds;
    if (this.phase === Phase.BUILD) s.build = round1(s.build + seconds);
    else if (this.phase === Phase.FIGHT) s.fight = round1(s.fight + seconds);
    else if (this.phase === Phase.AFTERMATH) s.aftermath = round1(s.aftermath + seconds);
    this.updateTimes();
  }

  private print(w: WaveRecord): void {
    const e = w.enemies;
    const spawned = e.spawned.rifleman + e.spawned.sapper;
    const killed = e.killedByPlayer.rifleman + e.killedByPlayer.sapper;
    const gunKills = Object.entries(e.killsByGun)
      .map(([gun, n]) => `${gun} ${n}`)
      .join(', ');
    const d = w.damageTaken;
    const src = (Object.keys(d.bySource) as PlayerDamageSource[])
      .filter((k) => d.bySource[k].armor + d.bySource[k].health > 0)
      .map((k) => `${k} ${Math.round(d.bySource[k].armor + d.bySource[k].health)}`)
      .join(', ');
    const lines = [
      `[playtest] Wave ${w.wave}: build ${duration(w.seconds.build)}, fight ${duration(w.seconds.fight)}, aftermath ${duration(w.seconds.aftermath)}`,
      `  enemies: ${spawned} spawned (${e.spawned.rifleman} riflemen, ${e.spawned.sapper} sappers), ${killed} killed by you ` +
        `(${e.headshots} headshots; guns ${e.killsByWeapon.gun}${gunKills ? ` [${gunKills}]` : ''}, knife ${e.killsByWeapon.knife}, ` +
        `MG ${e.killsByWeapon.mg}, grenade ${e.killsByWeapon.grenade}), ` +
        `${e.killsByWeapon.satchel} killed by satchels`,
      `  damage taken: ${Math.round(d.armor)} armor, ${Math.round(d.health)} health${src ? ` (${src})` : ''}`,
      `  plates: ${w.plates.applied} applied, ${w.plates.bought} bought`,
      `  cash: +${money(w.cashEarned.total)} (kills ${money(w.cashEarned.kills)}, headshots ${money(w.cashEarned.headshots)}, ` +
        `wave bonus ${money(w.cashEarned.waveBonus)}), -${money(w.cashSpent.total)} (walls ${money(w.cashSpent.walls)}, ` +
        `MG ${money(w.cashSpent.mgNest)}, repairs ${money(w.cashSpent.repairs)}, plates ${money(w.cashSpent.plates)}, ` +
        `weapons ${money(w.cashSpent.weapons)}, ammo ${money(w.cashSpent.ammo)}, weapon crate ${money(w.cashSpent.weaponCrate)})`,
      `  walls: ${w.walls.built} built, ${w.walls.lost} lost, ${w.walls.repaired} repaired; core ${Math.round(w.core.hpStart)} -> ${Math.round(w.core.hpEnd)} / ${w.core.maxHp}`,
      `  satchels: ${w.satchels.planted} planted, ${w.satchels.dropped} dropped, ${w.satchels.wallsDestroyed} walls destroyed`,
    ];
    console.info(lines.join('\n'));
  }
}
