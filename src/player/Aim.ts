import type { Vector3 } from 'three';
import type { CameraBodyState } from './FPSCamera';

/** Where the player is looking from and toward, plus how their body is moving. Sampled once per rendered frame. */
export interface AimState {
  /** Camera position. */
  readonly eye: Vector3;
  /** Mouse-look heading and pitch in radians, before recoil. See `FPSCamera`. */
  readonly yaw: number;
  readonly pitch: number;
  readonly body: CameraBodyState;
  /** Player velocity, in m/s. */
  readonly velocity: Readonly<Vector3>;
}

/**
 * Camera-space axes for a heading and pitch (yaw 0 looks down -Z, positive yaw turns left).
 * Matches the FPS camera's YXZ rotation order.
 */
export function aimBasis(yaw: number, pitch: number, forward: Vector3, right: Vector3, up: Vector3): void {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  forward.set(-sy * cp, sp, -cy * cp);
  right.set(cy, 0, -sy);
  up.set(sy * sp, cp, cy * sp);
}
