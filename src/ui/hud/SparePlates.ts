import type { EventBus, GameEvents } from '../../core/EventBus';
import { pop } from './motion';
import './SparePlates.css';

/** A ballistic plate: chamfered top corners, slightly rounded bottom, and a dark edge line inset. */
const PLATE_SVG = `
<svg viewBox="0 0 24 28" aria-hidden="true">
  <path d="M6 1 H18 L23 6 V20 Q23 24.5 18 26 L12 27.5 L6 26 Q1 24.5 1 20 V6 Z" fill="currentColor"/>
  <path d="M7 4 H17 L20 7 V19.5 Q20 22.5 17 23.5 L12 24.7 L7 23.5 Q4 22.5 4 19.5 V7 Z"
        fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="1.2"/>
</svg>`;

/** Plate icon and "x3" spare plate count, right of the armor and health bars. */
export class SparePlates {
  private readonly root = document.createElement('div');
  private readonly count = document.createElement('span');
  private spares = -1;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.root.className = 'hud-plates';
    const icon = document.createElement('div');
    icon.className = 'hud-plates__icon';
    icon.innerHTML = PLATE_SVG;
    this.count.className = 'hud-plates__count';
    this.root.append(icon, this.count);
    parent.append(this.root);

    events.on('armorChanged', ({ spares }) => {
      if (spares === this.spares) return;
      const changed = this.spares >= 0;
      this.spares = spares;
      this.count.textContent = `x${spares}`;
      this.root.classList.toggle('is-empty', spares === 0);
      if (changed) pop(this.root, 1.18);
    });
  }
}
