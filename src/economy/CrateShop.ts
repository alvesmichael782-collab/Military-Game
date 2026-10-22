import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import type { ShopCrateType } from '../build/ShopCrate';
import type { Structure } from '../build/Structure';
import type { StructureManager } from '../build/StructureManager';
import { Groups } from '../core/CollisionGroups';
import type { CashSpendReason, EventBus, GameEvents, ShopKind, ShopPromptEvent, ShopSection } from '../core/EventBus';
import type { Input } from '../core/Input';
import { aimBasis, type AimState } from '../player/Aim';
import type { Purse } from './Purse';

export const ShopError = {
  CASH: 'NOT ENOUGH CASH',
  AMMO_FULL: 'AMMO FULL',
  OWNED: 'ALREADY OWNED',
  PLATES_FULL: 'PLATES FULL',
  GRENADES_FULL: 'GRENADES FULL',
} as const;

/**
 * A shop behind a buildable crate. Look at a built crate of `crateType` within `useRange` and press E (in any phase)
 * to open its menu: `shopOpened` carries the rows, `shopChanged` follows whenever one changes while it is open, and
 * the menu answers with `shopBuyRequested` and `shopCloseRequested`. Each buy pays through the purse (a failed spend
 * flashes the cash counter) and emits `shopPurchased`; a row that cannot be bought for any other reason gets
 * `actionDenied`. Subclasses say what is sold (`sections`) and what buying it does (`buy`).
 */
export abstract class CrateShop {
  abstract readonly kind: ShopKind;
  abstract readonly title: string;
  protected cash = 0;

  private open = false;
  private wantOpen = false;
  /** Set when the menu closes: the key that closed it must be let go before it can open the menu again. */
  private waitForRelease = false;
  private promptKey = '';
  private catalogKey = '';
  /** The crate the last `interactDistance` found under the crosshair, or null. */
  private looked: Structure | null = null;
  /** The crate whose menu is open. */
  private openCrate: Structure | null = null;

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

  constructor(
    private readonly crateType: ShopCrateType,
    private readonly useRange: number,
    private readonly world: RAPIER.World,
    private readonly structures: StructureManager,
    protected readonly purse: Purse,
    protected readonly events: EventBus<GameEvents>,
  ) {
    events.on('cashChanged', ({ cash }) => {
      this.cash = cash;
      this.refresh();
    });
    events.on('shopBuyRequested', ({ shop, item }) => {
      if (shop === this.kind && this.open) this.buy(item);
    });
    events.on('shopCloseRequested', ({ shop }) => {
      if (shop === this.kind) this.close();
    });
  }

  /** True while this shop's menu is open (the mouse is free for it). */
  get isOpen(): boolean {
    return this.open;
  }

  /** Call once per rendered frame, before `input.endFrame()`. */
  handleInput(input: Input, enabled: boolean): void {
    if (this.waitForRelease) {
      if (input.isActionDown('interact')) return;
      this.waitForRelease = false;
    }
    if (enabled && input.wasActionPressed('interact')) this.wantOpen = true;
  }

  /** How far away a crate of this shop is along the crosshair, in meters, or Infinity if none is in reach. */
  interactDistance(aim: AimState): number {
    aimBasis(aim.yaw, aim.pitch, this.forward, this.right, this.up);
    this.ray.origin = { x: aim.eye.x, y: aim.eye.y, z: aim.eye.z };
    this.ray.dir = { x: this.forward.x, y: this.forward.y, z: this.forward.z };
    const hit = this.world.castRay(this.ray, this.useRange, true, undefined, Groups.bullet);
    const structure = hit ? this.structures.structureOf(hit.collider) : undefined;
    this.looked = structure?.type === this.crateType ? structure : null;
    return this.looked && hit ? hit.timeOfImpact : Infinity;
  }

  /** Show the prompt and open the menu on E. `enabled` is whether this crate wins E this frame (see `interactDistance`). */
  update(enabled: boolean): void {
    if (this.open) {
      // The crate went away under the open menu.
      if (this.openCrate && !this.structures.byId(this.openCrate.id)) this.close();
      this.wantOpen = false;
      return;
    }
    const crate = enabled && this.looked && this.structures.byId(this.looked.id) ? this.looked : null;
    if (!crate) {
      this.wantOpen = false;
      this.setPrompt({ mode: 'hidden' });
      return;
    }
    this.setPrompt({ mode: 'open', shop: this.kind, title: this.title });
    if (this.wantOpen) this.openMenu(crate);
    this.wantOpen = false;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.openCrate = null;
    this.waitForRelease = true;
    this.events.emit('shopClosed', { shop: this.kind });
  }

  private openMenu(crate: Structure): void {
    this.open = true;
    this.openCrate = crate;
    this.setPrompt({ mode: 'hidden' });
    const sections = this.sections();
    this.catalogKey = JSON.stringify(sections);
    this.events.emit('shopOpened', { shop: this.kind, title: this.title, sections });
  }

  /** Re-send the menu's rows if anything on them changed. Call when cash, loadout, ammo or supplies change. */
  protected refresh(): void {
    if (!this.open) return;
    const sections = this.sections();
    const key = JSON.stringify(sections);
    if (key === this.catalogKey) return;
    this.catalogKey = key;
    this.events.emit('shopChanged', { shop: this.kind, title: this.title, sections });
  }

  /**
   * Pay `cost` and report the purchase. False (and nothing paid) when `error` is set: a lack of cash flashes the
   * cash counter (the purse reports it), any other reason is an `actionDenied`.
   */
  protected pay(item: string, cost: number, reason: CashSpendReason, error: string | null): boolean {
    if (error !== null && error !== ShopError.CASH) {
      this.events.emit('actionDenied', {});
      return false;
    }
    if (!this.purse.spend(cost, reason)) return false;
    this.events.emit('shopPurchased', { shop: this.kind, item, cost });
    return true;
  }

  /** Every row of the menu as it stands now. */
  protected abstract sections(): ShopSection[];
  /** The menu asked to buy the row with id `item`. */
  protected abstract buy(item: string): void;

  /** Emit the prompt only when what it says changes. */
  private setPrompt(prompt: ShopPromptEvent): void {
    const key = JSON.stringify(prompt);
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.events.emit('shopPromptChanged', prompt);
  }
}
