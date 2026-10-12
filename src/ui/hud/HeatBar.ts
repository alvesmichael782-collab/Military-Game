import type { EventBus, GameEvents } from '../../core/EventBus';
import './HeatBar.css';

/**
 * The MG's heat, in the ammo count's place over the same red smear while the player is on the gun.
 * Fills as the gun fires and drains as it cools; flashes red while it is locked from overheating.
 */
export class HeatBar {
  private readonly root = document.createElement('div');
  private readonly fill = document.createElement('div');

  constructor(events: EventBus<GameEvents>, anchor: HTMLElement) {
    this.root.className = 'hud-heat';
    this.root.hidden = true;
    const track = document.createElement('div');
    track.className = 'hud-heat__track';
    this.fill.className = 'hud-heat__fill';
    track.append(this.fill);
    this.root.append(track);
    anchor.append(this.root);

    events.on('mgMounted', () => (this.root.hidden = false));
    events.on('mgDismounted', () => (this.root.hidden = true));
    events.on('mgHeatChanged', ({ heat, overheated }) => {
      this.fill.style.transform = `scaleX(${heat.toFixed(3)})`;
      this.root.classList.toggle('is-hot', heat >= 0.75);
      this.root.classList.toggle('is-overheated', overheated);
    });
  }
}
