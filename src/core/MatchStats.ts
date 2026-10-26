import { config } from './config';
import type { EventBus, GameEvents } from './EventBus';
import { Phase } from './GameState';
import { localPlayerId } from '../net/PlayerId';
import type { EnemyType } from '../enemies/EnemyType';

interface Tally {
  kills: number;
  headshots: number;
  cashEarned: number;
  killsByType: Record<EnemyType, number>;
}

const byType = (): Record<EnemyType, number> => ({ rifleman: 0, sapper: 0, grenadier: 0, mortar: 0 });

/**
 * Counts what happens in each wave and over the whole game, from events: the player's kills (by enemy type) and
 * headshot kills, cash earned, walls lost and the core's HP. Sends `waveSummary` as each aftermath starts and
 * `matchSummary` when the game ends, for the wave summary and the win and lose screens.
 */
export class MatchStats {
  private readonly wave: Tally & { wallsLost: number } = { kills: 0, headshots: 0, cashEarned: 0, wallsLost: 0, killsByType: byType() };
  private readonly total: Tally = { kills: 0, headshots: 0, cashEarned: 0, killsByType: byType() };
  private coreHp: number = config.structures.core.hp;
  private coreMaxHp: number = config.structures.core.hp;
  private wavesSurvived = 0;

  constructor(private readonly events: EventBus<GameEvents>) {
    events.on('enemyKilled', ({ type, source, headshot, killer }) => {
      // Only this machine's player's kills: in multiplayer each player sees their own numbers.
      if (source !== 'player' || killer !== localPlayerId()) return;
      this.wave.kills++;
      this.total.kills++;
      this.wave.killsByType[type]++;
      this.total.killsByType[type]++;
      if (headshot) {
        this.wave.headshots++;
        this.total.headshots++;
      }
    });
    events.on('cashEarned', ({ amount, reason }) => {
      // Refunds for removed structures give back cash already spent; they are not earnings.
      if (reason === 'refund') return;
      this.wave.cashEarned += amount;
      this.total.cashEarned += amount;
    });
    events.on('segmentDestroyed', ({ type }) => {
      if (type === 'wall') this.wave.wallsLost++;
    });
    events.on('coreDamaged', ({ hp, maxHp }) => {
      this.coreHp = hp;
      this.coreMaxHp = maxHp;
    });
    events.on('phaseChanged', ({ to, wave }) => {
      if (to === Phase.FIGHT) {
        this.wave.kills = 0;
        this.wave.headshots = 0;
        this.wave.cashEarned = 0;
        this.wave.wallsLost = 0;
        this.wave.killsByType = byType();
      } else if (to === Phase.AFTERMATH) {
        this.wavesSurvived++;
        this.events.emit('waveSummary', { wave, ...this.wave, killsByType: { ...this.wave.killsByType }, coreHp: this.coreHp, coreMaxHp: this.coreMaxHp });
      }
    });
    events.on('gameOver', (e) => {
      this.events.emit('matchSummary', { ...e, ...this.total, killsByType: { ...this.total.killsByType }, wavesSurvived: this.wavesSurvived });
    });
  }
}
