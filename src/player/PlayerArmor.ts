import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { Input } from '../core/Input';

/**
 * Armor plates. The armor bar holds `maxPlates` segments of `armorPerPlate` each and never regenerates.
 * Holding V applies a spare plate (one segment's worth of armor) every `applyTime` seconds,
 * chaining while V stays held, spares remain and armor is missing. Letting go cancels the plate in progress.
 */
export class PlayerArmor {
  private _armor: number = config.armor.maxPlates * config.armor.armorPerPlate;
  private _spares: number = config.armor.startingSpares;
  private held = false;
  /** Seconds into the current plate, or -1 when not plating. */
  private progress = -1;

  constructor(private readonly events: EventBus<GameEvents>) {
    // The armor crate has already checked the limit and taken the cash.
    events.on('platePurchased', () => {
      this._spares = Math.min(config.armor.maxSpares, this._spares + 1);
      this.announce();
    });
  }

  /** Debug (stress test): full armor at once, without using spare plates. */
  refill(): void {
    this._armor = this.maxArmor;
    this.announce();
  }

  get armor(): number {
    return this._armor;
  }

  get maxArmor(): number {
    return config.armor.maxPlates * config.armor.armorPerPlate;
  }

  get spares(): number {
    return this._spares;
  }

  /** True while a plate is going on. The rifle cannot fire meanwhile. */
  get isPlating(): boolean {
    return this.progress >= 0;
  }

  /** 0..1 through the current plate, 0 when not plating. */
  get plateProgress(): number {
    return this.isPlating ? this.progress / config.armor.applyTime : 0;
  }

  /** Soak up as much of `amount` as the armor holds. Returns the armor damage taken. */
  absorb(amount: number): number {
    const taken = Math.min(this._armor, amount);
    if (taken <= 0) return 0;
    this._armor -= taken;
    this.announce();
    return taken;
  }

  /** Call once per rendered frame, before `input.endFrame()`. Hold the plate key (V) to apply plates. */
  handleInput(input: Input, active: boolean): void {
    this.held = active && input.isActionDown('applyPlate');
  }

  /** Advance plating. `alive` false cancels it. */
  update(dt: number, alive: boolean): void {
    if (!this.held || !alive || !this.canPlate()) {
      if (this.isPlating) this.events.emit('plateProgress', { progress: 0 });
      this.progress = -1;
      return;
    }
    this.progress = Math.max(0, this.progress) + dt;
    if (this.progress < config.armor.applyTime) {
      this.events.emit('plateProgress', { progress: this.plateProgress });
      return;
    }

    this._armor = Math.min(this.maxArmor, this._armor + config.armor.armorPerPlate);
    this._spares--;
    this.events.emit('plateApplied', { armor: this._armor, spares: this._spares });
    this.announce();
    // Chain straight into the next plate if V is still held; otherwise stop.
    this.progress = this.canPlate() ? 0 : -1;
    this.events.emit('plateProgress', { progress: 0 });
  }

  /** Emit the current armor state, e.g. so a freshly built HUD can draw it. */
  announce(): void {
    this.events.emit('armorChanged', { armor: this._armor, spares: this._spares });
  }

  private canPlate(): boolean {
    return this._spares > 0 && this._armor < this.maxArmor;
  }
}
