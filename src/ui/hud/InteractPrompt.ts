import type { EventBus, GameEvents } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import { CenterPrompt } from './CenterPrompt';

/** "PRESS E - BUY ARMOR PLATE  $250" while looking at the armor crate, with the reason a purchase would fail. */
export class InteractPrompt {
  private readonly prompt: CenterPrompt;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.prompt = new CenterPrompt(parent);
    events.on('interactPromptChanged', (e) => {
      if (e.mode === 'hidden') this.prompt.hide();
      else this.prompt.show('Press E - Buy Armor Plate', formatCash(e.cost), 'cost', e.error);
    });
    events.on('actionDenied', () => this.prompt.deny());
    events.on('cashInsufficient', () => this.prompt.deny());
  }
}
