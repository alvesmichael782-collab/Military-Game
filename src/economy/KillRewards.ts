import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import { localPlayerId } from '../net/PlayerId';
import type { CashWallet } from './CashWallet';

/**
 * Pays cash for enemies the player kills (more for sappers, plus a headshot bonus), through the wallet so
 * the HUD pops up the amount. Kills by satchels, other enemies or anything else pay nothing. In multiplayer each
 * player keeps their own cash: a kill pays only the player who made it.
 */
export function connectKillRewards(events: EventBus<GameEvents>, wallet: CashWallet): void {
  events.on('enemyKilled', ({ type, source, headshot, killer }) => {
    if (source !== 'player' || killer !== localPlayerId()) return;
    const rewards = config.economy.killRewards;
    wallet.earn(rewards[type] + (headshot ? rewards.headshotBonus : 0), 'kill');
  });
}
