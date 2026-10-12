import type { EventBus, GameEvents } from '../../core/EventBus';
import { Phase } from '../../core/GameState';
import { prefersReducedMotion } from './motion';
import './WaveNumber.css';

/** Seconds the pulse lasts. */
const PULSE_TIME = 0.75;

/** Large red hand-drawn wave number in the bottom-left corner. Pulses and flashes when a wave begins. */
export class WaveNumber {
  private readonly element = document.createElement('div');
  private readonly digits = document.createElement('span');
  private wave = 0;
  private pulse: Animation | null = null;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.element.className = 'hud-wave';
    this.digits.className = 'hud-wave__digits';
    this.element.append(this.digits);
    parent.append(this.element);

    events.on('phaseChanged', ({ to, wave }) => {
      if (wave !== this.wave) {
        this.wave = wave;
        this.digits.textContent = String(wave);
        this.playPulse();
      } else if (to === Phase.FIGHT) {
        // The fight is the wave actually starting; pulse again as the enemies come.
        this.playPulse();
      }
    });
  }

  private playPulse(): void {
    this.pulse?.cancel();
    if (prefersReducedMotion()) {
      // Flash only, no scaling.
      this.pulse = this.element.animate([{ color: '#ff7a5c' }, { color: 'var(--hud-red)' }], { duration: 500, easing: 'ease-out' });
      return;
    }
    this.pulse = this.element.animate(
      [
        { transform: 'scale(1)', color: 'var(--hud-red)' },
        { transform: 'scale(1.4)', color: '#ff7a5c', textShadow: '0 0 0.25em rgba(255, 70, 40, 0.9)', offset: 0.14 },
        { transform: 'scale(0.94)', color: '#e0281e', offset: 0.42 },
        { transform: 'scale(1.04)', offset: 0.65 },
        { transform: 'scale(1)', color: 'var(--hud-red)' },
      ],
      { duration: PULSE_TIME * 1000, easing: 'ease-out' },
    );
  }
}
