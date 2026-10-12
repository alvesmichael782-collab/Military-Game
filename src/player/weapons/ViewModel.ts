import {
  AdditiveBlending,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { createMuzzleFlashTexture } from '../../combat/EffectTextures';
import { config } from '../../core/config';
import type { CameraBodyState } from '../FPSCamera';
import { sampleLeftHand, sampleReload, type ReloadPose } from './ReloadAnimation';
import type { RifleView } from './RifleAsset';
import { ViewHands } from './ViewHands';
import type { WeaponStats } from './Weapon';

/** Vertical field of view of the weapon camera, in degrees. Narrower than the world camera so the gun is not stretched. */
const VIEW_FOV = 54;
/** Resting position of the rifle in front of the camera (bottom right), in meters. */
const REST = { x: 0.13, y: -0.135, z: -0.45 };
/** Slight inward angle so the barrel points toward the crosshair, in radians. */
const REST_YAW = 0.03;
const MUZZLE_FLASH_SIZE = 0.26;
const MUZZLE_LIGHT_INTENSITY = 3;

const smoothing = (speed: number, dt: number): number => 1 - Math.exp(-speed * dt);
const lerp = MathUtils.lerp;

/**
 * The first-person rifle. It lives in its own scene and is drawn after the world with a cleared
 * depth buffer, so it never clips into walls. Animates recoil kick, the reload (rifle and magazine), throw dip,
 * movement bob, mouse sway, raising the sights to the eye and the muzzle flash.
 */
export class ViewModel {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly pivot = new Object3D();
  private readonly magazine: Object3D;
  /** The magazine's seated position in the rifle model. */
  private readonly magazineRest: Vector3;
  private readonly reloadPose: ReloadPose = {
    pitch: 0,
    yaw: 0,
    roll: 0,
    lift: 0,
    magDepth: 0,
    magTilt: 0,
    magVisible: true,
  };
  private readonly hands: ViewHands;
  /** Where the left hand finds the magazine; held at the bottom of its fall while the old one is out of view. */
  private readonly handMagazine = new Vector3();
  private readonly flash: Sprite;
  private readonly flashLight: PointLight;

  private kick = 0;
  private kickRoll = 0;
  private throwDip = 0;
  private flashTimer = 0;
  private bobWeight = 0;
  private sprintWeight = 0;
  private sinceFire = Infinity;
  private swayX = 0;
  private swayY = 0;
  /** 0 rifle up, 1 lowered out of view (build tool out). */
  private holster = 0;
  private holstered = false;

  constructor(rifleView: RifleView) {
    this.camera = new PerspectiveCamera(VIEW_FOV, window.innerWidth / window.innerHeight, 0.01, 5);

    // Lighting roughly matches the desert sun and sky, fixed relative to the view.
    this.scene.add(new HemisphereLight(0xfff3df, 0x8a6a45, 1.3));
    const sun = new DirectionalLight(0xfff1d6, 1.8);
    sun.position.set(0.6, 1, 0.4);
    this.scene.add(sun);

    const rifle = rifleView.model;
    const muzzle = rifleView.muzzle;
    this.magazine = rifleView.magazine;
    this.magazineRest = this.magazine.position.clone();
    this.pivot.add(rifle);
    this.scene.add(this.pivot);
    this.hands = new ViewHands(rifle);

    const flashMaterial = new SpriteMaterial({
      map: createMuzzleFlashTexture(),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.flash = new Sprite(flashMaterial);
    this.flash.position.copy(muzzle).setZ(muzzle.z - 0.04);
    this.flash.visible = false;
    rifle.add(this.flash);

    // Stays in the scene at zero intensity so the light count never changes.
    this.flashLight = new PointLight(0xffc070, 0, 1.5, 2);
    this.flashLight.position.copy(muzzle);
    rifle.add(this.flashLight);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** A shot left the barrel. */
  onFire(): void {
    this.kick = 1;
    this.sinceFire = 0;
    this.kickRoll = (Math.random() - 0.5) * 2;
    this.flashTimer = config.rifle.viewModel.muzzleFlashTime;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(MUZZLE_FLASH_SIZE * (0.8 + Math.random() * 0.4));
  }

  /**
   * Lower the rifle out of view (true) or raise it back (false), e.g. while the build tool is out.
   * `instant` puts it away at once, with no lowering, e.g. when the view jumps to a mounted gun.
   */
  setHolstered(holstered: boolean, instant = false): void {
    this.holstered = holstered;
    if (holstered && instant) this.holster = 1;
  }

  /** A grenade was thrown. */
  onThrow(): void {
    this.throwDip = 1;
  }

  /**
   * Call once per rendered frame. `reloadElapsed` is seconds into the current reload, or negative when not
   * reloading (the reload animation comes from `stats.reloadAnimation`). `lookX`/`lookY` are this frame's mouse
   * movement in pixels. `aim` runs from 0 at the hip to 1 fully aimed down the sights, where the rifle takes the
   * weapon's `ads` pose with less sway, bob and kick.
   */
  update(
    dt: number,
    body: CameraBodyState,
    reloadElapsed: number,
    lookX: number,
    lookY: number,
    aim: number,
    stats: WeaponStats,
  ): void {
    const vm = config.rifle.viewModel;
    const ads = stats.ads;
    const swayScale = lerp(1, ads.swayMultiplier, aim);
    const bobScale = lerp(1, ads.bobMultiplier, aim);
    const kickScale = lerp(1, ads.recoilMultiplier, aim);

    this.kick *= Math.exp(-vm.kickRecovery * dt);
    this.holster += ((this.holstered ? 1 : 0) - this.holster) * smoothing(this.holstered ? 12 : 9, dt);
    // Fully lowered: stop drawing it at all.
    this.pivot.visible = this.holster < 0.97;
    this.throwDip *= Math.exp(-5 * dt);

    this.flashTimer -= dt;
    const flashing = this.flashTimer > 0;
    this.flash.visible = flashing;
    this.flashLight.intensity = flashing ? MUZZLE_LIGHT_INTENSITY : 0;

    // Movement bob, plus a lowered, angled carry while sprinting and not shooting.
    const moving = body.grounded && body.horizontalSpeed > 0.5;
    this.bobWeight += ((moving ? Math.min(1, body.horizontalSpeed / config.player.walkSpeed) : 0) - this.bobWeight) * smoothing(8, dt);
    // Firing while sprinting snaps the rifle up to the normal pose; it drops back once the shooting stops.
    this.sinceFire += dt;
    const recentlyFired = this.sinceFire < vm.sprintCarryDelay;
    const carry = body.sprinting && !recentlyFired ? 1 : 0;
    const carrySpeed = recentlyFired ? vm.sprintRaiseSpeed : vm.sprintLowerSpeed;
    this.sprintWeight += (carry - this.sprintWeight) * smoothing(carrySpeed, dt);
    // In step with the footsteps: lowest as each foot comes down.
    const bobPhase = body.steps * Math.PI;
    const bobX = Math.sin(bobPhase) * vm.bobAmplitude * this.bobWeight * bobScale;
    const bobY = -Math.abs(Math.cos(bobPhase)) * vm.bobAmplitude * this.bobWeight * bobScale;

    // The gun drags slightly behind the mouse.
    const targetSwayX = MathUtils.clamp(-lookX * vm.lookSway, -vm.maxLookSway, vm.maxLookSway);
    const targetSwayY = MathUtils.clamp(lookY * vm.lookSway, -vm.maxLookSway, vm.maxLookSway);
    this.swayX += (targetSwayX - this.swayX) * smoothing(10, dt);
    this.swayY += (targetSwayY - this.swayY) * smoothing(10, dt);

    // Reload: the rifle tilts toward the player while the magazine is swapped (rest pose when not reloading).
    const reload = sampleReload(reloadElapsed, stats.reloadAnimation, this.reloadPose);
    this.magazine.visible = reload.magVisible;
    this.magazine.position.copy(this.magazineRest).setY(this.magazineRest.y - reload.magDepth);
    this.magazine.rotation.x = reload.magTilt;
    // The left hand goes with the magazine, waiting just below the frame while the old one drops away.
    const a = stats.reloadAnimation;
    this.handMagazine.copy(this.magazine.position).setY(this.magazineRest.y - Math.min(reload.magDepth, a.dropDistance));
    this.hands.update(sampleLeftHand(reloadElapsed, a), this.handMagazine, reload.magTilt);

    const kick = this.kick * kickScale;
    const kickPitch = MathUtils.degToRad(vm.kickPitch) * kick;
    const swayX = this.swayX * swayScale;
    const swayY = this.swayY * swayScale;
    // The rest pose slides from the hip to the sights; everything else is added on top.
    const rest = ads.viewPosition;
    const restRotation = ads.viewRotation;
    this.pivot.position.set(
      lerp(REST.x, rest.x, aim) + bobX - this.sprintWeight * 0.04 + swayX * 0.5,
      lerp(REST.y, rest.y, aim) + bobY + reload.lift - this.throwDip * 0.12 - this.sprintWeight * 0.03 +
        swayY * 0.5 - this.holster * 0.35,
      lerp(REST.z, rest.z, aim) + vm.kickBack * kick,
    );
    this.pivot.rotation.set(
      lerp(0, restRotation.x, aim) + kickPitch + reload.pitch - this.throwDip * 0.5 - this.sprintWeight * 0.15 + swayY -
        this.holster * 0.7,
      lerp(REST_YAW, restRotation.y, aim) + reload.yaw - swayX + this.sprintWeight * 0.3,
      lerp(0, restRotation.z, aim) + reload.roll + this.kickRoll * kick * 0.03 + bobX * 2,
    );
  }
}
