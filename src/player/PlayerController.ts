import RAPIER from '@dimforge/rapier3d-compat';
import { CapsuleGeometry, Mesh, MeshLambertMaterial, Vector3, type Scene } from 'three';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { Input } from '../core/Input';
import { Gait } from './Gait';

const DEG_TO_RAD = Math.PI / 180;
/** Gap Rapier keeps between the capsule and the world, in meters. */
const CONTROLLER_OFFSET = 0.02;
/** Narrowest ledge autostep will climb, in meters. */
const AUTOSTEP_MIN_WIDTH = 0.2;
/** The stand-up probe is this much thinner and starts this much higher, so touching walls or floor does not block it. */
const HEADROOM_PROBE_MARGIN = 0.05;
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/** Player movement wishes for the next fixed steps, sampled once per rendered frame. */
interface MoveIntent {
  forward: number;
  right: number;
  sprint: boolean;
  crouch: boolean;
}

function capsuleHalfHeight(height: number): number {
  return height / 2 - config.player.radius;
}

/** Move `current` toward `target` by at most `maxDelta` (2D, x/z). */
function approach(current: Vector3, targetX: number, targetZ: number, maxDelta: number): void {
  const dx = targetX - current.x;
  const dz = targetZ - current.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= maxDelta || dist === 0) {
    current.x = targetX;
    current.z = targetZ;
  } else {
    current.x += (dx / dist) * maxDelta;
    current.z += (dz / dist) * maxDelta;
  }
}

/**
 * First-person body: a kinematic capsule moved by Rapier's character controller.
 * The rigid body origin sits at the player's feet; the capsule collider is offset above it.
 * Movement is simulated in fixed steps and interpolated for rendering.
 */
export class PlayerController {
  /** Capsule shown only in the debug camera. */
  readonly debugMesh: Mesh;
  /** Walking rhythm, for footsteps and head bob. */
  readonly gait = new Gait();

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly headroomProbe: RAPIER.Capsule;

  private readonly _velocity = new Vector3();
  private readonly prevFeet = new Vector3();
  private readonly currFeet = new Vector3();
  private readonly renderFeet = new Vector3();
  private readonly lastRenderFeet = new Vector3();
  private readonly nextFeet = new Vector3();
  private readonly wish = new Vector3();
  private readonly intent: MoveIntent = { forward: 0, right: 0, sprint: false, crouch: false };

  private jumpBuffer = 0;
  private _grounded = false;
  private _crouching = false;
  private _sprinting = false;
  /** Fall speed of a hard landing since the last `takeLanding`, in m/s, or 0. */
  private landingSpeed = 0;
  /** Aiming down sights: no sprinting, and top speed scaled by `aimSpeedScale`. */
  private aiming = false;
  private aimSpeedScale = 1;

  constructor(
    scene: Scene,
    private readonly world: RAPIER.World,
    spawn: Vector3,
  ) {
    const p = config.player;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(capsuleHalfHeight(p.standHeight), p.radius)
        .setTranslation(0, p.standHeight / 2, 0)
        .setCollisionGroups(Groups.player),
      this.body,
    );

    this.controller = world.createCharacterController(CONTROLLER_OFFSET);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(p.stepHeight, AUTOSTEP_MIN_WIDTH, false);
    this.controller.enableSnapToGround(p.snapToGround);
    this.controller.setMaxSlopeClimbAngle(p.maxSlopeDegrees * DEG_TO_RAD);
    this.controller.setMinSlopeSlideAngle(p.maxSlopeDegrees * DEG_TO_RAD);

    this.headroomProbe = new RAPIER.Capsule(capsuleHalfHeight(p.standHeight), p.radius - HEADROOM_PROBE_MARGIN);

    this.prevFeet.copy(spawn);
    this.currFeet.copy(spawn);
    this.renderFeet.copy(spawn);
    this.lastRenderFeet.copy(spawn);

    this.debugMesh = new Mesh(
      new CapsuleGeometry(p.radius, p.standHeight - p.radius * 2, 4, 8),
      new MeshLambertMaterial({ color: 0x2e86de }),
    );
    this.debugMesh.visible = false;
    this.debugMesh.castShadow = true;
    scene.add(this.debugMesh);
    this.updateDebugMesh();
  }

  get grounded(): boolean {
    return this._grounded;
  }

  get crouching(): boolean {
    return this._crouching;
  }

  get sprinting(): boolean {
    return this._sprinting;
  }

  /** Horizontal speed, in m/s. */
  get horizontalSpeed(): number {
    return Math.hypot(this._velocity.x, this._velocity.z);
  }

  /** Footsteps taken, fractional; a foot comes down at each whole number. */
  get steps(): number {
    return this.gait.steps;
  }

  /** True while the sprint key is held, whether or not the player can sprint right now. */
  get sprintHeld(): boolean {
    return this.intent.sprint;
  }

  /** Velocity at the latest fixed step, in m/s. */
  get velocity(): Readonly<Vector3> {
    return this._velocity;
  }

  /** Feet position at the latest fixed step. */
  /** Handle of the player's capsule, so queries can recognise or skip it. */
  get colliderHandle(): number {
    return this.collider.handle;
  }

  get position(): Vector3 {
    return this.currFeet;
  }

  /** Feet position interpolated for the current render frame. */
  get renderPosition(): Vector3 {
    return this.renderFeet;
  }

  /**
   * Sample movement keys for the upcoming fixed steps. Call once per rendered frame, before `input.endFrame()`.
   * When `active` is false (mouse not captured, debug camera, dead) the player gets no input.
   */
  pollInput(input: Input, active: boolean): void {
    const intent = this.intent;
    if (!active) {
      intent.forward = 0;
      intent.right = 0;
      intent.sprint = false;
      intent.crouch = false;
      return;
    }
    intent.forward = (input.isActionDown('moveForward') ? 1 : 0) - (input.isActionDown('moveBack') ? 1 : 0);
    intent.right = (input.isActionDown('moveRight') ? 1 : 0) - (input.isActionDown('moveLeft') ? 1 : 0);
    intent.sprint = input.isActionDown('sprint');
    intent.crouch = input.isActionDown('crouch');
    // Latched as a short buffer so a press is never lost between fixed steps.
    if (input.wasActionPressed('jump')) this.jumpBuffer = config.player.jumpBufferTime;
  }

  /**
   * Aiming down sights: `aiming` stops sprinting, and `speedScale` scales the top speed
   * (it eases with the aim, so it may be below 1 while the sights are still lowering).
   */
  setAim(aiming: boolean, speedScale: number): void {
    this.aiming = aiming;
    this.aimSpeedScale = speedScale;
  }

  /** Simulate one fixed step. `yaw` is the camera heading in radians. */
  fixedUpdate(dt: number, yaw: number): void {
    const p = config.player;
    const intent = this.intent;

    this.updateCrouch(intent.crouch);

    // Wish direction on the ground plane, relative to where the camera faces (yaw 0 looks down -Z).
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    this.wish.set(
      -sin * intent.forward + cos * intent.right,
      0,
      -cos * intent.forward - sin * intent.right,
    );
    const hasWish = this.wish.lengthSq() > 0;
    if (hasWish) this.wish.normalize();

    this._sprinting = intent.sprint && intent.forward > 0 && !this._crouching && !this.aiming;
    const targetSpeed =
      (this._crouching ? p.crouchSpeed : this._sprinting ? p.sprintSpeed : p.walkSpeed) * this.aimSpeedScale;

    const v = this._velocity;
    if (this._grounded) {
      if (hasWish) {
        approach(v, this.wish.x * targetSpeed, this.wish.z * targetSpeed, p.groundAcceleration * dt);
      } else {
        approach(v, 0, 0, p.groundDeceleration * dt);
      }
    } else if (hasWish) {
      // Steer in the air without bleeding off speed carried from a sprint jump.
      const cap = Math.max(this.horizontalSpeed, targetSpeed);
      approach(v, this.wish.x * cap, this.wish.z * cap, p.airAcceleration * dt);
    }

    if (this._grounded && this.jumpBuffer > 0) {
      v.y = Math.sqrt(2 * p.gravity * p.jumpHeight);
      this.jumpBuffer = 0;
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    // Always push down a little, even when grounded: a zero-length move makes Rapier's
    // depenetration pop the capsule upward.
    v.y -= p.gravity * dt;

    const desired = { x: v.x * dt, y: v.y * dt, z: v.z * dt };
    // Loose dynamic bodies (grenades, later debris) never block the player. The player's collision groups
    // also skip full-height wall lips in favour of their low step proxies (see CollisionGroups).
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, Groups.player);
    const moved = this.controller.computedMovement();
    const wasGrounded = this._grounded;
    this._grounded = this.controller.computedGrounded();
    // Only a real drop counts as a landing, not a moment off the ground walking over a lip.
    if (this._grounded && !wasGrounded && -v.y >= config.footsteps.landingMinSpeed) {
      this.landingSpeed = Math.max(this.landingSpeed, -v.y);
      this.gait.land();
    }

    // The boundary colliders already stop the player; the clamp guarantees it.
    const limit = config.map.size / 2 - p.radius;
    const next = this.nextFeet.set(
      Math.min(limit, Math.max(-limit, this.currFeet.x + moved.x)),
      this.currFeet.y + moved.y,
      Math.min(limit, Math.max(-limit, this.currFeet.z + moved.z)),
    );

    // Keep only the velocity that survived collisions, so walls absorb speed and slides keep it.
    v.x = (next.x - this.currFeet.x) / dt;
    v.z = (next.z - this.currFeet.z) / dt;
    if (v.y > 0 && moved.y < desired.y - 1e-4) v.y = 0; // bumped the ceiling
    if (this._grounded && v.y < 0) v.y = 0;

    this.body.setNextKinematicTranslation(next);
    this.prevFeet.copy(this.currFeet);
    this.currFeet.copy(next);
  }

  /** Put the feet at `position` at once, standing still, with no blend from where they were (mounting the MG). */
  teleport(position: Vector3): void {
    this.prevFeet.copy(position);
    this.currFeet.copy(position);
    this.renderFeet.copy(position);
    this.lastRenderFeet.copy(position);
    this._velocity.set(0, 0, 0);
    this.body.setTranslation(position, true);
  }

  /** Fall speed of the hard landing since the last call, in m/s, or 0 if there was none. */
  takeLanding(): number {
    const speed = this.landingSpeed;
    this.landingSpeed = 0;
    return speed;
  }

  /** Blend between the last two fixed steps and advance the walking rhythm. Call once per rendered frame. */
  render(alpha: number, frameDt: number): void {
    this.lastRenderFeet.copy(this.renderFeet);
    this.renderFeet.lerpVectors(this.prevFeet, this.currFeet, alpha);
    const distance = Math.hypot(this.renderFeet.x - this.lastRenderFeet.x, this.renderFeet.z - this.lastRenderFeet.z);
    this.gait.update(distance, frameDt, this);
    if (this.debugMesh.visible) this.updateDebugMesh();
  }

  private updateCrouch(wantCrouch: boolean): void {
    if (wantCrouch && !this._crouching) {
      this.setCapsuleHeight(config.player.crouchHeight);
      this._crouching = true;
    } else if (!wantCrouch && this._crouching && this.hasHeadroom()) {
      this.setCapsuleHeight(config.player.standHeight);
      this._crouching = false;
    }
  }

  /** Resize the capsule, keeping its bottom at the feet. */
  private setCapsuleHeight(height: number): void {
    this.collider.setHalfHeight(capsuleHalfHeight(height));
    this.collider.setTranslationWrtParent({ x: 0, y: height / 2, z: 0 });
  }

  /** True if a standing capsule would fit at the current position. */
  private hasHeadroom(): boolean {
    const p = config.player;
    const center = {
      x: this.currFeet.x,
      y: this.currFeet.y + p.standHeight / 2 + HEADROOM_PROBE_MARGIN,
      z: this.currFeet.z,
    };
    const hit = this.world.intersectionWithShape(
      center,
      IDENTITY_ROTATION,
      this.headroomProbe,
      undefined,
      undefined,
      this.collider,
      this.body,
    );
    return hit === null;
  }

  private updateDebugMesh(): void {
    const p = config.player;
    const height = this._crouching ? p.crouchHeight : p.standHeight;
    this.debugMesh.scale.y = height / p.standHeight;
    this.debugMesh.position.set(this.renderFeet.x, this.renderFeet.y + height / 2, this.renderFeet.z);
  }
}
