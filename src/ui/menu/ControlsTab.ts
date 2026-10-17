import { canonicalKey, type Action, type BindSlot, type Keybinds } from '../../core/Keybinds';
import { keyName } from '../keyNames';
import type { MenuTab } from './MenuTab';

interface Category {
  readonly title: string;
  readonly actions: readonly (readonly [Action, string])[];
}

/** Left column, then right column. */
const COLUMNS: readonly (readonly Category[])[] = [
  [
    {
      title: 'Movement',
      actions: [
        ['moveForward', 'Move Forward'],
        ['moveBack', 'Move Back'],
        ['moveLeft', 'Strafe Left'],
        ['moveRight', 'Strafe Right'],
        ['sprint', 'Sprint'],
        ['crouch', 'Crouch'],
        ['jump', 'Jump'],
      ],
    },
    {
      title: 'General',
      actions: [
        ['interact', 'Use / Buy / Repair'],
        ['applyPlate', 'Apply Armor Plate'],
        ['startWave', 'Start Wave / Skip'],
        ['cyclePrev', 'Previous Item'],
        ['cycleNext', 'Next Item'],
      ],
    },
  ],
  [
    {
      title: 'Combat',
      actions: [
        ['fire', 'Fire'],
        ['aim', 'Aim Down Sights'],
        ['reload', 'Reload'],
        ['grenade', 'Throw Grenade'],
        ['slot1', 'Gun Slot 1'],
        ['slot2', 'Gun Slot 2'],
        ['slot3', 'Knife'],
      ],
    },
    {
      title: 'Building',
      actions: [
        ['buildMode', 'Build Mode'],
        ['place', 'Place'],
        ['rotate', 'Rotate'],
        ['remove', 'Remove / Clear Rubble'],
      ],
    },
  ],
];

const LABELS = new Map<Action, string>(COLUMNS.flat().flatMap((category) => category.actions));

const HINT = 'Click a box, then press a key or mouse button.';

interface Waiting {
  readonly action: Action;
  readonly slot: BindSlot;
}

/**
 * Key bindings, two per action, grouped by what they do. Click a box and press a key or mouse button to bind it;
 * Esc cancels and Backspace clears. A key taken from another action that is live at the same time is unbound there.
 */
export class ControlsTab implements MenuTab {
  readonly title = 'Controls';
  readonly element = document.createElement('div');
  private readonly boxes = new Map<Action, [HTMLButtonElement, HTMLButtonElement]>();
  private readonly hint = document.createElement('div');
  private waiting: Waiting | null = null;
  /** The left click that made a binding also fires a click; it must not start another. */
  private swallowClick = false;

  constructor(private readonly keybinds: Keybinds) {
    const columns = document.createElement('div');
    columns.className = 'menu-controls__columns';
    for (const categories of COLUMNS) columns.append(this.buildColumn(categories));

    const bar = document.createElement('div');
    bar.className = 'menu-controls__bar';
    this.hint.className = 'menu__hint';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'menu__button menu__raised';
    reset.textContent = 'Defaults';
    reset.addEventListener('click', () => {
      this.leave();
      this.keybinds.resetDefaults();
      this.refresh();
      this.setHint('Controls set back to the defaults.', true);
    });
    bar.append(this.hint, reset);

    this.element.append(columns, bar);
    this.refresh();
    this.setHint(HINT, false);

    // Capture phase on the window, ahead of the game's input, so a key being bound never reaches the game.
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('click', this.onClick, true);
  }

  leave(): void {
    if (!this.waiting) return;
    this.waiting = null;
    this.refresh();
    this.setHint(HINT, false);
  }

  private buildColumn(categories: readonly Category[]): HTMLElement {
    const column = document.createElement('div');
    column.className = 'menu-controls__column';
    const names = document.createElement('div');
    names.className = 'menu-controls__colnames';
    for (const text of ['Action', 'Key', 'Alternate']) {
      const span = document.createElement('span');
      span.textContent = text;
      names.append(span);
    }
    column.append(names);

    for (const category of categories) {
      const grid = document.createElement('div');
      grid.className = 'menu-controls__grid';
      const heading = document.createElement('h3');
      heading.className = 'menu__heading';
      heading.textContent = category.title;
      grid.append(heading);
      for (const [action, label] of category.actions) {
        const name = document.createElement('span');
        name.className = 'menu-controls__label';
        name.textContent = label;
        const pair: [HTMLButtonElement, HTMLButtonElement] = [this.keyBox(action, 0), this.keyBox(action, 1)];
        this.boxes.set(action, pair);
        grid.append(name, ...pair);
      }
      column.append(grid);
    }
    return column;
  }

  private keyBox(action: Action, slot: BindSlot): HTMLButtonElement {
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'menu__key menu__sunken';
    box.addEventListener('click', () => {
      this.waiting = { action, slot };
      this.refresh();
      const label = LABELS.get(action) ?? action;
      this.setHint(`Press a key or mouse button for ${label}. Esc cancels, Backspace clears.`, true);
    });
    return box;
  }

  private refresh(): void {
    for (const [action, pair] of this.boxes) {
      const keys = this.keybinds.keys(action);
      const label = LABELS.get(action) ?? action;
      pair.forEach((box, slot) => {
        const waiting = this.waiting?.action === action && this.waiting.slot === slot;
        box.classList.toggle('is-waiting', waiting);
        box.textContent = waiting ? 'Press a key' : keyName(keys[slot]);
        box.title = box.textContent;
        box.setAttribute('aria-label', `${label}, ${slot === 0 ? 'key' : 'alternate'}: ${keyName(keys[slot]) || 'none'}`);
      });
    }
  }

  private setHint(text: string, notice: boolean): void {
    this.hint.textContent = text;
    this.hint.classList.toggle('is-notice', notice);
  }

  private finish(key: string | null): void {
    const waiting = this.waiting;
    if (!waiting) return;
    this.waiting = null;
    if (key === null) {
      this.keybinds.clear(waiting.action, waiting.slot);
      this.setHint(HINT, false);
    } else {
      const cleared = this.keybinds.bind(waiting.action, waiting.slot, key);
      const names = cleared.map((action) => LABELS.get(action) ?? action);
      if (names.length > 0) this.setHint(`${keyName(key)} was taken off ${names.join(', ')}.`, true);
      else this.setHint(HINT, false);
    }
    this.refresh();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.waiting) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat || e.metaKey || e.code === 'MetaLeft' || e.code === 'MetaRight' || e.code === '') return;
    if (e.code === 'Escape') this.leave();
    else if (e.code === 'Backspace' || e.code === 'Delete') this.finish(null);
    else this.finish(canonicalKey(e.code));
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.waiting) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Only the left button is followed by a click.
    if (e.button === 0) this.swallowClick = true;
    this.finish(`Mouse${e.button}`);
  };

  private readonly onClick = (e: MouseEvent): void => {
    if (!this.swallowClick) return;
    this.swallowClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
}
