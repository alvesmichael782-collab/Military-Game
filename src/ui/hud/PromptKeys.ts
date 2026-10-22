import type { EventBus, GameEvents } from '../../core/EventBus';
import { canonicalKey, type Action, type BindingMap } from '../../core/Keybinds';
import { bindingName } from '../keyNames';

/** Key names for the HUD prompts ("PRESS E - BUY ARMOR PLATE"), kept current from `keybindsChanged`. */
export class PromptKeys {
  private binds: BindingMap | null = null;
  private readonly listeners: (() => void)[] = [];

  constructor(events: EventBus<GameEvents>) {
    events.on('keybindsChanged', ({ binds }) => {
      this.binds = binds;
      for (const listener of this.listeners) listener();
    });
  }

  /** "E" for the interact key; "" until the controls are announced. */
  name(action: Action): string {
    return this.binds ? bindingName(this.binds[action]) : '';
  }

  /** True if `code` (a `KeyboardEvent.code`) is bound to `action`, for UI that reads the keyboard itself. */
  matches(action: Action, code: string): boolean {
    const key = canonicalKey(code);
    return this.binds !== null && this.binds[action].includes(key);
  }

  /** Call `listener` whenever the controls change, so a prompt on screen can redraw with the new key. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }
}
