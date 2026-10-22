import type { EventBus, GameEvents } from '../../core/EventBus';
import './Squad.css';

/** Multiplayer: "YOU ARE DOWN" while this player waits out the wave for the next build phase. */
export class DownedBanner {
  private readonly root = document.createElement('div');

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.root.className = 'hud-downed';
    this.root.hidden = true;
    const title = document.createElement('div');
    title.className = 'hud-downed__title';
    title.textContent = 'You are down';
    const line = document.createElement('div');
    line.className = 'hud-downed__line';
    line.textContent = 'Back in the fight next build phase';
    this.root.append(title, line);
    parent.append(this.root);
    events.on('playerDowned', ({ down }) => {
      this.root.hidden = !down;
    });
    events.on('gameOver', () => {
      this.root.hidden = true;
    });
  }
}
