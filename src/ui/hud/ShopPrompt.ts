import type { EventBus, GameEvents, ShopPromptEvent } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import { CenterPrompt } from './CenterPrompt';
import type { PromptKeys } from './PromptKeys';

/** "PRESS E - BUY UZI  $1,250" (or "PRESS E - REFILL AMMO  $150") while looking at the weapon crate, with the reason a purchase would fail. */
export class ShopPrompt {
  private readonly prompt: CenterPrompt;

  private last: ShopPromptEvent = { mode: 'hidden' };

  constructor(events: EventBus<GameEvents>, parent: HTMLElement, keys: PromptKeys) {
    this.prompt = new CenterPrompt(parent);
    const render = (): void => {
      const e = this.last;
      if (e.mode === 'hidden') {
        this.prompt.hide();
        return;
      }
      const action = e.action === 'refill' ? 'Refill Ammo' : `Buy ${e.item}`;
      this.prompt.show(`Press ${keys.name('interact')} - ${action}`, formatCash(e.cost), 'cost', e.error);
    };
    events.on('shopPromptChanged', (e) => {
      this.last = e;
      render();
    });
    keys.onChange(render);
    events.on('actionDenied', () => this.prompt.deny());
    events.on('cashInsufficient', () => this.prompt.deny());
  }
}
