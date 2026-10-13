import type { EventBus, GameEvents } from '../../core/EventBus';
import './WeaponName.css';

/** The name of the weapon in hand in white under the ammo count, or the MG's while the player is on it. */
export class WeaponName {
  private readonly element = document.createElement('div');
  private weapon = '';
  private mounted: string | null = null;

  constructor(events: EventBus<GameEvents>, anchor: HTMLElement) {
    this.element.className = 'hud-weapon-name';
    anchor.append(this.element);
    events.on('weaponEquipped', ({ displayName }) => {
      this.weapon = displayName;
      this.render();
    });
    events.on('mgMounted', ({ displayName }) => {
      this.mounted = displayName;
      this.render();
    });
    events.on('mgDismounted', () => {
      this.mounted = null;
      this.render();
    });
  }

  private render(): void {
    const name = this.mounted ?? this.weapon;
    if (this.element.textContent !== name) this.element.textContent = name;
  }
}
