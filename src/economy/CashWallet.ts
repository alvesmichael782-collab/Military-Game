import { config } from '../core/config';
import type { CashEarnReason, CashSpendReason, EventBus, GameEvents } from '../core/EventBus';

/** The player's cash, in whole dollars. Earned from kills and wave bonuses, spent on building, repairs and plates. */
export class CashWallet {
  private _cash: number = config.economy.startingCash;

  constructor(private readonly events: EventBus<GameEvents>) {}

  get cash(): number {
    return this._cash;
  }

  earn(amount: number, reason: CashEarnReason): void {
    if (amount <= 0) return;
    this._cash += amount;
    this.events.emit('cashEarned', { amount, cash: this._cash, reason });
    this.announce();
  }

  /** Spend `amount` if the player can afford it. Otherwise spends nothing, emits `cashInsufficient` and returns false. */
  spend(amount: number, reason: CashSpendReason): boolean {
    if (amount <= 0) return false;
    if (amount > this._cash) {
      this.events.emit('cashInsufficient', { cost: amount, cash: this._cash });
      return false;
    }
    this._cash -= amount;
    this.events.emit('cashSpent', { amount, cash: this._cash, reason });
    this.announce();
    return true;
  }

  /** Emit the current balance, e.g. so a freshly built HUD can draw it. */
  announce(): void {
    this.events.emit('cashChanged', { cash: this._cash });
  }
}
