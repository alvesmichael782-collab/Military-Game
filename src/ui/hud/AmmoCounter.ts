import { config } from '../../core/config';
import type { EventBus, GameEvents } from '../../core/EventBus';
import { createBrushSmear } from './BrushSmear';
import { setFixedDigits } from './digits';
import { pop, prefersReducedMotion } from './motion';
import './AmmoCounter.css';

/**
 * Bottom right: big magazine count, thin divider, zero-padded reserve ("13 | 062") over a red smear.
 * The magazine dims while reloading and pops when the fresh magazine is in; a dry fire shakes it.
 * Hidden while the player is on the MG, whose heat bar shows over the same smear.
 */
export class AmmoCounter {
  private readonly magazine = document.createElement('span');
  private readonly reserve = document.createElement('span');
  private reloading = false;

  constructor(events: EventBus<GameEvents>, anchor: HTMLElement) {
    const smear = createBrushSmear({
      width: 240,
      height: 52,
      color: '#9a161b',
      seed: 13062,
      fadeLeft: 0.55,
      fadeRight: 0.1,
      streaks: 22,
      coreOpacity: 0.9,
      coreStart: 0.36,
    });
    smear.classList.add('hud-ammo__smear');

    const divider = document.createElement('div');
    divider.className = 'hud-ammo__divider';
    this.magazine.className = 'hud-ammo__magazine';
    this.reserve.className = 'hud-ammo__reserve';
    anchor.append(smear, this.magazine, divider, this.reserve);

    events.on('ammoChanged', ({ magazine, magazineSize, reserve }) => {
      setFixedDigits(this.magazine, String(magazine));
      this.magazine.classList.toggle('is-low', magazine <= magazineSize * config.hud.lowAmmoFraction);
      setFixedDigits(this.reserve, String(reserve).padStart(3, '0'));
      // No shots land during a reload, so the next ammo change is the reload finishing.
      if (this.reloading) {
        this.reloading = false;
        this.magazine.classList.remove('is-reloading');
        pop(this.magazine, 1.12, 300);
      }
    });
    events.on('weaponReloadStarted', () => {
      this.reloading = true;
      this.magazine.classList.add('is-reloading');
    });
    events.on('weaponDryFired', () => this.shake());
    // On the MG the heat bar takes the numbers' place over the same smear.
    const numbers = [this.magazine, divider, this.reserve];
    events.on('mgMounted', () => numbers.forEach((n) => (n.hidden = true)));
    events.on('mgDismounted', () => numbers.forEach((n) => (n.hidden = false)));
  }

  /** Empty click: a short sideways shake so the empty magazine reads at a glance. */
  private shake(): void {
    if (prefersReducedMotion()) return;
    const x = (n: number): string => `translateX(calc(${n} * var(--rp)))`;
    this.magazine.animate(
      [{ transform: x(0) }, { transform: x(-4) }, { transform: x(4) }, { transform: x(-2.5) }, { transform: x(1.5) }, { transform: x(0) }],
      { duration: 260, easing: 'ease-out' },
    );
  }
}
