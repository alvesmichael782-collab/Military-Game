import { MathUtils, PerspectiveCamera, type Vector3 } from 'three';
import { config } from '../core/config';

/** What the camera needs to know about the body it rides on. */
export interface CameraBodyState {
  readonly horizontalSpeed: number;
  readonly grounded: boolean;
  readonly crouching: boolean;
  readonly sprinting: boolean;
  /** Footsteps taken, fractional; a foot comes down at each whole number (see `Gait`). */
  readonly steps: number;
}

/** How quickly head bob fades in and out (higher = faster). */
const BOB_FADE_SPEED = 10;
/** Below this speed the player counts as standing still for head bob, in m/s. */
const BOB_MIN_SPEED = 0.5;
/** Side-to-side sway as a fraction of the vertical bob. */
const BOB_SWAY_RATIO = 0.5;

/**
 * Converts a horizontal FOV measured at 4:3 into the vertical FOV Three.js expects.
 * Keeping vertical FOV fixed means wider screens see more at the sides, like classic shooters.
 */
export function verticalFovFrom4x3(horizontalDegrees: number): number {
  const half = MathUtils.degToRad(horizontalDegrees) / 2;
  return MathUtils.radToDeg(2 * Math.atan(Math.tan(half) * (3 / 4)));
}

/** Smoothing factor for an exponential approach at `speed` over `dt`. */
function smoothing(speed: number, dt: number): number {
  return 1 - Math.exp(-speed * dt);
}

/**
 * Mouse-look first-person camera with smooth crouch height and optional head bob.
 * Weapon recoil and screen shake are added on top of the mouse-look angles without changing them.
 */
export class FPSCamera {
  readonly camera: PerspectiveCamera;
  /** Heading in radians. 0 looks down -Z; positive turns left. */
  yaw: number;
  /** Look up/down in radians, clamped to the configured limit. */
  pitch = 0;

  private recoilPitch = 0;
  private recoilYaw = 0;
  private shakePitch = 0;
  private shakeYaw = 0;
  private shakeRoll = 0;

  private eyeHeight: number = config.player.standEyeHeight;
  private bobAmplitude = 0;
  /** Horizontal FOV in degrees at 4:3, as last set. */
  private fov: number = config.camera.fov;
  /** Scales the head bob, e.g. down while aiming down sights. */
  headBobScale = 1;

  constructor(initialYaw = 0) {
    this.yaw = initialYaw;
    this.camera = new PerspectiveCamera(
      verticalFovFrom4x3(config.camera.fov),
      window.innerWidth / window.innerHeight,
      0.05,
      1000,
    );
    this.camera.rotation.order = 'YXZ';
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Zoom to a horizontal field of view, in degrees at 4:3 (see `config.camera.fov`). */
  setFov(horizontalDegrees: number): void {
    if (horizontalDegrees === this.fov) return;
    this.fov = horizontalDegrees;
    this.camera.fov = verticalFovFrom4x3(horizontalDegrees);
    this.camera.updateProjectionMatrix();
  }

  /** Apply mouse movement, in pixels. `scale` multiplies the sensitivity, e.g. while zoomed in. */
  look(deltaX: number, deltaY: number, scale = 1): void {
    const sensitivity = config.camera.mouseSensitivity * scale;
    const limit = MathUtils.degToRad(config.camera.pitchLimitDegrees);
    this.yaw -= deltaX * sensitivity;
    this.pitch = MathUtils.clamp(this.pitch - deltaY * sensitivity, -limit, limit);
  }

  /** Place the camera at the body's eyes. Call once per rendered frame with the interpolated feet position. */
  update(frameDt: number, feet: Vector3, body: CameraBodyState): void {
    const p = config.player;
    const bob = config.camera.headBob;

    const targetEye = body.crouching ? p.crouchEyeHeight : p.standEyeHeight;
    this.eyeHeight += (targetEye - this.eyeHeight) * smoothing(config.camera.crouchTransitionSpeed, frameDt);

    const bobbing = bob.enabled && body.grounded && !body.crouching && body.horizontalSpeed > BOB_MIN_SPEED;
    const targetAmplitude = bobbing ? (body.sprinting ? bob.sprintAmplitude : bob.walkAmplitude) * this.headBobScale : 0;
    this.bobAmplitude += (targetAmplitude - this.bobAmplitude) * smoothing(BOB_FADE_SPEED, frameDt);

    // Lowest as each foot comes down, and one side-to-side sway per two steps.
    const phase = body.steps * Math.PI - Math.PI / 4;
    const bobY = Math.sin(phase * 2) * this.bobAmplitude;
    const sway = Math.sin(phase) * this.bobAmplitude * BOB_SWAY_RATIO;

    this.camera.position.set(
      feet.x + Math.cos(this.yaw) * sway,
      feet.y + this.eyeHeight + bobY,
      feet.z - Math.sin(this.yaw) * sway,
    );
    this.applyRotation();
  }

  /** Place the camera at `eye` with no head bob, e.g. behind a mounted gun. Call instead of `update`. */
  placeAt(eye: Vector3): void {
    this.bobAmplitude = 0;
    this.camera.position.copy(eye);
    this.applyRotation();
  }

  /** View kick from the weapon, in radians. Applied immediately. */
  setRecoil(pitch: number, yaw: number): void {
    this.recoilPitch = pitch;
    this.recoilYaw = yaw;
    this.applyRotation();
  }

  /** Screen shake offsets, in radians. Applied immediately. */
  setShake(pitch: number, yaw: number, roll: number): void {
    this.shakePitch = pitch;
    this.shakeYaw = yaw;
    this.shakeRoll = roll;
    this.applyRotation();
  }

  private applyRotation(): void {
    // Never tip past straight up or down, or the view flips over.
    const maxPitch = Math.PI / 2 - 0.01;
    this.camera.rotation.set(
      MathUtils.clamp(this.pitch + this.recoilPitch + this.shakePitch, -maxPitch, maxPitch),
      this.yaw + this.recoilYaw + this.shakeYaw,
      this.shakeRoll,
    );
  }
}
