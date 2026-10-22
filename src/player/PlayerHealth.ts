import { Vector3 } from 'three';
import type { DamageInfo } from '../combat/Damage';
import type { Damageable } from '../combat/Damageable';
import type { DamageType } from '../combat/DamageType';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import { Phase } from '../core/GameState';
import type { PlayerArmor } from './PlayerArmor';

/**
 * Armor plates plus health. Damage drains the armor first and overflows into health.
 * Neither regenerates during a fight; health refills to full at the start of each build phase.
 * Damage arrives through `applyDamage`, like every other damageable.
 */
export class PlayerHealth implements Damageable {
  readonly kind = 'player';

  private _health: number = config.playerHealth.maxHealth;
  private readonly center = new Vector3();

  /** `body.position` is the player's feet. */
  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly body: { readonly position: Vector3 },
    private readonly armor: PlayerArmor,
  ) {
    events.on('phaseChanged', ({ to }) => {
      if (to === Phase.BUILD) this.refill();
    });
  }

  /** Back to full health (each build phase, and the stress test). Never brings the dead back. */
  refill(): void {
    if (this.isDead) return;
    this._health = config.playerHealth.maxHealth;
    this.announce();
  }

  /** Multiplayer: back on their feet at full health after being down (at the next build phase). */
  revive(): void {
    if (!this.isDead) return;
    this._health = config.playerHealth.maxHealth;
    this.announce();
  }

  /** Emit the current health, e.g. so a freshly built HUD can draw it. */
  announce(): void {
    this.events.emit('healthChanged', { health: this._health, maxHealth: config.playerHealth.maxHealth });
  }

  /** Middle of the standing body, for explosion distance. */
  get position(): Vector3 {
    return this.center.copy(this.body.position).setY(this.body.position.y + config.player.standHeight / 2);
  }

  get isAlive(): boolean {
    return !this.isDead;
  }

  get health(): number {
    return this._health;
  }

  get isDead(): boolean {
    return this._health <= 0;
  }

  /** `position` is where the damage came from: the shooter's eyes, or the blast center. */
  takeDamage(amount: number, type: DamageType, position: Vector3, info: DamageInfo = {}): void {
    if (this.isDead || amount <= 0) return;

    const armorBefore = this.armor.armor;
    const armorDamage = this.armor.absorb(amount);
    const healthDamage = Math.min(this._health, amount - armorDamage);
    this._health -= healthDamage;

    this.events.emit('playerDamaged', {
      amount,
      type,
      position: position.clone(),
      armorDamage,
      healthDamage,
      armor: this.armor.armor,
      health: this._health,
      attacker: info.attacker ?? null,
    });
    if (armorBefore > 0 && this.armor.armor <= 0) this.events.emit('armorBroken', { position: position.clone() });
    if (healthDamage > 0) this.announce();
    if (this.isDead) this.events.emit('playerDied', { type });
  }
}
