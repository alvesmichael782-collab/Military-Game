import { Color, DirectionalLight, Fog, HemisphereLight, Vector3, type Scene } from 'three';
import { config } from '../core/config';

/** Where the sun is: high in the south-east, behind the player's shoulder at the start, about 47 degrees up. */
export const SUN_DIRECTION = new Vector3(70, 90, 45).normalize();
/** Warm haze at the horizon. The fog and the bottom of the sky dome share it, so distant ground melts into the sky. */
export const HORIZON_COLOR = 0xe9d6b2;

const SUN_COLOR = 0xffe4b8;
const SUN_INTENSITY = 2.9;
/** Ambient: cool blue from the sky above, warm bounce from the sand below. Kept low so shaded sides read clearly. */
const SKY_AMBIENT = 0xaab8d0;
const GROUND_AMBIENT = 0x9a7a52;
const AMBIENT_INTENSITY = 1.05;
const SHADOW_MAP_SIZE = 2048;
const SUN_DISTANCE = 160;
const FOG_NEAR = 110;
const FOG_FAR = 760;

/** One strong warm sun with hard shadows over the whole map, a cool sky fill, and light warm distance fog. */
export function createLighting(scene: Scene): DirectionalLight {
  scene.background = new Color(HORIZON_COLOR);
  scene.fog = new Fog(HORIZON_COLOR, FOG_NEAR, FOG_FAR);

  scene.add(new HemisphereLight(SKY_AMBIENT, GROUND_AMBIENT, AMBIENT_INTENSITY));

  const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;

  // Orthographic shadow frustum covering the whole map, about 11 cm per shadow texel.
  const half = config.map.size / 2 + 12;
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -half;
  shadowCam.right = half;
  shadowCam.top = half;
  shadowCam.bottom = -half;
  shadowCam.near = 10;
  shadowCam.far = 340;
  shadowCam.updateProjectionMatrix();
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;

  scene.add(sun);
  scene.add(sun.target);
  return sun;
}
