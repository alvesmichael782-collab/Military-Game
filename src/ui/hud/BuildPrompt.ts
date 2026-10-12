import type { EventBus, GameEvents } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import { CenterPrompt } from './CenterPrompt';

/**
 * Build tool text under the crosshair: "WALL  $100" plus why it cannot be placed, or "PRESS F - REMOVE WALL  +$50".
 * Over rubble, a second line offers "PRESS F - CLEAR RUBBLE  FREE".
 */
export class BuildPrompt {
  private readonly prompt: CenterPrompt;
  private readonly rubble: CenterPrompt;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.prompt = new CenterPrompt(parent);
    this.rubble = new CenterPrompt(parent);
    events.on('buildPromptChanged', (e) => {
      const clearRubble = (e.mode === 'place' && e.rubble) || e.mode === 'clearRubble';
      if (clearRubble) this.rubble.show('Press F - Clear Rubble', 'Free', 'refund', null);
      else this.rubble.hide();
      switch (e.mode) {
        case 'hidden':
        case 'clearRubble':
          this.prompt.hide();
          break;
        case 'place':
          this.prompt.show(e.item, formatCash(e.cost), 'cost', e.error);
          break;
        case 'remove':
          this.prompt.show(`Press F - Remove ${e.item}`, `+${formatCash(e.refund)}`, 'refund', null);
          break;
      }
    });
    events.on('actionDenied', () => this.prompt.deny());
    events.on('cashInsufficient', () => this.prompt.deny());
  }
}
