import type { EventBus, GameEvents } from '../../core/EventBus';
import { pop } from './motion';
import './GrenadeCount.css';

/** A frag grenade: round body, fuse cap, spoon down the right side and the pull ring at top left. */
const GRENADE_SVG = `
<svg viewBox="0 0 28 30" aria-hidden="true">
  <circle cx="13" cy="19" r="9.5"/>
  <rect x="9" y="5.5" width="8" height="5" rx="1"/>
  <path d="M16.5 6.5 Q23.5 6 23.5 15" fill="none" stroke-width="2.4" stroke-linecap="round"/>
  <circle cx="7.5" cy="6.5" r="3.2" fill="none" stroke-width="1.8"/>
  <circle class="hud-grenades__hole" cx="9" cy="23" r="2.2"/>
</svg>`;

/**
 * Grenade count above the ammo, like UI-Model.jpg: the front grenade drawn solid with the rest
 * stacked behind it as faint outlines. With none left, a single dim outline remains.
 */
export class GrenadeCount {
  private readonly root = document.createElement('div');
  private readonly icons: HTMLDivElement[] = [];
  private count = -1;

  constructor(events: EventBus<GameEvents>, anchor: HTMLElement) {
    this.root.className = 'hud-grenades';
    anchor.append(this.root);
    events.on('grenadesChanged', ({ count, max }) => this.set(count, max));
  }

  private set(count: number, max: number): void {
    const changed = this.count >= 0 && count !== this.count;
    this.count = count;
    while (this.icons.length < Math.max(1, max, count)) {
      const icon = document.createElement('div');
      icon.className = 'hud-grenades__icon';
      icon.innerHTML = GRENADE_SVG;
      // Each one tucks behind the one to its left.
      icon.style.zIndex = String(100 - this.icons.length);
      icon.style.setProperty('--slot', String(this.icons.length));
      this.root.append(icon);
      this.icons.push(icon);
    }
    this.icons.forEach((icon, i) => {
      icon.classList.toggle('is-solid', i === 0 && count > 0);
      icon.classList.toggle('is-empty', i === 0 && count === 0);
      icon.style.display = i < Math.max(1, count) ? 'block' : 'none';
    });
    // The next grenade sliding into the hand.
    if (changed) pop(this.icons[0], 0.8, 240);
  }
}
