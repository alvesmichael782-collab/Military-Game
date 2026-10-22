import type RAPIER from '@dimforge/rapier3d-compat';
import type { StructureManager } from '../build/StructureManager';
import { config } from '../core/config';
import type { CashSpendReason, EventBus, GameEvents, ShopItem, ShopSection } from '../core/EventBus';
import { CrateShop, ShopError } from './CrateShop';
import type { Purse } from './Purse';

/** One thing the consumables crate sells. A new consumable is one more entry here. */
interface Consumable {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly reason: CashSpendReason;
  readonly fullError: string;
  /** How many the player carries now, and the most they can carry. */
  carried(shop: ConsumablesShop): { count: number; max: number };
  /** Tell the system that owns it that one was bought. */
  deliver(events: EventBus<GameEvents>, cost: number): void;
}

const CONSUMABLES: readonly Consumable[] = [
  {
    id: 'armorPlate',
    name: 'ARMOR PLATE',
    price: config.economy.prices.armorPlate,
    reason: 'plate',
    fullError: ShopError.PLATES_FULL,
    carried: (shop) => ({ count: shop.spares, max: config.armor.maxSpares }),
    deliver: (events, cost) => events.emit('platePurchased', { cost }),
  },
  {
    id: 'grenade',
    name: 'FRAG GRENADE',
    price: config.economy.prices.grenade,
    reason: 'grenade',
    fullError: ShopError.GRENADES_FULL,
    carried: (shop) => ({ count: shop.grenades, max: config.grenade.maxCount }),
    deliver: (events, cost) => events.emit('grenadePurchased', { cost }),
  },
];

/**
 * The consumables crate's shop: spare armor plates and frag grenades, one per click, up to what the player can
 * carry. A plate purchase emits `platePurchased` (the player's armor adds a spare), a grenade `grenadePurchased`
 * (the thrower adds one). Learns cash, spares and grenades from events.
 */
export class ConsumablesShop extends CrateShop {
  readonly kind = 'consumables';
  readonly title = 'CONSUMABLES CRATE';
  spares = 0;
  grenades = 0;

  constructor(world: RAPIER.World, structures: StructureManager, purse: Purse, events: EventBus<GameEvents>) {
    super('consumablesCrate', config.consumablesCrate.useRange, world, structures, purse, events);
    events.on('armorChanged', ({ spares }) => {
      this.spares = spares;
      this.refresh();
    });
    events.on('grenadesChanged', ({ count }) => {
      this.grenades = count;
      this.refresh();
    });
  }

  protected sections(): ShopSection[] {
    return [{ id: 'supplies', name: 'SUPPLIES', items: CONSUMABLES.map((c) => this.itemOf(c)) }];
  }

  protected buy(item: string): void {
    const consumable = CONSUMABLES.find((c) => c.id === item);
    if (!consumable) return;
    const row = this.itemOf(consumable);
    if (this.pay(consumable.id, row.price, consumable.reason, row.error)) consumable.deliver(this.events, row.price);
  }

  private itemOf(c: Consumable): ShopItem {
    const { count, max } = c.carried(this);
    const error = count >= max ? c.fullError : this.cash < c.price ? ShopError.CASH : null;
    const affordable = this.cash >= c.price;
    return { id: c.id, name: c.name, icon: c.id, action: 'buy', price: c.price, detail: `CARRYING ${count} / ${max}`, error, affordable };
  }
}
