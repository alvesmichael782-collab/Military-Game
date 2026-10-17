import type { EventBus, GameEvents, RepairPromptEvent } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import { CenterPrompt } from './CenterPrompt';
import type { PromptKeys } from './PromptKeys';

/** "HOLD E - REPAIR WALL  $35" while aiming at a damaged structure in reach; "REPAIRING WALL" while E is held. */
export class RepairPrompt {
  private readonly prompt: CenterPrompt;

  private last: RepairPromptEvent = { mode: 'hidden' };

  constructor(events: EventBus<GameEvents>, parent: HTMLElement, keys: PromptKeys) {
    this.prompt = new CenterPrompt(parent);
    const render = (): void => {
      const e = this.last;
      if (e.mode === 'hidden') {
        this.prompt.hide();
        return;
      }
      const action = e.repairing ? `Repairing ${e.item}` : `Hold ${keys.name('interact')} - Repair ${e.item}`;
      this.prompt.show(action, formatCash(e.cost), 'cost', e.error);
    };
    events.on('repairPromptChanged', (e) => {
      this.last = e;
      render();
    });
    keys.onChange(render);
    events.on('repairStopped', ({ reason }) => {
      if (reason === 'noCash') this.prompt.deny();
    });
  }
}
