import type { EventBus, GameEvents } from '../../core/EventBus';
import { Phase } from '../../core/GameState';
import { formatCash } from './CashCounter';
import { SummaryPanel } from './SummaryPanel';

const number = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * "WAVE 3 CLEARED" in the middle of the screen through the aftermath: the wave's kills, headshots, cash
 * earned, walls lost and core HP, with a countdown to the build phase and the Enter shortcut.
 */
export class WaveSummary {
  private readonly panel: SummaryPanel;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.panel = new SummaryPanel(parent, 'hud-wave-summary', 3301);
    events.on('waveSummary', (s) => {
      this.panel.show(
        `Wave ${s.wave} Cleared`,
        [
          ['Kills', number(s.kills)],
          ['Headshots', number(s.headshots)],
          ['Cash Earned', formatCash(s.cashEarned)],
          ['Walls Lost', number(s.wallsLost)],
          ['Core HP', `${number(Math.ceil(s.coreHp))} / ${number(s.coreMaxHp)}`],
        ],
        'Press Enter to skip',
      );
    });
    events.on('phaseTimer', ({ phase, seconds }) => {
      if (phase === Phase.AFTERMATH && this.panel.visible) this.panel.setFooter(`Build phase in ${seconds}  -  Press Enter to skip`);
    });
    events.on('phaseChanged', ({ to }) => {
      if (to !== Phase.AFTERMATH) this.panel.hide();
    });
  }
}
