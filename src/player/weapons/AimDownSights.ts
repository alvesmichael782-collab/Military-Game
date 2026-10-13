import { MathUtils } from 'three';
import { config } from '../../core/config';
import type { EventBus, GameEvents } from '../../core/EventBus';
import type { Input } from '../../core/Input';
import { verticalFovFrom4x3 } from '../FPSCamera';
import type { AdsStats } from './defs/WeaponDef';

/** Seconds to ease back to the hip when no aim stats are known yet. */
const DEFAULT_TRANSITION = 0.2;
const TAN_HALF_HIP_FOV = Math.tan(MathUtils.degToRad(verticalFovFrom4x3(config.camera.fov)) / 2);

/**
 * Aim down sights: reads the aim key (hold or toggle, see `config.ads`), decides whether the player
 * may aim right now, and eases between the hip and the sights. The weapon's own `ads` values say
 * how far to zoom and how fast; everything else reads `amount`.
 *
 * Aiming is blocked while no gun is fully in hand (switching, the knife, building, repairing, plating, the MG),
 * while reloading and briefly after a grenade throw. In hold mode the aim comes back once the block ends
 * if the key is still held; in toggle mode a block cancels it. Sprint and aim cancel each other: the
 * most recent press wins, and a held aim key aims again when sprint is let go.
 */
export class AimDownSights {
  private wanted = false;
  private held = false;
  private pressed = false;
  /** Sprint was pressed while aiming; the aim stays down until sprint is let go or aim is pressed again. */
  private sprintOverride = false;
  private sprintWasHeld = false;
  private throwTimer = 0;
  private _aiming = false;
  /** Linear 0..1 through the transition; `amount` is the eased value. */
  private progress = 0;
  private _amount = 0;
  private _fov: number = config.camera.fov;
  private announcedAmount = -1;
  /** The last gun's aim stats, so the zoom eases out with them after it is put away. */
  private lastAds: AdsStats | null = null;

  constructor(private readonly events: EventBus<GameEvents>) {}

  /** True while the player is aiming (or raising the sights); false at the hip or lowering. */
  get aiming(): boolean {
    return this._aiming;
  }

  /** 0 at the hip, 1 fully aimed, eased. */
  get amount(): number {
    return this._amount;
  }

  /** Current horizontal field of view, in degrees at 4:3. */
  get fov(): number {
    return this._fov;
  }

  /** Look sensitivity multiplier: matches the zoom so a pixel of mouse moves the same distance on screen, times the config multiplier. */
  get lookScale(): number {
    const tanHalf = Math.tan(MathUtils.degToRad(verticalFovFrom4x3(this._fov)) / 2);
    return (tanHalf / TAN_HALF_HIP_FOV) * (1 + (config.ads.sensitivityMultiplier - 1) * this._amount);
  }

  /** Head bob multiplier for the camera. */
  get headBobScale(): number {
    return 1 + (config.ads.headBobScale - 1) * this._amount;
  }

  /**
   * Sample the aim key and settle whether the player is aiming. Call once per rendered frame, before `input.endFrame()`.
   * `blocked` is true while the weapon cannot be aimed (not in hand, reloading); `sprintHeld` is the raw sprint key.
   */
  handleInput(input: Input, active: boolean, blocked: boolean, sprintHeld: boolean): void {
    this.held = active && input.isActionDown('aim');
    this.pressed = active && input.wasActionPressed('aim');
    const sprintPressed = active && sprintHeld && !this.sprintWasHeld;
    this.sprintWasHeld = active && sprintHeld;
    const unavailable = !active || blocked;

    if (config.ads.toggle) {
      // A block or a sprint press cancels a toggled aim; presses while blocked do nothing.
      if (this.pressed && !unavailable) this.wanted = !this.wanted;
      if (unavailable || (sprintPressed && this.wanted)) this.wanted = false;
    } else {
      this.wanted = this.held;
      if (this.pressed) this.sprintOverride = false;
      if (sprintPressed && this.wanted) this.sprintOverride = true;
      if (!sprintHeld) this.sprintOverride = false;
    }

    const aiming = this.wanted && !unavailable && !this.sprintOverride && this.throwTimer <= 0;
    if (aiming !== this._aiming) {
      this._aiming = aiming;
      this.events.emit('adsChanged', { aiming });
    }
  }

  /** The weapon is going away (switching): drop the aim, including a toggled one. */
  drop(): void {
    this.wanted = false;
    if (this._aiming) {
      this._aiming = false;
      this.events.emit('adsChanged', { aiming: false });
    }
  }

  /** A grenade was thrown: drop the aim for a moment. */
  onThrow(): void {
    this.throwTimer = config.ads.throwDropTime;
    if (this._aiming) {
      this._aiming = false;
      this.events.emit('adsChanged', { aiming: false });
    }
  }

  /**
   * Ease toward the sights or the hip at the weapon's speed. Call once per rendered frame. `ads` is the weapon in
   * hand's aim stats, or null when nothing that can aim is in hand (it eases back to the hip).
   */
  update(dt: number, ads: AdsStats | null): void {
    this.throwTimer = Math.max(0, this.throwTimer - dt);
    if (ads) this.lastAds = ads;
    const step = dt / Math.max(this.lastAds?.transitionTime ?? DEFAULT_TRANSITION, 1e-3);
    this.progress = MathUtils.clamp(this.progress + (this._aiming && ads ? step : -step), 0, 1);
    this._amount = MathUtils.smoothstep(this.progress, 0, 1);
    this._fov = MathUtils.lerp(config.camera.fov, this.lastAds?.fov ?? config.camera.fov, this._amount);
    if (this._amount !== this.announcedAmount) {
      this.announcedAmount = this._amount;
      this.events.emit('adsProgress', { amount: this._amount, fov: this._fov });
    }
  }
}
