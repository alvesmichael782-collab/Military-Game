import type { EventBus, GameEvents } from '../../core/EventBus';
import { prefersReducedMotion } from './motion';
import './HealthBar.css';

/** At or below this fraction of max health the bar pulses as a warning. */
const CRITICAL_FRACTION = 0.3;

/**
 * White health bar under the armor bar. Lost health drops at once and lingers as a faint trail
 * that catches up after a beat; the bar flashes red on a hit and pulses when health is critical.
 */
export class HealthBar {
  private readonly root = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly trail = document.createElement('div');
  private health = -1;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.root.className = 'hud-health';
    this.trail.className = 'hud-health__trail';
    this.fill.className = 'hud-health__fill';
    this.root.append(this.trail, this.fill);
    parent.append(this.root);

    events.on('healthChanged', ({ health, maxHealth }) => {
      const hurt = this.health >= 0 && health < this.health;
      this.health = health;
      const fraction = Math.max(0, health / maxHealth);
      const scale = `scaleX(${fraction.toFixed(3)})`;
      this.root.classList.toggle('is-draining', hurt);
      this.root.classList.toggle('is-critical', health > 0 && fraction <= CRITICAL_FRACTION);
      this.fill.style.transform = scale;
      this.trail.style.transform = scale;
      if (hurt) this.flashHit();
    });
  }

  private flashHit(): void {
    const keyframes: Keyframe[] = [{ backgroundColor: '#e8402e' }, { backgroundColor: 'var(--hud-white)' }];
    this.fill.animate(keyframes, { duration: prefersReducedMotion() ? 200 : 350, easing: 'ease-out' });
  }
}
