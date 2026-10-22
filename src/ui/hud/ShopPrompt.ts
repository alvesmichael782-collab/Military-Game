import type { EventBus, GameEvents, ShopPromptEvent } from '../../core/EventBus';
import { CenterPrompt } from './CenterPrompt';
import type { PromptKeys } from './PromptKeys';

/** "PRESS E - OPEN WEAPON CRATE" while looking at a shop crate with its menu closed. */
export class ShopPrompt {
  private readonly prompt: CenterPrompt;

  private last: ShopPromptEvent = { mode: 'hidden' };

  constructor(events: EventBus<GameEvents>, parent: HTMLElement, keys: PromptKeys) {
    this.prompt = new CenterPrompt(parent);
    const render = (): void => {
      const e = this.last;
      if (e.mode === 'hidden') this.prompt.hide();
      else this.prompt.show(`Press ${keys.name('interact')} - Open ${e.title}`, '', 'cost', null);
    };
    events.on('shopPromptChanged', (e) => {
      this.last = e;
      render();
    });
    keys.onChange(render);
  }
}
