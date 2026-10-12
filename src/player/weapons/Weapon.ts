import type { EventBus, GameEvents } from '../../core/EventBus';
import type { AimState } from '../Aim';

/**
 * A weapon's sounds, as sound bank ids (see core/audio/sounds.ts). A new gun only needs its own set here
 * plus its bank entries; the combat sounds play them from the weapon events.
 */
export interface WeaponSoundSet {
  /** One shot. */
  readonly fire: string;
  /** The burst's last shot and its echo, played when a burst ends. */
  readonly fireTail: string;
  readonly reload: string;
  /** Trigger pulled on an empty magazine. Without it the shared `weapon.dryFire` click plays. */
  readonly dryFire?: string;
  /** Weapon brought out. */
  readonly equip?: string;
}

interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * How a weapon aims down its sights. Every value belongs to the weapon, so a new gun only needs its own set.
 * The multipliers apply in full when fully aimed and blend in over the transition.
 */
export interface WeaponAdsStats {
  /** View model position (meters) and rotation (radians) when fully aimed, so the sights sit on the screen center. */
  readonly viewPosition: Vec3Like;
  readonly viewRotation: Vec3Like;
  /** Horizontal field of view when fully aimed, in degrees at 4:3. */
  readonly fov: number;
  /** Seconds from the hip to fully aimed, and back. */
  readonly transitionTime: number;
  readonly spreadMultiplier: number;
  readonly recoilMultiplier: number;
  readonly moveSpeedMultiplier: number;
  /** View model mouse sway and walking bob. */
  readonly swayMultiplier: number;
  readonly bobMultiplier: number;
  /** Muzzle position relative to the eye when fully aimed, in meters (forward, right, down). */
  readonly muzzle: { readonly forward: number; readonly right: number; readonly down: number };
}

/**
 * A weapon's procedural reload animation, timed to its reload sound. Times in seconds from the start of the
 * reload, angles in degrees, distances in meters in view model space. Each gun carries its own set.
 */
export interface WeaponReloadAnimation {
  /** Tilt, roll and dip toward the player, reached at `tiltEnd`. */
  readonly tiltEnd: number;
  readonly tiltPitch: number;
  readonly tiltYaw: number;
  readonly tiltRoll: number;
  readonly tiltDip: number;
  /** The magazine drops out (initial speed in m/s, gravity in m/s^2) and is hidden after falling `dropDistance`. */
  readonly releaseTime: number;
  readonly dropSpeed: number;
  readonly dropGravity: number;
  readonly dropDistance: number;
  /** A fresh magazine rises from `newMagDepth` to `insertDepth` below the well, tipped by `newMagTilt`. */
  readonly newMagStart: number;
  readonly newMagEnd: number;
  readonly newMagDepth: number;
  readonly insertDepth: number;
  readonly newMagTilt: number;
  /** Slides into the well from `insertTime`; seats at `seatTime`, which is when the ammo goes in. */
  readonly insertTime: number;
  readonly seatTime: number;
  readonly seatBump: number;
  readonly seatJoltLift: number;
  readonly seatJoltPitch: number;
  readonly seatJoltTime: number;
  /** Back to the normal pose, with an overshoot that settles (0 for none). */
  readonly returnStart: number;
  readonly returnEnd: number;
  readonly settleOvershoot: number;
  /**
   * The left hand: leaves the handguard at `handReachStart` and reaches the magazine as it is released, holds it
   * (down with the old one, up with the new one) until `handReturnStart`, and is back on the handguard at `handReturnEnd`.
   */
  readonly handReachStart: number;
  readonly handReturnStart: number;
  readonly handReturnEnd: number;
}

export interface WeaponStats {
  /** Internal id. */
  readonly name: string;
  /** Name shown on the HUD. */
  readonly displayName: string;
  readonly magazineSize: number;
  readonly reserveAmmo: number;
  /** Seconds between shots. */
  readonly fireInterval: number;
  readonly reloadTime: number;
  readonly reloadAnimation: WeaponReloadAnimation;
  /** Keeps firing while the trigger is held. */
  readonly automatic: boolean;
  readonly sounds: WeaponSoundSet;
  readonly ads: WeaponAdsStats;
}

/**
 * Base for magazine-fed weapons: ammo, reloading, fire rate and trigger handling.
 * Subclasses decide what a shot does (`fire`), and report their spread and recoil.
 */
export abstract class Weapon {
  private _magazine: number;
  private _reserve: number;
  private reloadTimer = 0;
  /** Set once this reload's new magazine has seated and the ammo is in. */
  private reloadLoaded = false;
  private cooldown = 0;
  private triggerHeld = false;
  /** Set once the current trigger pull has fired, for semi-auto. */
  private triggerSpent = false;
  /** Set once the current trigger pull has clicked on an empty magazine, so it clicks only once. */
  private dryClicked = false;
  /** Shots fired since the trigger was pulled. */
  private burstShots = 0;
  /** 0 at the hip, 1 fully aimed down the sights (eased). */
  protected aimAmount = 0;
  /** Payload for the weapon events that carry only the weapon. */
  private readonly event: { readonly weapon: string; readonly sounds: WeaponSoundSet };

  constructor(
    readonly stats: WeaponStats,
    protected readonly events: EventBus<GameEvents>,
  ) {
    this._magazine = stats.magazineSize;
    this._reserve = stats.reserveAmmo;
    this.event = { weapon: stats.name, sounds: stats.sounds };
  }

  /** Current inaccuracy as a cone half-angle, in radians. */
  abstract get spread(): number;
  /** View kick from recoil, in radians. Positive pitch is up, positive yaw is left. */
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

  /** True while the trigger is held and the weapon can shoot. */
  get isFiring(): boolean {
    return (
      this.triggerHeld && !this.isReloading && this._magazine > 0 && (this.stats.automatic || !this.triggerSpent)
    );
  }

  /** Seconds since the reload started, or -1 when not reloading. */
  get reloadElapsed(): number {
    return this.isReloading ? this.stats.reloadTime - this.reloadTimer : -1;
  }

  setTrigger(held: boolean): void {
    if (!held) {
      this.triggerSpent = false;
      this.dryClicked = false;
      this.endBurst();
    }
    this.triggerHeld = held;
  }

  /** How far the weapon is aimed down its sights: 0 at the hip, 1 fully aimed. */
  setAimAmount(amount: number): void {
    this.aimAmount = amount;
  }

  /** Scale from the hip value (1) toward a fully aimed multiplier, by how far the weapon is aimed. */
  protected aimScale(multiplier: number): number {
    return 1 + (multiplier - 1) * this.aimAmount;
  }

  /** Start a reload if it would add ammo. Returns true if a reload started. */
  reload(): boolean {
    if (this.isReloading || this._magazine >= this.stats.magazineSize || this._reserve <= 0) return false;
    this.reloadTimer = this.stats.reloadTime;
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

  /** Announce that the weapon was brought out. */
  equip(): void {
    this.events.emit('weaponEquipped', this.event);
  }

  /** Debug: full magazine and reserve. */
  refill(): void {
    this.cancelReload();
    this._magazine = this.stats.magazineSize;
    this._reserve = this.stats.reserveAmmo;
    this.announce();
  }

  /** Emit the current ammo, e.g. so a freshly built HUD can draw it. */
  announce(): void {
    this.events.emit('ammoChanged', {
      weapon: this.stats.name,
      displayName: this.stats.displayName,
      magazine: this._magazine,
      magazineSize: this.stats.magazineSize,
      reserve: this._reserve,
    });
  }

  /** Advance timers and fire if the trigger is held. Call once per rendered frame. */
  update(dt: number, aim: AimState): void {
    if (this.isReloading) {
      this.reloadTimer -= dt;
      // The ammo goes in when the new magazine seats; the rest of the reload is the rifle coming back up.
      if (!this.reloadLoaded && this.reloadElapsed >= this.stats.reloadAnimation.seatTime) this.loadMagazine();
      if (this.reloadTimer <= 0) this.finishReload();
    }
    this.tick(dt, aim);

    // The cooldown carries over between frames so the fire rate stays exact at any frame rate.
    this.cooldown -= dt;
    if (this.triggerHeld && !this.isReloading) this.pullTrigger(aim);
    if (this.cooldown < 0) this.cooldown = 0;
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
      if (!this.stats.automatic && this.triggerSpent) return;

      this._magazine--;
      this.triggerSpent = true;
      this.burstShots++;
      this.fire(aim);
      this.announce();
      this.cooldown += this.stats.fireInterval;
      if (this._magazine === 0) this.endBurst();
    }
  }

  private endBurst(): void {
    if (this.burstShots === 0) return;
    this.burstShots = 0;
    this.events.emit('weaponBurstEnded', this.event);
  }

  private finishReload(): void {
    this.reloadTimer = 0;
    if (!this.reloadLoaded) this.loadMagazine();
  }

  private loadMagazine(): void {
    this.reloadLoaded = true;
    const loaded = Math.min(this.stats.magazineSize - this._magazine, this._reserve);
    this._magazine += loaded;
    this._reserve -= loaded;
    this.announce();
  }
}
