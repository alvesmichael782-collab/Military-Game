import { config } from './config';
import type { EventBus, GameEvents } from './EventBus';
import { readSetting, writeSetting } from './storage';

/** A rebindable control, from `config.keybinds`. */
export type Action = keyof typeof config.keybinds;
/** Primary and alternate key of one action; '' when unbound. */
export type Binding = readonly [string, string];
/** 0 primary, 1 alternate. */
export type BindSlot = 0 | 1;
export type BindingMap = Readonly<Record<Action, Binding>>;

export const ACTIONS = Object.keys(config.keybinds) as Action[];

const STORAGE_NAME = 'keybinds';

/**
 * When an action is live. 'weapon' actions only work with a weapon out and 'build' actions only with the build tool
 * out, so the two may share keys (fire and place both default to the left mouse button, reload and rotate to R).
 */
type Context = 'always' | 'weapon' | 'build';

const CONTEXT: Record<Action, Context> = {
  moveForward: 'always',
  moveBack: 'always',
  moveLeft: 'always',
  moveRight: 'always',
  sprint: 'always',
  crouch: 'always',
  jump: 'always',
  fire: 'weapon',
  aim: 'weapon',
  reload: 'weapon',
  grenade: 'weapon',
  applyPlate: 'always',
  slot1: 'weapon',
  slot2: 'weapon',
  slot3: 'weapon',
  interact: 'always',
  startWave: 'always',
  buildMode: 'always',
  place: 'build',
  rotate: 'build',
  remove: 'build',
  // Shared by the build tool and the weapon crate.
  cyclePrev: 'always',
  cycleNext: 'always',
};

function sharesContext(a: Action, b: Action): boolean {
  return CONTEXT[a] === 'always' || CONTEXT[b] === 'always' || CONTEXT[a] === CONTEXT[b];
}

/** Left and right modifiers count as one key, so "Shift" works with either Shift key. */
export function canonicalKey(code: string): string {
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Control';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  return code;
}

function defaults(): Record<Action, Binding> {
  const map = {} as Record<Action, Binding>;
  for (const action of ACTIONS) map[action] = [...config.keybinds[action]] as unknown as Binding;
  return map;
}

function isBinding(value: unknown): value is Binding {
  return Array.isArray(value) && value.length === 2 && value.every((key) => typeof key === 'string');
}

/**
 * The player's controls: defaults from `config.keybinds`, overridden by what the player set in the pause menu
 * (saved in the browser). Emits `keybindsChanged` with the full map after every change.
 */
export class Keybinds {
  private binds = defaults();

  constructor(private readonly events: EventBus<GameEvents>) {
    const saved = readSetting(STORAGE_NAME);
    if (saved && typeof saved === 'object') {
      for (const action of ACTIONS) {
        const binding = (saved as Record<string, unknown>)[action];
        // Actions added after the save keep their defaults.
        if (isBinding(binding)) this.binds[action] = [binding[0], binding[1]];
      }
    }
  }

  keys(action: Action): Binding {
    return this.binds[action];
  }

  /**
   * Put `key` on `action`. The key comes off every other action it would clash with (one live at the same time),
   * and off the action's other slot. Returns the actions it came off, for a notice.
   */
  bind(action: Action, slot: BindSlot, key: string): Action[] {
    const cleared: Action[] = [];
    for (const other of ACTIONS) {
      const binding = this.binds[other];
      for (const s of [0, 1] as const) {
        if (binding[s] !== key || (other === action && s === slot) || !sharesContext(action, other)) continue;
        this.setSlot(other, s, '');
        if (other !== action) cleared.push(other);
      }
    }
    this.setSlot(action, slot, key);
    this.changed();
    return cleared;
  }

  clear(action: Action, slot: BindSlot): void {
    this.setSlot(action, slot, '');
    this.changed();
  }

  resetDefaults(): void {
    this.binds = defaults();
    this.changed();
  }

  /** Emit the current controls, for the HUD prompts. Call once after the HUD is built. */
  announce(): void {
    this.events.emit('keybindsChanged', { binds: { ...this.binds } });
  }

  private setSlot(action: Action, slot: BindSlot, key: string): void {
    const binding = this.binds[action];
    this.binds[action] = slot === 0 ? [key, binding[1]] : [binding[0], key];
  }

  private changed(): void {
    writeSetting(STORAGE_NAME, this.binds);
    this.announce();
  }
}
