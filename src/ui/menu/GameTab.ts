import { config } from '../../core/config';
import { UiSettings } from '../../core/UiSettings';
import type { MenuTab } from './MenuTab';

/** Game settings. For now one section, UI, with the UI size (1x to 5x; 3x is the standard size). */
export class GameTab implements MenuTab {
  readonly title = 'Game';
  readonly element = document.createElement('div');
  private readonly choices: HTMLButtonElement[] = [];

  constructor(private readonly settings: UiSettings) {
    this.element.className = 'menu-game';

    const heading = document.createElement('h3');
    heading.className = 'menu__heading';
    heading.textContent = 'UI';

    const row = document.createElement('div');
    row.className = 'menu-game__row';
    const label = document.createElement('span');
    label.id = 'menu-ui-size';
    label.textContent = 'UI Size';
    const group = document.createElement('div');
    group.className = 'menu-game__choices';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', label.id);
    for (let level = 1; level <= UiSettings.scaleLevels; level++) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'menu__choice menu__raised';
      choice.textContent = `${level}x`;
      choice.addEventListener('click', () => {
        this.settings.setScaleLevel(level);
        this.refresh();
      });
      this.choices.push(choice);
      group.append(choice);
    }
    const note = document.createElement('div');
    note.className = 'menu__hint menu-game__note';
    note.textContent = `${config.ui.defaultScale}x is the standard size. Lower is smaller, higher is larger.`;
    row.append(label, group, note);

    this.element.append(heading, row);
    this.refresh();
  }

  private refresh(): void {
    this.choices.forEach((choice, i) => choice.setAttribute('aria-pressed', String(i + 1 === this.settings.scaleLevel)));
  }
}
