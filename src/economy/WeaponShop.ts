import RAPIER from '@dimforge/rapier3d-compat';
import { Object3D, Vector3, type Mesh, type Scene } from 'three';
import type { StructureManager } from '../build/StructureManager';
import type { Structure } from '../build/Structure';
import { WeaponCrate } from '../build/WeaponCrate';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { EventBus, GameEvents, ShopPromptEvent } from '../core/EventBus';
import type { Input } from '../core/Input';
import { aimBasis, type AimState } from '../player/Aim';
import { isGunDef, WEAPON_DEFS } from '../player/weapons/defs';
import type { WeaponDef } from '../player/weapons/defs/WeaponDef';
import type { WeaponAsset } from '../player/weapons/WeaponAssets';
import type { Purse } from './Purse';

export const ShopError = {
  CASH: 'NOT ENOUGH CASH',
  AMMO_FULL: 'AMMO FULL',
  OWNED: 'ALREADY OWNED',
} as const;

/** Ammo last reported for a carried gun. */
interface AmmoState {
  magazine: number;
  reserve: number;
}

/**
 * The weapon crate's shop. Looking at a built weapon crate within `config.weaponCrate.useRange`: a small copy of
 * the selected weapon turns slowly above the crate, the left and right arrows cycle through every weapon (cheapest first),
 * and E buys it, or refills it if it is already carried. Works in any phase. Pays through the purse (a failed
 * spend flashes the cash counter) and emits `weaponPurchased`, which the weapon manager answers by placing the
 * weapon by the slot rules. Learns the loadout, ammo and cash from events.
 */
export class WeaponShop {
  private selected = 0;
  private scroll = 0;
  private wantBuy = false;
  private cash = 0;
  private carried: readonly (string | null)[] = [];
  private readonly ammo = new Map<string, AmmoState>();
  private promptKey = '';
  /** The crate the last `interactDistance` found under the crosshair, or null. */
  private looked: Structure | null = null;

  private readonly display = new Object3D();
  private readonly models = new Map<string, Object3D>();
  private shown: Object3D | null = null;
  private spin = 0;

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

  constructor(
    scene: Scene,
    private readonly world: RAPIER.World,
    private readonly structures: StructureManager,
    private readonly assets: ReadonlyMap<string, WeaponAsset>,
    private readonly purse: Purse,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.display.name = 'weaponCrateDisplay';
    this.display.visible = false;
    scene.add(this.display);
    events.on('cashChanged', ({ cash }) => (this.cash = cash));
    events.on('loadoutChanged', ({ slots }) => (this.carried = slots));
    events.on('ammoChanged', ({ weapon, magazine, reserve }) => this.ammo.set(weapon, { magazine, reserve }));
  }

  /** Call once per rendered frame, before `input.endFrame()`. */
  handleInput(input: Input, enabled: boolean): void {
    if (!enabled) return;
    if (input.wasActionPressed('interact')) this.wantBuy = true;
    this.scroll += input.cycleSteps;
  }

  /** How far away a weapon crate is along the crosshair, in meters, or Infinity if none is in reach. */
  interactDistance(aim: AimState): number {
    aimBasis(aim.yaw, aim.pitch, this.forward, this.right, this.up);
    this.ray.origin = { x: aim.eye.x, y: aim.eye.y, z: aim.eye.z };
    this.ray.dir = { x: this.forward.x, y: this.forward.y, z: this.forward.z };
    const hit = this.world.castRay(this.ray, config.weaponCrate.useRange, true, undefined, Groups.bullet);
    const structure = hit ? this.structures.structureOf(hit.collider) : undefined;
    this.looked = structure instanceof WeaponCrate ? structure : null;
    return this.looked && hit ? hit.timeOfImpact : Infinity;
  }

  /** Pick, show and buy. `enabled` is whether the crate wins E this frame (see `interactDistance`). */
  update(dt: number, enabled: boolean): void {
    const crate = enabled && this.looked instanceof WeaponCrate && this.structures.byId(this.looked.id) ? this.looked : null;
    if (!crate) {
      this.hide();
      this.wantBuy = false;
      this.scroll = 0;
      return;
    }
    const count = WEAPON_DEFS.length;
    this.selected = (((this.selected + this.scroll) % count) + count) % count;
    this.scroll = 0;
    const def = WEAPON_DEFS[this.selected];
    this.showModel(def, crate, dt);

    const owned = this.carried.includes(def.id);
    const refill = owned && isGunDef(def);
    const cost = refill && isGunDef(def) ? def.refillPrice : def.price;
    const error = this.errorFor(def, owned, cost);
    this.setPrompt({ mode: 'weaponCrate', item: def.displayName, action: refill ? 'refill' : 'buy', cost, error });
    if (this.wantBuy) this.buy(def, refill, cost, error);
    this.wantBuy = false;
  }

  private errorFor(def: WeaponDef, owned: boolean, cost: number): string | null {
    if (owned && !isGunDef(def)) return ShopError.OWNED;
    if (owned && isGunDef(def)) {
      const ammo = this.ammo.get(def.id);
      if (ammo && ammo.magazine >= def.magazineSize && ammo.reserve >= def.reserveAmmo) return ShopError.AMMO_FULL;
    }
    return this.cash < cost ? ShopError.CASH : null;
  }

  private buy(def: WeaponDef, refill: boolean, cost: number, error: string | null): void {
    if (error === ShopError.OWNED || error === ShopError.AMMO_FULL) {
      this.events.emit('actionDenied', {});
      return;
    }
    // A failed spend reports `cashInsufficient` itself, which flashes the HUD cash.
    if (!this.purse.spend(cost, refill ? 'ammo' : 'weapon')) return;
    this.events.emit('weaponPurchased', { weapon: def.id, displayName: def.displayName, cost, refill });
  }

  /** The selected weapon turning above the crate. */
  private showModel(def: WeaponDef, crate: WeaponCrate, dt: number): void {
    const model = this.modelOf(def);
    if (model !== this.shown) {
      if (this.shown) this.shown.visible = false;
      model.visible = true;
      this.shown = model;
    }
    this.spin += dt * config.weaponCrate.displaySpin;
    crate.displayPoint(this.display.position);
    this.display.position.y += Math.sin(this.spin * 2.2) * 0.02;
    this.display.rotation.set(0, this.spin, 0);
    this.display.visible = true;
  }

  private hide(): void {
    this.display.visible = false;
    this.setPrompt({ mode: 'hidden' });
  }

  /** A copy of the weapon for the world, with its own material (the view model's is lit by a different scene). */
  private modelOf(def: WeaponDef): Object3D {
    let model = this.models.get(def.id);
    if (!model) {
      const asset = this.assets.get(def.view.model);
      if (!asset) throw new Error(`Weapon model "${def.view.model}" was not loaded`);
      const material = asset.material.clone();
      model = asset.root.clone();
      model.traverse((child) => {
        if ((child as Mesh).isMesh) (child as Mesh).material = material;
      });
      model.scale.setScalar(def.view.displayScale);
      this.display.add(model);
      this.models.set(def.id, model);
    }
    return model;
  }

  /** Emit the prompt only when what it says changes. */
  private setPrompt(prompt: ShopPromptEvent): void {
    const key = JSON.stringify(prompt);
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.events.emit('shopPromptChanged', prompt);
  }
}
