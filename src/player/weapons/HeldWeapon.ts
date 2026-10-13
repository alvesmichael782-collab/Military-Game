import type { AimState } from '../Aim';
import type { WeaponDef } from './defs/WeaponDef';

/** What the weapon manager needs from anything the player can hold: a gun or a melee weapon. */
export interface HeldWeapon {
  readonly def: WeaponDef;
  /** Current inaccuracy as a cone half-angle, in radians (0 for melee). */
  readonly spread: number;
  /** View kick from recoil, in radians. Positive pitch is up, positive yaw is left. */
  readonly recoilPitch: number;
  readonly recoilYaw: number;
  /** Seconds since the reload started, or -1 when not reloading. */
  readonly reloadElapsed: number;
  readonly isReloading: boolean;
  setTrigger(held: boolean): void;
  /** 0 at the hip, 1 fully aimed down the sights. */
  setAimAmount(amount: number): void;
  /** Start a reload if it would add ammo. Returns true if one started. */
  reload(): boolean;
  /** Put away mid-action: the trigger is let go, a reload or attack is abandoned, recoil settles. */
  putAway(): void;
  /** Advance timers and act on the trigger. Call once per rendered frame while it is in hand. */
  update(dt: number, aim: AimState): void;
  /** Emit its ammo for the HUD (nothing for melee). */
  announce(): void;
  /** Full magazine and reserve (no-op for melee). */
  refill(): void;
}
