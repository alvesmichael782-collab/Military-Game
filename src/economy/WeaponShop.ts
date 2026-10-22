import type RAPIER from '@dimforge/rapier3d-compat';
import type { StructureManager } from '../build/StructureManager';
import { config } from '../core/config';
import type { EventBus, GameEvents, ShopItem, ShopSection } from '../core/EventBus';
import { isGunDef, WEAPON_DEFS } from '../player/weapons/defs';
import { WEAPON_CATEGORIES, type FireMode, type WeaponDef } from '../player/weapons/defs/WeaponDef';
import { CrateShop, ShopError } from './CrateShop';
import type { Purse } from './Purse';

/** Ammo last reported for a carried gun. */
interface AmmoState {
  magazine: number;
  reserve: number;
}

const FIRE_MODES: Readonly<Record<FireMode, string>> = { semi: 'SEMI-AUTO', auto: 'FULL AUTO', burst: 'BURST' };

/**
 * The weapon crate's shop: every weapon, by section (pistols, SMGs, assault rifles, melee; cheapest first in each).
 * A carried gun's row refills its magazine and reserve instead. A purchase emits `weaponPurchased`, which the weapon
 * manager answers by placing the weapon by the slot rules. Learns the loadout, ammo and cash from events.
 */
export class WeaponShop extends CrateShop {
  readonly kind = 'weapons';
  readonly title = 'WEAPON CRATE';
  private carried: readonly (string | null)[] = [];
  private readonly ammo = new Map<string, AmmoState>();

  constructor(world: RAPIER.World, structures: StructureManager, purse: Purse, events: EventBus<GameEvents>) {
    super('weaponCrate', config.weaponCrate.useRange, world, structures, purse, events);
    events.on('loadoutChanged', ({ slots }) => {
      this.carried = slots;
      this.refresh();
    });
    events.on('ammoChanged', ({ weapon, magazine, reserve }) => {
      this.ammo.set(weapon, { magazine, reserve });
      this.refresh();
    });
  }

  protected sections(): ShopSection[] {
    return WEAPON_CATEGORIES.map(({ id, name }) => ({
      id,
      name,
      items: WEAPON_DEFS.filter((def) => def.category === id).map((def) => this.itemOf(def)),
    })).filter((section) => section.items.length > 0);
  }

  protected buy(item: string): void {
    const def = WEAPON_DEFS.find((d) => d.id === item);
    if (!def) return;
    const row = this.itemOf(def);
    const refill = row.action === 'refill';
    if (this.pay(def.id, row.price, refill ? 'ammo' : 'weapon', row.error)) {
      this.events.emit('weaponPurchased', { weapon: def.id, displayName: def.displayName, cost: row.price, refill });
    }
  }

  private itemOf(def: WeaponDef): ShopItem {
    const owned = this.carried.includes(def.id);
    const refill = owned && isGunDef(def);
    const price = refill && isGunDef(def) ? def.refillPrice : def.price;
    let detail: string;
    if (refill) detail = 'OWNED · REFILL AMMO';
    else if (owned) detail = 'OWNED';
    else detail = isGunDef(def) ? `${FIRE_MODES[def.fireMode]} · ${def.magazineSize} RDS` : 'MELEE';
    return {
      id: def.id,
      name: def.displayName,
      icon: def.id,
      action: refill ? 'refill' : 'buy',
      price,
      detail,
      error: this.errorFor(def, owned, price),
      affordable: this.cash >= price,
    };
  }

  private errorFor(def: WeaponDef, owned: boolean, cost: number): string | null {
    if (owned && !isGunDef(def)) return ShopError.OWNED;
    if (owned && isGunDef(def)) {
      const ammo = this.ammo.get(def.id);
      if (ammo && ammo.magazine >= def.magazineSize && ammo.reserve >= def.reserveAmmo) return ShopError.AMMO_FULL;
    }
    return this.cash < cost ? ShopError.CASH : null;
  }
}
