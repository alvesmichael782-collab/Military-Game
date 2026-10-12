/** Spends and refunds cash. The CashWallet satisfies this; systems that charge the player depend on it, not the wallet. */
export interface Purse {
  /** Returns false (and the wallet reports `cashInsufficient`) when the player cannot afford it. */
  spend(amount: number): boolean;
  earn(amount: number): void;
}
