import type RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Vector3 } from 'three';
import type { DamageableRegistry } from '../../combat/DamageableRegistry';
import { config } from '../../core/config';
import type { EventBus, GameEvents } from '../../core/EventBus';
import type { Input } from '../../core/Input';
import type { AimState } from '../Aim';
import { verticalFovFrom4x3 } from '../FPSCamera';
import { AimDownSights } from './AimDownSights';
import { isGunDef, weaponDef } from './defs';
import type { WeaponDef } from './defs/WeaponDef';
import { Gun } from './Gun';
import type { HeldWeapon } from './HeldWeapon';
import { Knife } from './Knife';
import { Loadout } from './Loadout';
import { VIEW_FOV, ViewModel } from './ViewModel';
import type { WeaponAsset } from './WeaponAssets';

/** Where the weapon in hand is in its put-away / bring-out cycle. */
type Motion = 'ready' | 'holstering' | 'down' | 'drawing';

const SLOT_KEYS = ['slot1', 'slot2', 'slot3'] as const;
const TAN_HALF_VIEW_FOV = Math.tan(MathUtils.degToRad(VIEW_FOV) / 2);

/**
 * The weapons in the player's hands. Owns the loadout (see `Loadout` for the slot rules), switches between slots
 * (keys from `config.keybinds`) by putting the current weapon away and drawing the next, routes fire, reload and
 * aim input to the weapon in hand, and drives the view model.
 *
 * Weapons are only usable once fully drawn. Switching cancels any reload and drops the aim. Building, repairing
 * and the MG put the weapon away; switching is not allowed then, nor while plating. Purchases arrive as
 * `weaponPurchased` events from the weapon crate. Emits `weaponEquipped` as each weapon comes out.
 */
export class WeaponManager {
  readonly loadout: Loadout;
  readonly viewModel: ViewModel;
  readonly ads: AimDownSights;
  /** The weapon being drawn, in hand or being put away. */
  private inHand: HeldWeapon | null = null;
  private motion: Motion = 'down';
  /** 0 in hand, 1 put away. */
  private lower = 1;
  private building = false;
  private repairing = false;
  private mounted = false;
  private readonly muzzle = new Vector3();

  constructor(
    private readonly events: EventBus<GameEvents>,
    world: RAPIER.World,
    registry: DamageableRegistry,
    assets: ReadonlyMap<string, WeaponAsset>,
  ) {
    this.loadout = new Loadout(
      (def: WeaponDef) => (isGunDef(def) ? new Gun(def, events, world, registry) : new Knife(def, events, world, registry)),
      events,
    );
    this.viewModel = new ViewModel(assets);
    this.ads = new AimDownSights(events);
    this.loadout.acquire(weaponDef(config.weapons.startingWeapon));

    events.on('weaponFired', ({ weapon, kickUp, kickSide }) => {
      if (weapon === this.inHand?.def.id) this.viewModel.onFire(kickUp, kickSide);
    });
    events.on('weaponDryFired', () => this.viewModel.onDryFire());
    events.on('weaponPurchased', ({ weapon }) => this.loadout.acquire(weaponDef(weapon)));
    events.on('buildToolChanged', ({ active }) => (this.building = active));
    events.on('repairStarted', () => (this.repairing = true));
    events.on('repairStopped', () => (this.repairing = false));
    events.on('mgMounted', () => (this.mounted = true));
    events.on('mgDismounted', () => (this.mounted = false));
  }

  /** The weapon in hand (or coming out, or going away), or null. */
  get equipped(): HeldWeapon | null {
    return this.inHand;
  }

  /** Emit the loadout and the weapon in hand, e.g. so a freshly built HUD can draw them. */
  announce(): void {
    this.loadout.announce();
    this.inHand?.announce();
  }

  /** Debug: refill every gun carried. */
  refillAll(): void {
    for (const w of this.loadout.weapons) w.refill();
    this.inHand?.announce();
  }

  /**
   * Call once per rendered frame, before `input.endFrame()`. `active` is false whenever the weapon cannot be used
   * or switched (no control, plating, building, repairing, mounted); `sprintHeld` is the raw sprint key, which
   * cancels the aim.
   */
  handleInput(input: Input, active: boolean, sprintHeld: boolean): void {
    if (active) {
      for (let i = 0; i < SLOT_KEYS.length; i++) if (input.wasActionPressed(SLOT_KEYS[i])) this.loadout.select(i);
    }
    const ready = this.motion === 'ready' && this.inHand !== null;
    const weapon = this.inHand;
    weapon?.setTrigger(active && ready && input.isDown('Mouse0'));
    if (active && ready && input.wasPressed('KeyR')) weapon?.reload();
    const gun = weapon instanceof Gun ? weapon : null;
    // Only a gun that is fully out can aim, and not while it reloads.
    this.ads.handleInput(input, active && ready && gun !== null, gun?.isReloading ?? false, sprintHeld);
  }

  /** A grenade was thrown: dip the weapon and drop the aim for a moment. */
  onThrow(): void {
    this.viewModel.onThrow();
    this.ads.onThrow();
  }

  /** Top speed multiplier for the weapon in hand, with aiming. */
  get moveSpeedScale(): number {
    const def = this.inHand?.def;
    if (!def) return 1;
    const aimed = isGunDef(def) ? 1 + (def.ads.moveSpeedMultiplier - 1) * this.ads.amount : 1;
    return def.moveSpeedMultiplier * aimed;
  }

  /** View recoil of the weapon in hand, in radians. */
  get recoilPitch(): number {
    return this.inHand?.recoilPitch ?? 0;
  }

  get recoilYaw(): number {
    return this.inHand?.recoilYaw ?? 0;
  }

  /** Switch, aim, fire, reload and animate. `lookX`/`lookY` are this frame's mouse movement, for view model sway. */
  update(dt: number, aim: AimState, lookX: number, lookY: number): void {
    this.updateMotion(dt);
    const weapon = this.inHand;
    const def = weapon?.def;
    if (def && isGunDef(def)) this.ads.update(dt, def.ads);
    else this.ads.update(dt, null);
    if (weapon) {
      weapon.setAimAmount(this.ads.amount);
      if (weapon instanceof Gun) this.feedMuzzle(weapon);
      weapon.update(dt, aim);
    }
    this.viewModel.update(
      dt,
      { body: aim.body, lookX, lookY, aim: this.ads.amount, lower: this.lower, drawing: this.motion === 'drawing' },
      weapon,
    );
  }

  /**
   * Put away whatever should not be in hand and bring out what should: the loadout's choice, or nothing while
   * building, repairing or on the MG (which hides the weapon at once, as the view jumps to the gun).
   */
  private updateMotion(dt: number): void {
    const wanted = this.building || this.repairing || this.mounted ? null : this.loadout.selected;
    if (this.mounted && this.motion !== 'down') {
      this.putAway();
      this.lower = 1;
      this.motion = 'down';
      this.inHand = null;
      this.viewModel.show(null);
    }
    if (this.inHand !== wanted && (this.motion === 'ready' || this.motion === 'drawing')) {
      this.putAway();
      this.motion = 'holstering';
    }
    if (this.motion === 'holstering') {
      const time = this.inHand?.def.view.holsterTime ?? 0.2;
      this.lower = Math.min(1, this.lower + dt / time);
      if (this.lower >= 1) {
        this.motion = 'down';
        this.inHand = null;
        this.viewModel.show(null);
      }
    }
    if (this.motion === 'down' && wanted) this.draw(wanted);
    if (this.motion === 'drawing' && this.inHand) {
      this.lower = Math.max(0, this.lower - dt / this.inHand.def.view.drawTime);
      if (this.lower <= 0) this.motion = 'ready';
    }
  }

  private draw(weapon: HeldWeapon): void {
    this.inHand = weapon;
    this.motion = 'drawing';
    this.lower = 1;
    this.viewModel.show(weapon);
    const def = weapon.def;
    this.events.emit('weaponEquipped', {
      weapon: def.id,
      displayName: def.displayName,
      kind: def.slot,
      slot: this.loadout.current,
      sounds: def.sounds,
    });
    weapon.announce();
    // The crosshair takes this weapon's spread from now on (the gun reports changes as they happen).
    this.events.emit('weaponSpreadChanged', { spread: weapon.spread });
  }

  /** Stop what the weapon in hand is doing and drop the aim, as it goes away. */
  private putAway(): void {
    this.inHand?.putAway();
    this.ads.drop();
  }

  /** Tell the gun where its muzzle is as the player sees it, for the muzzle light and tracers. */
  private feedMuzzle(gun: Gun): void {
    const worldTanHalf = Math.tan(MathUtils.degToRad(verticalFovFrom4x3(this.ads.fov)) / 2);
    if (this.viewModel.muzzleOffset(this.ads.amount, worldTanHalf / TAN_HALF_VIEW_FOV, this.muzzle)) gun.muzzleOffset.copy(this.muzzle);
  }
}
