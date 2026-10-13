import {
  AdditiveBlending,
  DirectionalLight,
  Euler,
  HemisphereLight,
  MathUtils,
  Matrix4,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { createMuzzleFlashTexture } from '../../combat/EffectTextures';
import { config } from '../../core/config';
import type { CameraBodyState } from '../FPSCamera';
import { fireInterval, type WeaponDef } from './defs/WeaponDef';
import { Gun } from './Gun';
import type { HeldWeapon } from './HeldWeapon';
import { Knife } from './Knife';
import { createKnifePose, restKnifePose, sampleKnife } from './KnifeAnimation';
import { chamberReleaseTime, createReloadPose, restReloadPose, sampleReload } from './ReloadAnimation';
import type { WeaponAsset } from './WeaponAssets';
import { ViewHands } from './ViewHands';
import { WeaponView } from './WeaponView';

/** Vertical field of view of the weapon camera, in degrees. Narrower than the world camera so the gun is not stretched. */
export const VIEW_FOV = 54;
const MUZZLE_LIGHT_INTENSITY = 3;
/** How far a weapon drops (m), tips down and rolls (radians) when fully put away. */
const HOLSTER_DROP = 0.32;
const HOLSTER_PITCH = 0.95;
const HOLSTER_ROLL = 0.35;
/** Overshoot of the draw as the weapon comes up and settles. */
const DRAW_OVERSHOOT = 1.2;
/** Share of a slide's shot cycle spent going back; the rest is the return. */
const SLIDE_BACK_SHARE = 0.35;
/** How quickly a released slide slams home (higher = faster). */
const SLIDE_RELEASE_SPEED = 45;

const smoothing = (speed: number, dt: number): number => 1 - Math.exp(-speed * dt);
const lerp = MathUtils.lerp;
const easeInCubic = (u: number): number => u * u * u;
const easeOutCubic = (u: number): number => 1 - (1 - u) ** 3;
const easeOutBack = (u: number, s: number): number => 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2;

/** What the view model needs from the frame, beyond the weapon itself. */
export interface ViewModelFrame {
  readonly body: CameraBodyState;
  /** This frame's mouse movement in pixels, for sway. */
  readonly lookX: number;
  readonly lookY: number;
  /** 0 at the hip, 1 fully aimed down the sights. */
  readonly aim: number;
  /** 0 in hand, 1 put away. `drawing` is true while it comes up (it settles with an overshoot), false while it goes down. */
  readonly lower: number;
  readonly drawing: boolean;
}

/**
 * The first-person weapon. It lives in its own scene and is drawn after the world with a cleared depth buffer, so
 * it never clips into walls. Shows whichever weapon is in hand, with the gloved hands placed by its def, and
 * animates: draw and holster, idle breathing sway, walking bob and the sprint carry, mouse sway, the fire kick
 * (scaled by each shot's recoil), raising the sights, dry fire, the slide, the reload (gun and magazine), knife attacks,
 * the grenade throw dip and the muzzle flash.
 */
export class ViewModel {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly pivot = new Object3D();
  private readonly hands = new ViewHands();
  private readonly views = new Map<string, WeaponView>();
  private view: WeaponView | null = null;
  private readonly flash: Sprite;
  private readonly flashLight: PointLight;
  private readonly reloadPose = createReloadPose();
  private readonly knifePose = createKnifePose();

  private kick = 0;
  private kickYaw = 0;
  private kickRoll = 0;
  private dryFire = 0;
  private throwDip = 0;
  private flashTimer = 0;
  private bobWeight = 0;
  private sprintWeight = 0;
  private sinceFire = Infinity;
  private swayX = 0;
  private swayY = 0;
  private idleTime = 0;
  /** Seconds since the last shot started the slide's cycle, and how far back the slide is (0 forward, 1 full travel). */
  private slideCycle = Infinity;
  private slideBack = 0;

  private readonly restMatrix = new Matrix4();
  private readonly restQuaternion = new Quaternion();
  private readonly restEuler = new Euler();
  private readonly restPosition = new Vector3();
  private readonly one = new Vector3(1, 1, 1);

  constructor(private readonly assets: ReadonlyMap<string, WeaponAsset>) {
    this.camera = new PerspectiveCamera(VIEW_FOV, window.innerWidth / window.innerHeight, 0.01, 5);

    // Lighting roughly matches the desert sun and sky, fixed relative to the view.
    this.scene.add(new HemisphereLight(0xfff3df, 0x8a6a45, 1.3));
    const sun = new DirectionalLight(0xfff1d6, 1.8);
    sun.position.set(0.6, 1, 0.4);
    this.scene.add(sun);
    this.scene.add(this.pivot);
    this.pivot.visible = false;

    const flashMaterial = new SpriteMaterial({
      map: createMuzzleFlashTexture(),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.flash = new Sprite(flashMaterial);
    this.flash.visible = false;
    // Stays in the scene at zero intensity so the light count never changes, whatever is in hand.
    this.flashLight = new PointLight(0xffc070, 0, 1.5, 2);
    this.pivot.add(this.flash, this.flashLight);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Put `weapon`'s model in the hands (null for empty hands). Its view is built on first use and kept. */
  show(weapon: HeldWeapon | null): void {
    const view = weapon ? this.viewOf(weapon.def) : null;
    if (view === this.view) return;
    if (this.view) this.pivot.remove(this.view.model);
    this.view = view;
    this.kick = 0;
    this.kickYaw = 0;
    this.dryFire = 0;
    this.flashTimer = 0;
    this.slideCycle = Infinity;
    if (!view) return;
    this.pivot.add(view.model);
    this.hands.attach(view.model, view.def.hands);
    if (view.magazine) view.magazine.visible = true;
    // The flash and its light sit just in front of this weapon's muzzle.
    view.model.add(this.flash, this.flashLight);
    this.flash.position.copy(view.marker).setZ(view.marker.z - 0.04);
    this.flashLight.position.copy(view.marker);
  }

  /** A shot left the barrel: `kickUp` and `kickSide` are its recoil, in degrees (side positive left). */
  onFire(kickUp: number, kickSide: number): void {
    const def = this.view?.def;
    if (!def || def.slot !== 'gun') return;
    this.kick = MathUtils.clamp(kickUp / def.recoil.kickUp, 0.35, 1.3);
    this.kickYaw = MathUtils.degToRad(kickSide) * 1.5;
    this.sinceFire = 0;
    this.kickRoll = (Math.random() - 0.5) * 2;
    this.slideCycle = 0;
    this.flashTimer = config.weapons.viewModel.muzzleFlashTime;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(def.muzzleFlashSize * (0.8 + Math.random() * 0.4));
  }

  /** The trigger clicked on an empty magazine: a small snap of the hand. */
  onDryFire(): void {
    this.dryFire = 1;
  }

  /** A grenade was thrown. */
  onThrow(): void {
    this.throwDip = 1;
  }

  /**
   * Where the muzzle is from the eye at the weapon's resting pose for `aim` (no kick or sway), in camera space
   * (x right, y up, -z forward), scaled sideways by `spread` so it lines up with a world camera whose
   * tan(half vertical FOV) is `spread` times this camera's. Into `out`; false for melee or empty hands.
   */
  muzzleOffset(aim: number, spread: number, out: Vector3): boolean {
    const view = this.view;
    if (!view || !view.ads) return false;
    this.restPose(view, aim);
    this.restMatrix.compose(this.restPosition, this.restQuaternion.setFromEuler(this.restEuler), this.one);
    out.copy(view.marker).applyMatrix4(this.restMatrix);
    out.x *= spread;
    out.y *= spread;
    return true;
  }

  /** Call once per rendered frame with the weapon in hand (or null). */
  update(dt: number, frame: ViewModelFrame, weapon: HeldWeapon | null): void {
    const view = this.view;
    this.pivot.visible = view !== null && frame.lower < 0.98;
    if (!view || !weapon) return;
    const def = view.def;
    const vm = config.weapons.viewModel;
    const gun = def.slot === 'gun' ? def : null;
    const aim = gun ? frame.aim : 0;
    const swayScale = gun ? lerp(1, gun.ads.swayMultiplier, aim) : 1;
    const bobScale = gun ? lerp(1, gun.ads.bobMultiplier, aim) : 1;
    const kickScale = gun ? lerp(1, gun.ads.recoilMultiplier, aim) : 0;

    const recovery = gun ? gun.kick.recovery : 16;
    this.kick *= Math.exp(-recovery * dt);
    this.kickYaw *= Math.exp(-recovery * dt);
    this.dryFire *= Math.exp(-14 * dt);
    this.throwDip *= Math.exp(-5 * dt);
    this.idleTime += dt;

    this.flashTimer -= dt;
    const flashing = this.flashTimer > 0;
    this.flash.visible = flashing;
    this.flashLight.intensity = flashing ? MUZZLE_LIGHT_INTENSITY : 0;

    // Movement bob, plus a lowered, angled carry while sprinting and not shooting or attacking.
    const body = frame.body;
    const moving = body.grounded && body.horizontalSpeed > 0.5;
    this.bobWeight += ((moving ? Math.min(1, body.horizontalSpeed / config.player.walkSpeed) : 0) - this.bobWeight) * smoothing(8, dt);
    this.sinceFire += dt;
    if (weapon instanceof Knife && weapon.phase !== 'idle') this.sinceFire = 0;
    const recentlyFired = this.sinceFire < vm.sprintCarryDelay;
    const carry = body.sprinting && !recentlyFired ? 1 : 0;
    const carrySpeed = recentlyFired ? vm.sprintRaiseSpeed : vm.sprintLowerSpeed;
    this.sprintWeight += (carry - this.sprintWeight) * smoothing(carrySpeed, dt);
    // In step with the footsteps: lowest as each foot comes down.
    const bobPhase = body.steps * Math.PI;
    const bobX = Math.sin(bobPhase) * vm.bobAmplitude * this.bobWeight * bobScale;
    const bobY = -Math.abs(Math.cos(bobPhase)) * vm.bobAmplitude * this.bobWeight * bobScale;
    // Breathing: a slow figure eight, fading out while walking and when aimed.
    const idle = def.view.idleSway * (1 - this.bobWeight) * (1 - aim * 0.8);
    const w = this.idleTime * Math.PI * 2 * def.view.idleRate;
    const idleX = Math.sin(w) * idle;
    const idleY = Math.sin(w * 2) * idle * 0.5;

    // The weapon drags slightly behind the mouse.
    const targetSwayX = MathUtils.clamp(-frame.lookX * vm.lookSway, -vm.maxLookSway, vm.maxLookSway);
    const targetSwayY = MathUtils.clamp(frame.lookY * vm.lookSway, -vm.maxLookSway, vm.maxLookSway);
    this.swayX += (targetSwayX - this.swayX) * smoothing(10, dt);
    this.swayY += (targetSwayY - this.swayY) * smoothing(10, dt);
    const swayX = this.swayX * swayScale;
    const swayY = this.swayY * swayScale;

    // Draw and holster: down and away with a roll, back up with a small overshoot.
    const lower = frame.drawing ? 1 - easeOutBack(1 - frame.lower, DRAW_OVERSHOOT) : easeInCubic(frame.lower);

    // Reload (gun and magazine, left hand) or knife attack.
    const reload = this.reloadPose;
    const knife = this.knifePose;
    if (weapon instanceof Gun) sampleReload(weapon.reloadElapsed, weapon.def.reload, weapon.reloadFromEmpty, view.magazineRig, reload);
    else restReloadPose(reload);
    if (weapon instanceof Knife) sampleKnife(weapon, weapon.def, knife);
    else restKnifePose(knife);
    if (view.magazine && view.magazineRig) {
      view.magazine.visible = reload.magVisible;
      view.magazine.position.copy(view.magazineRig.rest).addScaledVector(view.magazineRig.axis, reload.magDepth);
      view.magazine.rotation.x = reload.magTilt;
    }
    this.hands.setLeft(reload.hand, reload.elbow, reload.handBlend);
    if (view.slide && weapon instanceof Gun) this.updateSlide(dt, view, weapon);

    const kick = this.kick * kickScale;
    const kickPitch = gun ? MathUtils.degToRad(gun.kick.pitch) * kick : 0;
    const kickBack = gun ? gun.kick.back * kick : 0;
    const kickRoll = gun ? this.kickRoll * kick * gun.kick.roll : 0;

    // The rest pose slides from the hip to the sights; everything else is added on top.
    this.restPose(view, aim);
    const s = this.sprintWeight;
    this.pivot.position.set(
      this.restPosition.x + bobX + idleX - s * 0.04 + swayX * 0.5 + knife.x + lower * 0.05,
      this.restPosition.y + bobY + idleY + reload.lift - this.throwDip * 0.12 - s * def.view.sprintDrop + swayY * 0.5 + knife.y -
        lower * HOLSTER_DROP,
      this.restPosition.z + kickBack + this.dryFire * 0.006 + knife.z,
    );
    this.pivot.rotation.set(
      this.restEuler.x + kickPitch + reload.pitch - this.throwDip * 0.5 + s * def.view.sprintPitch + swayY - this.dryFire * 0.035 +
        knife.pitch - lower * HOLSTER_PITCH,
      this.restEuler.y + this.kickYaw * kickScale + reload.yaw - swayX + s * def.view.sprintYaw + knife.yaw,
      this.restEuler.z + reload.roll + kickRoll + bobX * 2 + knife.roll + lower * HOLSTER_ROLL,
    );
  }

  /**
   * The slide: back and forward with each shot, locked back once the magazine runs dry, and held there through an
   * empty reload until its chamber step releases it to slam home.
   */
  private updateSlide(dt: number, view: WeaponView, gun: Gun): void {
    const def = gun.def;
    const slide = def.slide;
    if (!slide || !view.slide) return;
    const r = def.reload;
    const releasing = r.kind === 'magazine' && gun.isReloading && gun.reloadFromEmpty && gun.reloadElapsed < chamberReleaseTime(r);
    const locked = gun.magazine === 0 || releasing;
    const cycle = Math.min(slide.cycleTime, fireInterval(def) * 0.6);
    this.slideCycle += dt;
    if (this.slideCycle < cycle) {
      const u = this.slideCycle / cycle;
      if (u < SLIDE_BACK_SHARE) this.slideBack = Math.max(this.slideBack, easeOutCubic(u / SLIDE_BACK_SHARE));
      else this.slideBack = locked ? 1 : 1 - easeInCubic((u - SLIDE_BACK_SHARE) / (1 - SLIDE_BACK_SHARE));
    } else {
      this.slideBack += ((locked ? 1 : 0) - this.slideBack) * smoothing(SLIDE_RELEASE_SPEED, dt);
    }
    view.slide.position.copy(view.slideRest).setZ(view.slideRest.z + slide.travel * this.slideBack);
  }

  /** The resting pose between the hip (`aim` 0) and the sights (1), into `restPosition` and `restEuler`. */
  private restPose(view: WeaponView, aim: number): void {
    const ads = view.ads;
    this.restPosition.copy(view.hipPosition);
    this.restEuler.copy(view.hipRotation);
    if (!ads || aim <= 0) return;
    this.restPosition.lerp(ads.position, aim);
    this.restEuler.set(
      lerp(view.hipRotation.x, ads.rotation.x, aim),
      lerp(view.hipRotation.y, ads.rotation.y, aim),
      lerp(view.hipRotation.z, ads.rotation.z, aim),
    );
  }

  private viewOf(def: WeaponDef): WeaponView {
    let view = this.views.get(def.id);
    if (!view) {
      const asset = this.assets.get(def.view.model);
      if (!asset) throw new Error(`Weapon model "${def.view.model}" was not loaded`);
      view = new WeaponView(def, asset);
      this.views.set(def.id, view);
    }
    return view;
  }
}
