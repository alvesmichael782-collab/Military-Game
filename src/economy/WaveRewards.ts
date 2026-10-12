import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { CashWallet } from './CashWallet';

/** Pays the wave-clear bonus ($250 + $50 x wave by default) through the wallet, so the HUD pops it up. */
export function connectWaveRewards(events: EventBus<GameEvents>, wallet: CashWallet): void {
  events.on('waveCleared', ({ wave }) => {
    const bonus = config.economy.waveClearBonus;
    wallet.earn(bonus.base + bonus.perWave * wave);
  });
}
