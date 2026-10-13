import type { EventBus, GameEvents } from '../../core/EventBus';
import type { WeaponDef } from './defs/WeaponDef';
import type { HeldWeapon } from './HeldWeapon';

/** Slot indexes: two gun slots (keys 1 and 2), then the melee slot (key 3). */
export const SLOT_GUN_1 = 0;
export const SLOT_GUN_2 = 1;
export const SLOT_MELEE = 2;
const SLOT_COUNT = 3;

/** What a purchase did. */
export interface Acquired {
  readonly slot: number;
  /** The weapon was already owned, so it was refilled instead of taking a slot. */
  readonly refill: boolean;
}

/**
 * The weapons the player carries and which one they want in hand. Slots 1 and 2 hold guns, slot 3 the melee
 * weapon. Each weapon object lives as long as it is carried, so every gun keeps its own magazine and reserve.
 *
 * Buying a gun:
 * - already owned: that gun is refilled, nothing moves;
 * - one gun carried: the new gun goes into slot 1 and the old one moves to slot 2;
 * - both gun slots full: the new gun replaces the one in hand, in that slot (with the melee weapon in hand, the
 *   gun in the slot used last).
 * The new gun is selected. A melee weapon always goes into slot 3, replacing any there, and is selected.
 *
 * Announces every change with `loadoutChanged`. The weapon manager does the switching animation.
 */
export class Loadout {
  private readonly slots: (HeldWeapon | null)[] = new Array<HeldWeapon | null>(SLOT_COUNT).fill(null);
  private _current = SLOT_GUN_1;
  private lastGunSlot = SLOT_GUN_1;

  constructor(
    private readonly create: (def: WeaponDef) => HeldWeapon,
    private readonly events: EventBus<GameEvents>,
  ) {}

  /** The slot the player wants in hand. */
  get current(): number {
    return this._current;
  }

  /** The weapon in the current slot, or null if it is empty. */
  get selected(): HeldWeapon | null {
    return this.slots[this._current];
  }

  slot(index: number): HeldWeapon | null {
    return this.slots[index] ?? null;
  }

  /** Every weapon carried, in slot order. */
  get weapons(): HeldWeapon[] {
    return this.slots.filter((w): w is HeldWeapon => w !== null);
  }

  /** The carried weapon with this id, if any. */
  find(id: string): HeldWeapon | null {
    return this.slots.find((w) => w?.def.id === id) ?? null;
  }

  /** Select a slot. Returns false (and changes nothing) if it is empty or already selected. */
  select(index: number): boolean {
    if (index === this._current || !this.slots[index]) return false;
    this.setCurrent(index);
    this.announce();
    return true;
  }

  /** Add a bought (or starting) weapon by the slot rules, select it, and announce the new loadout. */
  acquire(def: WeaponDef): Acquired {
    if (def.slot === 'melee') {
      this.slots[SLOT_MELEE] = this.create(def);
      this.setCurrent(SLOT_MELEE);
      this.announce();
      return { slot: SLOT_MELEE, refill: false };
    }

    const owned = this.slots.findIndex((w) => w?.def.id === def.id);
    if (owned >= 0) {
      this.slots[owned]?.refill();
      return { slot: owned, refill: true };
    }

    const gun1 = this.slots[SLOT_GUN_1];
    const gun2 = this.slots[SLOT_GUN_2];
    let slot: number;
    if (gun1 && gun2) {
      // Both full: replace the gun in hand, or the one used last if the melee weapon is out.
      slot = this._current === SLOT_GUN_1 || this._current === SLOT_GUN_2 ? this._current : this.lastGunSlot;
    } else {
      // Zero or one gun: the new one takes slot 1 and the old one (if any) goes to slot 2.
      this.slots[SLOT_GUN_2] = gun1 ?? gun2;
      slot = SLOT_GUN_1;
    }
    this.slots[slot] = this.create(def);
    this.setCurrent(slot);
    this.announce();
    return { slot, refill: false };
  }

  /** Emit the current loadout, e.g. so a freshly built HUD or shop can read it. */
  announce(): void {
    this.events.emit('loadoutChanged', {
      slots: this.slots.map((w) => w?.def.id ?? null),
      current: this._current,
    });
  }

  private setCurrent(index: number): void {
    this._current = index;
    if (index === SLOT_GUN_1 || index === SLOT_GUN_2) this.lastGunSlot = index;
  }
}
