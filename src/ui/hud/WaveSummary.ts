import type { EventBus, GameEvents } from '../../core/EventBus';
import { Phase } from '../../core/GameState';
import { formatCash } from './CashCounter';
import type { PromptKeys } from './PromptKeys';
import { SummaryPanel } from './SummaryPanel';

const number = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * "WAVE 3 CLEARED" in the middle of the screen through the aftermath: the wave's kills, headshots, cash
 * earned, walls lost and core HP, with a countdown to the build phase and the Enter shortcut.
 */
export class WaveSummary {
  private readonly panel: SummaryPanel;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement, keys: PromptKeys) {
    this.panel = new SummaryPanel(parent, 'hud-wave-summary', 3301);
    let seconds: number | null = null;
    const footer = (): string => {
      const skip = `Press ${keys.name('startWave')} to skip`;
      return seconds === null ? skip : `Build phase in ${seconds}  -  ${skip}`;
    };
    events.on('waveSummary', (s) => {
      seconds = null;
      this.panel.show(
        `Wave ${s.wave} Cleared`,
        [
          ['Kills', number(s.kills)],
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
