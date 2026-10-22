import type { EventBus, GameEvents } from '../../core/EventBus';
import './Squad.css';

/** Seconds a notice stays up. */
const NOTICE_TIME = 4;

/**
 * Multiplayer notices: a short line under the phase banner when a teammate leaves, and, if the host is gone,
 * a screen saying so with a way back to the main menu (the game cannot go on without the host).
 */
export class NetNotices {
  private readonly line = document.createElement('div');
  private readonly lost = document.createElement('div');
  private readonly reason = document.createElement('div');
  private timer = 0;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.line.className = 'hud-notice';
    this.line.hidden = true;

    this.lost.className = 'hud-lost';
    this.lost.hidden = true;
    const title = document.createElement('div');
    title.className = 'hud-lost__title';
    title.textContent = 'Connection lost';
    this.reason.className = 'hud-lost__reason';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-lost__button';
    button.textContent = 'Main menu';
    button.addEventListener('click', () => window.location.reload());
    this.lost.append(title, this.reason, button);
    parent.append(this.line, this.lost);

    events.on('peerLeft', ({ name }) => this.show(`${name} left the game`));
    events.on('connectionLost', ({ reason }) => {
      this.reason.textContent = reason;
      this.lost.hidden = false;
    });
  }

  update(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) this.line.hidden = true;
  }

  private show(text: string): void {
    this.line.textContent = text;
    this.line.hidden = false;
    this.timer = NOTICE_TIME;
  }
}
