import type { EventBus, GameEvents } from '../../core/EventBus';
import { CenterPrompt } from './CenterPrompt';
import type { PromptKeys } from './PromptKeys';

/** "PRESS E - MOUNT MG" while the player stands behind the nest's gun, looking at it. */
export class MountPrompt {
  constructor(events: EventBus<GameEvents>, parent: HTMLElement, keys: PromptKeys) {
    const prompt = new CenterPrompt(parent);
    let shown = false;
    const render = (): void => {
      if (shown) prompt.show(`Press ${keys.name('interact')} - Mount MG`, '', 'cost', null);
      else prompt.hide();
    };
    events.on('mountPromptChanged', (e) => {
      shown = e.shown;
      render();
    });
    keys.onChange(render);
  }
}
