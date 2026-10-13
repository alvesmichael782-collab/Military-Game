import { config } from '../../core/config';
import type { EventBus, GameEvents } from '../../core/EventBus';
import { createBrushSmear } from './BrushSmear';
import { setFixedDigits } from './digits';
import { pop, prefersReducedMotion } from './motion';
import './AmmoCounter.css';

/**
 * Bottom right: big magazine count, thin divider, zero-padded reserve ("13 | 062") over a red smear.
 * Shows the weapon in hand. The magazine dims while reloading and pops when the fresh magazine is in; a dry
 * fire shakes it. Hidden while the player is on the MG, whose heat bar shows over the same smear, and with the knife.
 */
export class AmmoCounter {
  private readonly magazine = document.createElement('span');
  private readonly reserve = document.createElement('span');
  private readonly divider = document.createElement('div');
  private readonly smear: SVGSVGElement;
  private reloading = false;
  /** The weapon in hand: only its ammo is shown (a refill of the other gun must not take over the counter). */
  private weapon = '';
  private melee = false;
  private mounted = false;

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
    this.smear = smear;

    this.divider.className = 'hud-ammo__divider';
    this.magazine.className = 'hud-ammo__magazine';
    this.reserve.className = 'hud-ammo__reserve';
    anchor.append(smear, this.magazine, this.divider, this.reserve);

    events.on('weaponEquipped', ({ weapon, kind }) => {
      this.weapon = weapon;
      this.melee = kind === 'melee';
      this.reloading = false;
      this.magazine.classList.remove('is-reloading');
      this.render();
    });
    events.on('ammoChanged', ({ weapon, magazine, magazineSize, reserve }) => {
      if (weapon !== this.weapon) return;
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
    events.on('weaponReloadStarted', ({ weapon }) => {
      if (weapon !== this.weapon) return;
      this.reloading = true;
      this.magazine.classList.add('is-reloading');
    });
    events.on('weaponReloadCancelled', () => {
      this.reloading = false;
      this.magazine.classList.remove('is-reloading');
    });
    events.on('weaponDryFired', () => this.shake());
    events.on('mgMounted', () => {
      this.mounted = true;
      this.render();
    });
    events.on('mgDismounted', () => {
      this.mounted = false;
      this.render();
    });
  }

  /**
   * On the MG the heat bar takes the numbers' place over the same smear. With the knife there is no ammo, so the
   * numbers and their smear are hidden and only the weapon name shows.
   */
  private render(): void {
    const hideNumbers = this.mounted || this.melee;
    for (const n of [this.magazine, this.divider, this.reserve]) n.hidden = hideNumbers;
    this.smear.toggleAttribute('hidden', this.melee && !this.mounted);
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
