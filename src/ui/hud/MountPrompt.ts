import type { EventBus, GameEvents } from '../../core/EventBus';
import { CenterPrompt } from './CenterPrompt';

/** "PRESS E - MOUNT MG" while the player stands behind the nest's gun, looking at it. */
export class MountPrompt {
  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    const prompt = new CenterPrompt(parent);
    events.on('mountPromptChanged', ({ shown }) => {
      if (shown) prompt.show('Press E - Mount MG', '', 'cost', null);
      else prompt.hide();
    });
  }
}
