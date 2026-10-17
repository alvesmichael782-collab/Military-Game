import type { EventBus, GameEvents, InteractPromptEvent } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import { CenterPrompt } from './CenterPrompt';
import type { PromptKeys } from './PromptKeys';

/** "PRESS E - BUY ARMOR PLATE  $250" (E is the interact key) while looking at the armor crate, with the reason a purchase would fail. */
export class InteractPrompt {
  private readonly prompt: CenterPrompt;

  private last: InteractPromptEvent = { mode: 'hidden' };

  constructor(events: EventBus<GameEvents>, parent: HTMLElement, keys: PromptKeys) {
    this.prompt = new CenterPrompt(parent);
    const render = (): void => {
      const e = this.last;
      if (e.mode === 'hidden') this.prompt.hide();
      else this.prompt.show(`Press ${keys.name('interact')} - Buy Armor Plate`, formatCash(e.cost), 'cost', e.error);
    };
    events.on('interactPromptChanged', (e) => {
      this.last = e;
      render();
    });
    keys.onChange(render);
    events.on('actionDenied', () => this.prompt.deny());
    events.on('cashInsufficient', () => this.prompt.deny());
  }
}
