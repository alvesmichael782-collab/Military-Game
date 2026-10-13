import { Euler, Vector3 } from 'three';
import type { AdsStats } from './defs/WeaponDef';

/** Where the view model sits when fully aimed: position in the weapon camera's space, and rotation (XYZ, no roll). */
export interface AdsPose {
  readonly position: Vector3;
  readonly rotation: Euler;
}

/**
 * The aimed pose that lines a gun's sights up on the screen center: the line from the rear sight through the
 * front sight runs straight down the camera's view (-Z), with the rear sight `eyeRelief` meters in front of the eye.
 * Pitch and yaw only, so the gun stays upright.
 */
export function adsPoseOf(ads: AdsStats): AdsPose {
  const rear = new Vector3(ads.rearSight.x, ads.rearSight.y, ads.rearSight.z);
  const line = new Vector3(ads.frontSight.x, ads.frontSight.y, ads.frontSight.z).sub(rear).normalize();
  // Yaw first (about Y) takes the sideways part out, then pitch (about X) the vertical part.
  const yaw = Math.atan2(line.x, -line.z);
  const turned = line.clone().applyEuler(new Euler(0, yaw, 0));
  const pitch = Math.atan2(-turned.y, -turned.z);
  const rotation = new Euler(pitch, yaw, 0, 'XYZ');
  const position = new Vector3(0, 0, -ads.eyeRelief).sub(rear.applyEuler(rotation));
  return { position, rotation };
}
