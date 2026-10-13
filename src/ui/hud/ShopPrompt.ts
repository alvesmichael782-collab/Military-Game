import type { EventBus, GameEvents } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import { CenterPrompt } from './CenterPrompt';

/** "PRESS E - BUY UZI  $1,250" (or "PRESS E - REFILL AMMO  $150") while looking at the weapon crate, with the reason a purchase would fail. */
export class ShopPrompt {
  private readonly prompt: CenterPrompt;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.prompt = new CenterPrompt(parent);
    events.on('shopPromptChanged', (e) => {
      if (e.mode === 'hidden') this.prompt.hide();
      else this.prompt.show(e.action === 'refill' ? 'Press E - Refill Ammo' : `Press E - Buy ${e.item}`, formatCash(e.cost), 'cost', e.error);
    });
    events.on('actionDenied', () => this.prompt.deny());
    events.on('cashInsufficient', () => this.prompt.deny());
  }
}
