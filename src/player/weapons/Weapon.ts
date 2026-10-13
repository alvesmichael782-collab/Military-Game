import type { EventBus, GameEvents } from '../../core/EventBus';
import type { AimState } from '../Aim';
import { fireInterval, type GunDef, type WeaponSounds } from './defs/WeaponDef';
import type { HeldWeapon } from './HeldWeapon';

/**
 * Base for magazine-fed guns: ammo, reloading, fire rate and trigger handling for semi-auto, full auto and burst.
 * Subclasses decide what a shot does (`fire`), and report their spread and recoil.
 */
export abstract class Weapon implements HeldWeapon {
  private _magazine: number;
  private _reserve: number;
  private reloadTimer = 0;
  private reloadDuration = 0;
  private _reloadFromEmpty = false;
  /** Set once this reload's new magazine has seated and the ammo is in. */
  private reloadLoaded = false;
  private cooldown = 0;
  private triggerHeld = false;
  /** Set once the current trigger pull has fired its share (one round semi-auto, a burst in burst mode). */
  private triggerSpent = false;
  /** Set once the current trigger pull has clicked on an empty magazine, so it clicks only once. */
  private dryClicked = false;
  /** Shots fired since the trigger was pulled. */
  private pullShots = 0;
  /** 0 at the hip, 1 fully aimed down the sights (eased). */
  protected aimAmount = 0;
  /** Payload for the weapon events that carry only the weapon. */
  protected readonly event: { readonly weapon: string; readonly sounds: WeaponSounds };
  private readonly interval: number;

  constructor(
    readonly def: GunDef,
    protected readonly events: EventBus<GameEvents>,
  ) {
    this._magazine = def.magazineSize;
    this._reserve = def.reserveAmmo;
    this.event = { weapon: def.id, sounds: def.sounds };
    this.interval = fireInterval(def);
  }

  abstract get spread(): number;
  abstract get recoilPitch(): number;
  abstract get recoilYaw(): number;

  /** Fire one round. Ammo has already been taken. */
  protected abstract fire(aim: AimState): void;
  /** Per-frame upkeep (spread, recoil recovery). Runs before any shots this frame. */
  protected abstract tick(dt: number, aim: AimState): void;

  get magazine(): number {
    return this._magazine;
  }

  get reserve(): number {
    return this._reserve;
  }

  get isReloading(): boolean {
    return this.reloadTimer > 0;
  }

  /** The current (or last) reload started with an empty magazine, so it ends by chambering a round. */
  get reloadFromEmpty(): boolean {
    return this._reloadFromEmpty;
  }

  /** True while the trigger is held and the weapon can shoot. */
  get isFiring(): boolean {
    return this.triggerHeld && !this.isReloading && this._magazine > 0 && this.canShootThisPull();
  }

  get reloadElapsed(): number {
    return this.isReloading ? this.reloadDuration - this.reloadTimer : -1;
  }

  setTrigger(held: boolean): void {
    if (!held) {
      this.triggerSpent = false;
      this.dryClicked = false;
      this.endBurst();
    }
    this.triggerHeld = held;
  }

  setAimAmount(amount: number): void {
    this.aimAmount = amount;
  }

  /** Scale from the hip value (1) toward a fully aimed multiplier, by how far the weapon is aimed. */
  protected aimScale(multiplier: number): number {
    return 1 + (multiplier - 1) * this.aimAmount;
  }

  reload(): boolean {
    if (this.isReloading || this._magazine >= this.def.magazineSize || this._reserve <= 0) return false;
    const r = this.def.reload;
    this._reloadFromEmpty = this._magazine === 0;
    this.reloadDuration = r.time + (r.kind === 'magazine' && this._reloadFromEmpty ? r.emptyExtra : 0);
    this.reloadTimer = this.reloadDuration;
    this.reloadLoaded = false;
    this.events.emit('weaponReloadStarted', this.event);
    return true;
  }

  /** Abandon a reload in progress; the magazine stays as it was. */
  cancelReload(): void {
    if (!this.isReloading) return;
    this.reloadTimer = 0;
    this.events.emit('weaponReloadCancelled', this.event);
  }

  putAway(): void {
    this.setTrigger(false);
    this.cancelReload();
  }

  /** Full magazine and reserve, as bought at the weapon crate (or the debug refill). */
  refill(): void {
    this.cancelReload();
    this._magazine = this.def.magazineSize;
    this._reserve = this.def.reserveAmmo;
    this.announce();
  }

  announce(): void {
    this.events.emit('ammoChanged', {
      weapon: this.def.id,
      displayName: this.def.displayName,
      magazine: this._magazine,
      magazineSize: this.def.magazineSize,
      reserve: this._reserve,
    });
  }

  update(dt: number, aim: AimState): void {
    if (this.isReloading) {
      this.reloadTimer -= dt;
      // The ammo goes in when the new magazine seats; the rest of the reload is the gun coming back up.
      if (!this.reloadLoaded && this.reloadElapsed >= this.def.reload.seatTime) this.loadMagazine();
      if (this.reloadTimer <= 0) this.finishReload();
    }
    this.tick(dt, aim);

    // The cooldown carries over between frames so the fire rate stays exact at any frame rate.
    this.cooldown -= dt;
    if (this.triggerHeld && !this.isReloading) this.pullTrigger(aim);
    if (this.cooldown < 0) this.cooldown = 0;
  }

  private canShootThisPull(): boolean {
    if (this.def.fireMode === 'auto') return true;
    if (this.def.fireMode === 'semi') return !this.triggerSpent;
    return this.pullShots < (this.def.burstCount ?? 3);
  }

  private pullTrigger(aim: AimState): void {
    while (this.cooldown <= 0) {
      if (this._magazine <= 0) {
        // One click per trigger pull, then reload if there is anything to load.
        if (!this.dryClicked) {
          this.dryClicked = true;
          this.events.emit('weaponDryFired', this.event);
          this.reload();
        }
        return;
      }
      if (!this.canShootThisPull()) {
        this.triggerSpent = true;
        return;
      }

      this._magazine--;
      this.pullShots++;
      if (this.def.fireMode === 'semi') this.triggerSpent = true;
      this.fire(aim);
      this.announce();
      this.cooldown += this.interval;
      if (this._magazine === 0) this.endBurst();
    }
  }

  private endBurst(): void {
    if (this.pullShots === 0) return;
    this.pullShots = 0;
    this.events.emit('weaponBurstEnded', this.event);
  }

  private finishReload(): void {
    this.reloadTimer = 0;
    if (!this.reloadLoaded) this.loadMagazine();
  }

  private loadMagazine(): void {
    this.reloadLoaded = true;
    const loaded = Math.min(this.def.magazineSize - this._magazine, this._reserve);
    this._magazine += loaded;
    this._reserve -= loaded;
    this.announce();
  }
}
