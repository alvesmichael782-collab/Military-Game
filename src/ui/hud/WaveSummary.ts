import type { EventBus, GameEvents } from '../../core/EventBus';
import { Phase } from '../../core/GameState';
import { ENEMY_TYPES, type EnemyType } from '../../enemies/EnemyType';
import { formatCash } from './CashCounter';
import type { PromptKeys } from './PromptKeys';
import { SummaryPanel, type SummaryRow } from './SummaryPanel';

const number = (n: number): string => Math.round(n).toLocaleString('en-US');
const TYPE_NAMES: Record<EnemyType, string> = { rifleman: 'Riflemen', sapper: 'Sappers', grenadier: 'Grenadiers', mortar: 'Mortar Teams' };

/**
 * "WAVE 3 CLEARED" in the middle of the screen through the aftermath: the wave's kills (with the types killed
 * under them), headshots, cash earned, walls lost and core HP, with a countdown to the build phase and the Enter shortcut.
 */
export class WaveSummary {
  private readonly panel: SummaryPanel;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement, keys: PromptKeys) {
    this.panel = new SummaryPanel(parent, 'hud-wave-summary', 3301);
    let seconds: number | null = null;
    /** Multiplayer: everyone must press the key to skip. */
    let ready: { ready: number; total: number; self: boolean } | null = null;
    const footer = (): string => {
      let skip = `Press ${keys.name('startWave')} to skip`;
      if (ready) skip = ready.self ? `Waiting for the squad  ${ready.ready}/${ready.total}` : `${skip}  ${ready.ready}/${ready.total}`;
      return seconds === null ? skip : `Build phase in ${seconds}  -  ${skip}`;
    };
    events.on('readyChanged', (r) => {
      ready = { ...r };
      if (this.panel.visible) this.panel.setFooter(footer());
    });
    events.on('waveSummary', (s) => {
      seconds = null;
      this.panel.show(
        `Wave ${s.wave} Cleared`,
        [
          ['Kills', number(s.kills)],
          ...ENEMY_TYPES.filter((type) => s.killsByType[type] > 0).map((type): SummaryRow => [TYPE_NAMES[type], number(s.killsByType[type]), true]),
          ['Headshots', number(s.headshots)],
          ['Cash Earned', formatCash(s.cashEarned)],
          ['Walls Lost', number(s.wallsLost)],
          ['Core HP', `${number(Math.ceil(s.coreHp))} / ${number(s.coreMaxHp)}`],
        ],
        footer(),
      );
    });
    events.on('phaseTimer', (e) => {
      if (e.phase !== Phase.AFTERMATH || !this.panel.visible) return;
      seconds = e.seconds;
      this.panel.setFooter(footer());
    });
    keys.onChange(() => {
      if (this.panel.visible) this.panel.setFooter(footer());
    });
    events.on('phaseChanged', ({ to }) => {
      if (to !== Phase.AFTERMATH) this.panel.hide();
    });
  }
}
