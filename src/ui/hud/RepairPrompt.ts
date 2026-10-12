import type { EventBus, GameEvents } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import { CenterPrompt } from './CenterPrompt';

/** "HOLD E - REPAIR WALL  $35" while aiming at a damaged structure in reach; "REPAIRING WALL" while E is held. */
export class RepairPrompt {
  private readonly prompt: CenterPrompt;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.prompt = new CenterPrompt(parent);
    events.on('repairPromptChanged', (e) => {
      if (e.mode === 'hidden') {
        this.prompt.hide();
        return;
      }
      const action = e.repairing ? `Repairing ${e.item}` : `Hold E - Repair ${e.item}`;
      this.prompt.show(action, formatCash(e.cost), 'cost', e.error);
    });
    events.on('repairStopped', ({ reason }) => {
      if (reason === 'noCash') this.prompt.deny();
    });
  }
}
