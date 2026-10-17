import type { Keybinds } from '../../core/Keybinds';
import type { UiSettings } from '../../core/UiSettings';
import { ControlsTab } from './ControlsTab';
import { GameTab } from './GameTab';
import type { MenuTab } from './MenuTab';
import './PauseMenu.css';

/**
 * The pause menu, up whenever the game is paused (Esc releases the mouse, which pauses). Tabs along the top,
 * Resume at the bottom. Resume has to capture the mouse again, which browsers only allow from a click.
 */
export class PauseMenu {
  private readonly root = document.createElement('div');
  private readonly tabs: MenuTab[];
  private readonly tabButtons: HTMLButtonElement[] = [];
  private readonly panel = document.createElement('div');
  private current = 0;

  constructor(keybinds: Keybinds, uiSettings: UiSettings, onResume: () => void, parent: HTMLElement = document.body) {
    this.tabs = [new ControlsTab(keybinds), new GameTab(uiSettings)];

    this.root.className = 'menu';
    this.root.hidden = true;
    // Mac ctrl-click is a right click: no browser menu over the game's.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    const frame = document.createElement('div');
    frame.className = 'menu__window';
    frame.setAttribute('role', 'dialog');
    frame.setAttribute('aria-label', 'Paused');

    const title = document.createElement('h2');
    title.className = 'menu__title';
    title.textContent = 'Paused';

    const tabBar = document.createElement('div');
    tabBar.className = 'menu__tabs';
    tabBar.setAttribute('role', 'tablist');
    this.tabs.forEach((tab, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu__tab menu__raised';
      button.setAttribute('role', 'tab');
      button.textContent = tab.title;
      button.addEventListener('click', () => this.select(i));
      this.tabButtons.push(button);
      tabBar.append(button);
    });

    this.panel.className = 'menu__panel menu__raised';
    this.panel.setAttribute('role', 'tabpanel');
    // Every tab sits in the panel, stacked in one cell, so the window keeps the tallest tab's size.
    for (const tab of this.tabs) {
      tab.element.classList.add('menu__page');
      this.panel.append(tab.element);
    }

    const footer = document.createElement('div');
    footer.className = 'menu__footer';
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'menu__button menu__button--primary menu__raised';
    resume.textContent = 'Resume';
    resume.addEventListener('click', onResume);
    footer.append(resume);

    frame.append(title, tabBar, this.panel, footer);
    this.root.append(frame);
    parent.append(this.root);
    this.select(0);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Show or hide the menu. It opens on the tab it was last left on. */
  setOpen(open: boolean): void {
    if (open === this.isOpen) return;
    this.root.hidden = !open;
    if (!open) this.tabs[this.current]?.leave?.();
  }

  private select(index: number): void {
    this.tabs[this.current]?.leave?.();
    this.current = index;
    this.tabs.forEach((tab, i) => tab.element.classList.toggle('is-current', i === index));
    this.tabButtons.forEach((button, i) => button.setAttribute('aria-selected', String(i === index)));
  }
}
