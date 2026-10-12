import type { EventBus, GameEvents } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import { SummaryPanel } from './SummaryPanel';

const number = (n: number): string => Math.round(n).toLocaleString('en-US');

/** The win and lose screens: "OUTPOST HELD", or "OUTPOST LOST" / "YOU DIED", with the game's totals. */
export class EndScreen {
  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    const panel = new SummaryPanel(parent, 'hud-end', 1010);
    events.on('matchSummary', (s) => {
      const won = s.result === 'won';
      const title = won ? 'Outpost Held' : s.reason === 'playerDied' ? 'You Died' : 'Outpost Lost';
      const rows: [string, string][] = [
        ['Kills', number(s.kills)],
        ['Headshots', number(s.headshots)],
        ['Cash Earned', formatCash(s.cashEarned)],
        ['Waves Survived', number(s.wavesSurvived)],
      ];
      if (!won) rows.push(['Wave Reached', number(s.wave)]);
      panel.show(title, rows, 'Press Enter to restart');
    });
  }
}
