import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { CashWallet } from './CashWallet';

/**
 * Pays cash for enemies the player kills (more for sappers, plus a headshot bonus), through the wallet so
 * the HUD pops up the amount. Kills by satchels, other enemies or anything else pay nothing.
 */
export function connectKillRewards(events: EventBus<GameEvents>, wallet: CashWallet): void {
  events.on('enemyKilled', ({ type, source, headshot }) => {
    if (source !== 'player') return;
    const rewards = config.economy.killRewards;
    wallet.earn(rewards[type] + (headshot ? rewards.headshotBonus : 0), 'kill');
  });
}
