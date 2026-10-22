import type { EventBus, GameEvents } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import type { PromptKeys } from './PromptKeys';
import { SummaryPanel } from './SummaryPanel';

const number = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * The win and lose screens: "OUTPOST HELD", or "OUTPOST LOST" / "YOU DIED" ("SQUAD WIPED OUT" in multiplayer),
 * with this player's totals. In multiplayer the key goes back to the main menu instead of restarting.
 */
export class EndScreen {
  constructor(events: EventBus<GameEvents>, parent: HTMLElement, keys: PromptKeys) {
    const panel = new SummaryPanel(parent, 'hud-end', 1010);
    let multiplayer = false;
    events.on('sessionStarted', (s) => {
      multiplayer = s.multiplayer;
    });
    events.on('matchSummary', (s) => {
      const won = s.result === 'won';
      const died = multiplayer ? 'Squad Wiped Out' : 'You Died';
      const title = won ? 'Outpost Held' : s.reason === 'playerDied' ? died : 'Outpost Lost';
      const rows: [string, string][] = [
        ['Kills', number(s.kills)],
        ['Headshots', number(s.headshots)],
        ['Cash Earned', formatCash(s.cashEarned)],
        ['Waves Survived', number(s.wavesSurvived)],
      ];
      if (!won) rows.push(['Wave Reached', number(s.wave)]);
      panel.show(title, rows, `Press ${keys.name('startWave')} ${multiplayer ? 'for the main menu' : 'to restart'}`);
    });
  }
}
