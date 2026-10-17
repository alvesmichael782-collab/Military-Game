import type { BuildPromptEvent, EventBus, GameEvents } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import { CenterPrompt } from './CenterPrompt';
import type { PromptKeys } from './PromptKeys';

/**
 * Build tool text under the crosshair: "WALL  $100" plus why it cannot be placed, or "PRESS F - REMOVE WALL  +$50".
 * Over rubble, a second line offers "PRESS F - CLEAR RUBBLE  FREE".
 */
export class BuildPrompt {
  private readonly prompt: CenterPrompt;
  private readonly rubble: CenterPrompt;

  private last: BuildPromptEvent = { mode: 'hidden' };

  constructor(events: EventBus<GameEvents>, parent: HTMLElement, keys: PromptKeys) {
    this.prompt = new CenterPrompt(parent);
    this.rubble = new CenterPrompt(parent);
    const render = (): void => {
      const e = this.last;
      const remove = keys.name('remove');
      const clearRubble = (e.mode === 'place' && e.rubble) || e.mode === 'clearRubble';
      if (clearRubble) this.rubble.show(`Press ${remove} - Clear Rubble`, 'Free', 'refund', null);
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
          this.prompt.show(`Press ${remove} - Remove ${e.item}`, `+${formatCash(e.refund)}`, 'refund', null);
          break;
      }
    };
    events.on('buildPromptChanged', (e) => {
      this.last = e;
      render();
    });
    keys.onChange(render);
    events.on('actionDenied', () => this.prompt.deny());
    events.on('cashInsufficient', () => this.prompt.deny());
  }
}
