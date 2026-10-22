import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { Damageable } from '../combat/Damageable';
import type { DamageType } from '../combat/DamageType';
import type { ImpactSurface } from '../core/EventBus';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { EnemyContext } from './EnemyContext';
import type { EnemyType } from './EnemyType';
import { EnemyPath } from './Pathfinder';
import { createSoldierPose, SoldierRig, type SoldierPose } from './SoldierRig';
import type { SoldierRenderer } from './SoldierRenderer';

/** Every state either enemy type can be in. Shown in the F4 debug labels. */
export type EnemyState =
  | 'inactive'
  | 'advance'
  | 'cover'
  | 'engage'
  | 'shootWall'
  | 'shootCore'
  | 'plant'
  | 'retreat'
  | 'wait'
  | 'loiter'
  | 'dead';

/** How the body moves: not at all, along its path, or straight to `movePoint`. */
type MoveMode = 'none' | 'path' | 'point';

// Hit zones, relative to the feet, standing. Once posed they follow the skeleton (see `fitHitboxes`).
const BODY_RADIUS = 0.25;
const BODY_HALF = 0.4;
const BODY_Y = 0.8;
const HEAD_RADIUS = 0.14;
const HEAD_Y = 1.64;
const UP = new Vector3(0, 1, 0);
/** Gap Rapier keeps between the capsule and the world, in meters. */
const CONTROLLER_OFFSET = 0.02;
/** Within this distance of a final stop, the walk slows down so it arrives without overshooting, in meters. */
const ARRIVE_DISTANCE = 1;
const POINT_REACH = 0.3;
/** How quickly the recoil and flinch kicks fade, per second. */
const RECOIL_DECAY = 9;
const FLINCH_DECAY = 5;
/** Upper-body roll per meter of sideways lean, in radians. */
const LEAN_ROLL = 1.1;
/** Downward speed while on the ground, in m/s: enough to stay stuck to it walking downhill. */
const GROUND_PUSH = 2;

/** One controller for the whole pool: it holds settings, not per-body state. */
export function createEnemyController(world: RAPIER.World): RAPIER.KinematicCharacterController {
  const e = config.enemies;
  const controller = world.createCharacterController(CONTROLLER_OFFSET);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setSlideEnabled(true);
  controller.enableAutostep(e.stepHeight, 0.2, false);
  controller.enableSnapToGround(0.3);
  controller.setMaxSlopeClimbAngle((e.maxSlopeDegrees * Math.PI) / 180);
  controller.setMinSlopeSlideAngle((e.maxSlopeDegrees * Math.PI) / 180);
  return controller;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Shared base for every enemy type. A pooled soldier with HP, a capsule moved by a Rapier kinematic character
 * controller (it steps over wall lips and rubble like the player), head and body hitboxes (the rifle's
 * headshot multiplier applies to the head), path following with separation steering, and a state machine
 * that the subclasses drive from `think` (about 10 Hz, staggered) and `tick` (every frame).
 * Dead bodies topple over, lie for a while, sink into the ground and go back to the pool.
 */
export abstract class Enemy implements Damageable {
  readonly kind = 'enemy';
  abstract readonly type: EnemyType;
  abstract readonly maxHp: number;
  readonly impactSurface: ImpactSurface = 'flesh';
  hp = 0;
  state: EnemyState = 'inactive';
  readonly path = new EnemyPath();
  /** Waiting in the pathfinder's queue. */
  pathQueued = false;
  /** Seconds until the next `think`. Staggered by the manager. */
  thinkTimer = 0;
  /** A debug kill: die without dropping a carried satchel. */
  quietDeath = false;
  /** Facing, in radians (0 faces +Z). */
  yaw = 0;
  readonly rig = new SoldierRig();

  readonly prevFeet = new Vector3();
  readonly currFeet = new Vector3();
  readonly renderFeet = new Vector3();
  readonly velocity = new Vector3();

  protected hasPath = false;
  protected pathIndex = 0;
  /** The last waypoint it can walk to: the path's end, or the waypoint before the breach wall. */
  protected stopIndex = 0;
  /** Reached the end of the path (`stopIndex`) or the move point. */
  protected arrived = false;
  protected moveMode: MoveMode = 'none';
  protected readonly movePoint = new Vector3();
  protected moveSpeed = 0;
  /** Face this point instead of the way it moves. */
  protected hasLook = false;
  protected readonly lookPoint = new Vector3();
  protected readonly pose = createSoldierPose();
  protected deadTime = 0;
  /** Where the upper body leans out to (leaning out from cover), as a world x, z offset at eye height, in meters. */
  protected readonly lean = { x: 0, z: 0 };

  private readonly body: RAPIER.RigidBody;
  private readonly capsule: RAPIER.Collider;
  private readonly headBox: RAPIER.Collider;
  private readonly bodyBox: RAPIER.Collider;
  private readonly center = new Vector3();
  private readonly next = new Vector3();
  private stuckTimer = 0;
  private readonly stuckFrom = new Vector3();
  private stepIndex = 0;
  private readonly hitHead = new Vector3();
  private readonly hitBottom = new Vector3();
  private readonly hitTop = new Vector3();
  private readonly hitAxis = new Vector3();
  private readonly hitTurn = new Quaternion();
  private grounded = true;
  private readonly steer = { x: 0, z: 0 };

  constructor(
    readonly slot: number,
    protected readonly ctx: EnemyContext,
  ) {
    const e = config.enemies;
    const world = ctx.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setEnabled(false));
    this.capsule = world.createCollider(
      RAPIER.ColliderDesc.capsule(e.height / 2 - e.radius, e.radius).setTranslation(0, e.height / 2, 0).setCollisionGroups(Groups.enemy),
      this.body,
    );
    this.bodyBox = world.createCollider(
      RAPIER.ColliderDesc.capsule(BODY_HALF, BODY_RADIUS).setTranslation(0, BODY_Y, 0).setCollisionGroups(Groups.enemyHitbox),
      this.body,
    );
    this.headBox = world.createCollider(
      RAPIER.ColliderDesc.ball(HEAD_RADIUS).setTranslation(0, HEAD_Y, 0).setCollisionGroups(Groups.enemyHitbox),
      this.body,
    );
  }

  get active(): boolean {
    return this.state !== 'inactive';
  }

  get isAlive(): boolean {
    return this.state !== 'inactive' && this.state !== 'dead';
  }

  /** Middle of the body, for explosion distance. */
  get position(): Vector3 {
    return this.center.set(this.currFeet.x, this.currFeet.y + (this.pose.crouch > 0.5 ? 0.6 : 0.9), this.currFeet.z);
  }

  /** The animation pose it is drawn with (sent to multiplayer clients). */
  get soldierPose(): Readonly<SoldierPose> {
    return this.pose;
  }

  /** The wall this enemy plans to breach, or 0 for none. */
  get breachWallId(): number {
    return this.hasPath ? this.path.breachWallId : 0;
  }

  /** The waypoint it is walking to, for the debug path view. */
  get currentWaypoint(): number {
    return this.pathIndex;
  }

  /** The body has sunk away and can go back to the pool. */
  get finished(): boolean {
    const e = config.enemies;
    return this.state === 'dead' && this.deadTime >= e.fallTime + e.corpseTime + e.sinkTime;
  }

  /** Short text for the debug label above its head. */
  get label(): string {
    return `${this.type.toUpperCase()} ${this.state.toUpperCase()}`;
  }

  /** Eye position at the latest fixed step. */
  eye(out: Vector3): Vector3 {
    const e = config.enemies;
    return out.set(this.currFeet.x + this.lean.x, this.currFeet.y + e.eyeHeight - this.pose.crouch * 0.6, this.currFeet.z + this.lean.z);
  }

  /** Bring a pooled enemy into play at `at`, facing `yaw`. */
  spawn(at: Vector3, yaw: number): void {
    this.enter(at, yaw);
    this.ctx.requestPath(this);
  }

  /**
   * Multiplayer client: show this pooled soldier as one of the host's, with hitboxes for the player's shots
   * but no AI. `replicaUpdate` then moves and poses it from the host's snapshots.
   */
  replicaSpawn(at: Vector3, yaw: number): void {
    this.enter(at, yaw);
  }

  /** Multiplayer client: the host's latest word on this soldier. `pose` is copied. */
  replicaUpdate(feet: Vector3, yaw: number, pose: Readonly<SoldierPose>, hp: number): void {
    this.prevFeet.copy(feet);
    this.currFeet.copy(feet);
    this.body.setNextKinematicTranslation(feet);
    this.yaw = yaw;
    Object.assign(this.pose, pose);
    if (this.isAlive) this.hp = hp;
  }

  /** Multiplayer client: the host says it died. It stops taking hits; the host's snapshots keep posing the body. */
  replicaDie(): void {
    if (!this.isAlive) return;
    this.hp = 0;
    this.state = 'dead';
    this.leaveField();
  }

  private enter(at: Vector3, yaw: number): void {
    this.hp = this.maxHp;
    this.state = 'advance';
    this.quietDeath = false;
    this.yaw = yaw;
    this.deadTime = 0;
    this.hasPath = false;
    this.path.clear();
    this.arrived = false;
    this.moveMode = 'none';
    this.moveSpeed = 0;
    this.hasLook = false;
    this.stuckTimer = 0;
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.lean.x = 0;
    this.lean.z = 0;
    Object.assign(this.pose, createSoldierPose());
    this.prevFeet.copy(at);
    this.currFeet.copy(at);
    this.renderFeet.copy(at);
    this.stuckFrom.copy(at);
    this.body.setEnabled(true);
    this.body.setTranslation(at, true);
    this.body.setNextKinematicTranslation(at);
    for (const collider of [this.capsule, this.headBox, this.bodyBox]) collider.setEnabled(true);
    // Standing hit zones until the first pose fits them to the skeleton.
    this.headBox.setTranslationWrtParent({ x: 0, y: HEAD_Y, z: 0 });
    this.bodyBox.setHalfHeight(BODY_HALF);
    this.bodyBox.setTranslationWrtParent({ x: 0, y: BODY_Y, z: 0 });
    this.bodyBox.setRotationWrtParent({ x: 0, y: 0, z: 0, w: 1 });
    this.ctx.registry.addHitbox(this.headBox, this, 'head');
    this.ctx.registry.addHitbox(this.bodyBox, this, 'body');
    this.onSpawn();
  }

  /** Back to the pool. The manager hides its parts. */
  release(): void {
    this.state = 'inactive';
    this.hasPath = false;
    this.body.setEnabled(false);
  }

  takeDamage(amount: number, _type: DamageType, from: Vector3): void {
    if (!this.isAlive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.pose.flinch = 1;
    this.pose.flinchSide = Math.random() < 0.5 ? -1 : 1;
    if (this.hp <= 0) this.die(from);
  }

  /** The pathfinder filled in `path`. */
  pathReady(found: boolean): void {
    this.pathQueued = false;
    if (!this.isAlive) return;
    this.hasPath = found && this.path.length > 0;
    if (!this.hasPath) return;
    this.pathIndex = this.path.length > 1 ? 1 : 0;
    this.stopIndex = this.path.breachIndex >= 0 ? this.path.breachIndex : this.path.length - 1;
    this.pathIndex = Math.min(this.pathIndex, this.stopIndex);
    this.arrived = false;
    this.onPathChanged();
  }

  /** Does the current route pass through grid cell `cell` (j * columns + i)? */
  pathUsesCell(cell: number): boolean {
    return this.hasPath && this.path.cells.includes(cell);
  }

  /** Decide what to do. Called about 10 times a second. */
  abstract think(): void;

  /** Per-frame timers (firing, planting, death). */
  update(dt: number): void {
    if (!this.active) return;
    if (this.state === 'dead') {
      const e = config.enemies;
      this.deadTime += dt;
      this.pose.fall = Math.min(1, this.deadTime / e.fallTime);
      const sinking = this.deadTime - e.fallTime - e.corpseTime;
      this.pose.sink = sinking > 0 ? (Math.min(1, sinking / e.sinkTime) * e.sinkDepth) : 0;
      this.pose.speed = 0;
      this.pose.recoil = Math.max(0, this.pose.recoil - RECOIL_DECAY * dt);
      return;
    }
    this.pose.recoil = Math.max(0, this.pose.recoil - RECOIL_DECAY * dt);
    this.pose.flinch = Math.max(0, this.pose.flinch - FLINCH_DECAY * dt);
    this.tick(dt);
  }

  /**
   * One fixed physics step of movement: follow the path or walk to the move point, steer away from
   * neighbours (`sepX`, `sepZ`), and move the capsule with the character controller. Call before the step.
   */
  fixedUpdate(dt: number, sepX: number, sepZ: number, controller: RAPIER.KinematicCharacterController): void {
    if (!this.isAlive) return;
    const e = config.enemies;
    let wishX = 0;
    let wishZ = 0;
    const target = this.steerTarget();
    if (target) {
      const dx = target.x - this.currFeet.x;
      const dz = target.z - this.currFeet.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1e-3) {
        const final = this.moveMode === 'point' || this.pathIndex === this.stopIndex;
        const speed = final ? this.moveSpeed * Math.min(1, distance / ARRIVE_DISTANCE + 0.25) : this.moveSpeed;
        wishX = (dx / distance) * speed;
        wishZ = (dz / distance) * speed;
      }
    }
    wishX += sepX * e.separationStrength;
    wishZ += sepZ * e.separationStrength;

    // Accelerate toward the wish velocity.
    const v = this.velocity;
    const ddx = wishX - v.x;
    const ddz = wishZ - v.z;
    const change = Math.hypot(ddx, ddz);
    const maxChange = e.acceleration * dt;
    if (change <= maxChange) {
      v.x = wishX;
      v.z = wishZ;
    } else {
      v.x += (ddx / change) * maxChange;
      v.z += (ddz / change) * maxChange;
    }
    // Always push down a little: a zero-length move makes Rapier pop the capsule upward. On the ground the
    // push stays small and constant, so climbing rubble never builds up a fall speed that pins the capsule.
    v.y = this.grounded ? -GROUND_PUSH : v.y - e.gravity * dt;

    controller.computeColliderMovement(
      this.capsule,
      { x: v.x * dt, y: v.y * dt, z: v.z * dt },
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
      Groups.enemy,
    );
    const moved = controller.computedMovement();
    const limit = config.map.size / 2 - e.radius;
    const next = this.next.set(
      Math.min(limit, Math.max(-limit, this.currFeet.x + moved.x)),
      this.currFeet.y + moved.y,
      Math.min(limit, Math.max(-limit, this.currFeet.z + moved.z)),
    );
    // The horizontal velocity stays the steering wish: bodies here only walk, and feeding back what
    // collisions let through would stall them on slopes (each step would start from the last tiny one).
    this.grounded = controller.computedGrounded() || moved.y > 1e-4;
    if (this.grounded) v.y = 0;
    this.body.setNextKinematicTranslation(next);
    this.prevFeet.copy(this.currFeet);
    this.currFeet.copy(next);

    this.turn(dt);
    this.advanceGait(dt);
    this.checkStuck(dt);
  }

  /** Blend between the last two fixed steps, pose the skeleton and hand it to the renderer. */
  render(alpha: number, renderer: SoldierRenderer): void {
    // Roll the upper body toward the lean: positive rolls to its right, which faces (-cos yaw, 0, sin yaw).
    const side = -this.lean.x * Math.cos(this.yaw) + this.lean.z * Math.sin(this.yaw);
    this.pose.roll += (side * LEAN_ROLL - this.pose.roll) * 0.2;
    if (this.state === 'dead') this.renderFeet.copy(this.currFeet);
    else this.renderFeet.lerpVectors(this.prevFeet, this.currFeet, alpha);
    this.rig.pose(this.renderFeet, this.yaw, this.pose);
    this.rig.write(renderer, this.slot);
    if (this.isAlive) this.fitHitboxes();
  }

  // ---- Hooks for the subclasses ----

  protected onSpawn(): void {}
  protected onPathChanged(): void {}
  protected onDeath(): void {}
  protected tick(_dt: number): void {}

  /** Walk the route up to `stopIndex`. */
  protected followPath(speed: number): void {
    this.moveMode = this.hasPath ? 'path' : 'none';
    this.moveSpeed = speed;
  }

  /** Walk straight to `point`. */
  protected moveTo(point: Vector3, speed: number): void {
    if (this.moveMode !== 'point' || this.movePoint.distanceToSquared(point) > 0.01) this.arrived = false;
    this.moveMode = 'point';
    this.movePoint.copy(point);
    this.moveSpeed = speed;
  }

  protected stop(): void {
    this.moveMode = 'none';
    this.moveSpeed = 0;
  }

  /** Face `point` (aiming, planting), or pass null to face the way it walks. */
  protected lookAt(point: Vector3 | null): void {
    this.hasLook = point !== null;
    if (point) this.lookPoint.copy(point);
  }

  /** Signed angle from its facing to the look point, in radians. */
  protected lookError(): number {
    if (!this.hasLook) return 0;
    const want = Math.atan2(this.lookPoint.x - this.currFeet.x, this.lookPoint.z - this.currFeet.z);
    return wrapAngle(want - this.yaw);
  }

  /** Horizontal distance from the feet to a point. */
  protected flatDistance(point: Vector3): number {
    return Math.hypot(point.x - this.currFeet.x, point.z - this.currFeet.z);
  }

  /** Nothing has moved it for a while: plan again. Subclasses may add more. */
  protected onStuck(): void {
    this.ctx.requestPath(this);
  }

  /** The pose's crouch, 0..1 (sappers planting). */
  protected setCrouch(target: number, dt: number, rate: number): void {
    const c = this.pose.crouch;
    this.pose.crouch = target > c ? Math.min(target, c + rate * dt) : Math.max(target, c - rate * dt);
  }

  private die(from: Vector3): void {
    this.hp = 0;
    this.state = 'dead';
    this.deadTime = 0;
    this.stop();
    this.hasLook = false;
    this.lean.x = 0;
    this.lean.z = 0;
    this.velocity.set(0, 0, 0);
    // Topple away from whatever killed it.
    let fx = this.currFeet.x - from.x;
    let fz = this.currFeet.z - from.z;
    const length = Math.hypot(fx, fz);
    if (length < 1e-3) {
      const a = Math.random() * Math.PI * 2;
      fx = Math.cos(a);
      fz = Math.sin(a);
    } else {
      fx /= length;
      fz /= length;
    }
    this.pose.fallX = fx;
    this.pose.fallZ = fz;
    this.leaveField();
    this.onDeath();
  }

  /** Dead: nothing touches or hits the body any more. */
  private leaveField(): void {
    for (const collider of [this.capsule, this.headBox, this.bodyBox]) collider.setEnabled(false);
    this.ctx.registry.remove(this, [this.headBox, this.bodyBox]);
  }

  /** Where to steer this step, or null to stand. Advances path waypoints and sets `arrived`. */
  private steerTarget(): { x: number; z: number } | null {
    const reach = config.enemies.waypointReach;
    if (this.moveMode === 'point') {
      if (this.flatDistance(this.movePoint) < POINT_REACH) {
        this.arrived = true;
        return null;
      }
      return this.movePoint;
    }
    if (this.moveMode !== 'path' || !this.hasPath) return null;
    const xs = this.path.xs;
    const zs = this.path.zs;
    while (this.pathIndex < this.stopIndex) {
      const dx = xs[this.pathIndex] - this.currFeet.x;
      const dz = zs[this.pathIndex] - this.currFeet.z;
      if (dx * dx + dz * dz > reach * reach) break;
      this.pathIndex++;
    }
    const dx = xs[this.pathIndex] - this.currFeet.x;
    const dz = zs[this.pathIndex] - this.currFeet.z;
    if (this.pathIndex === this.stopIndex && dx * dx + dz * dz < POINT_REACH * POINT_REACH * 4) {
      this.arrived = true;
      return null;
    }
    this.steer.x = xs[this.pathIndex];
    this.steer.z = zs[this.pathIndex];
    return this.steer;
  }

  private turn(dt: number): void {
    let want: number | null = null;
    if (this.hasLook) want = Math.atan2(this.lookPoint.x - this.currFeet.x, this.lookPoint.z - this.currFeet.z);
    else if (Math.hypot(this.velocity.x, this.velocity.z) > 0.4) want = Math.atan2(this.velocity.x, this.velocity.z);
    if (want === null) return;
    const delta = wrapAngle(want - this.yaw);
    const step = config.enemies.turnSpeed * dt;
    this.yaw = wrapAngle(this.yaw + Math.max(-step, Math.min(step, delta)));
  }

  /** Walk cycle from distance covered, with a footstep at each foot plant near the player. */
  private advanceGait(dt: number): void {
    const e = config.enemies;
    const distance = Math.hypot(this.currFeet.x - this.prevFeet.x, this.currFeet.z - this.prevFeet.z);
    const speed = distance / dt;
    this.pose.speed += (speed - this.pose.speed) * Math.min(1, dt * 10);
    this.pose.phase += (distance / e.stride) * Math.PI;
    const step = Math.floor(this.pose.phase / Math.PI);
    if (step !== this.stepIndex) {
      this.stepIndex = step;
      const range2 = e.footstepRange * e.footstepRange;
      for (const player of this.ctx.players) {
        const dx = player.position.x - this.currFeet.x;
        const dz = player.position.z - this.currFeet.z;
        if (dx * dx + dz * dz >= range2) continue;
        this.ctx.events.emit('enemyFootstep', { position: this.currFeet });
        break;
      }
    }
  }

  private checkStuck(dt: number): void {
    const e = config.enemies;
    if (this.moveMode === 'none' || this.arrived || this.moveSpeed <= 0) {
      this.stuckTimer = 0;
      this.stuckFrom.copy(this.currFeet);
      return;
    }
    this.stuckTimer += dt;
    if (this.stuckTimer < e.stuckTime) return;
    if (this.flatDistance(this.stuckFrom) < e.stuckDistance) this.onStuck();
    this.stuckTimer = 0;
    this.stuckFrom.copy(this.currFeet);
  }

  /**
   * Put the head and body hitboxes where the posed skeleton is, so shots land on what the player sees in
   * every pose (crouched planting, leaning out from cover, flinching). Offsets are taken from the drawn feet
   * and applied to the physics body, which is at most one fixed step away.
   */
  private fitHitboxes(): void {
    const feet = this.renderFeet;
    this.rig.hitZones(this.hitHead, this.hitBottom, this.hitTop);
    this.headBox.setTranslationWrtParent({ x: this.hitHead.x - feet.x, y: this.hitHead.y - feet.y, z: this.hitHead.z - feet.z });
    const axis = this.hitAxis.subVectors(this.hitTop, this.hitBottom);
    const length = Math.max(0.1, axis.length());
    axis.divideScalar(length);
    this.bodyBox.setHalfHeight(length / 2);
    this.bodyBox.setTranslationWrtParent({
      x: (this.hitBottom.x + this.hitTop.x) / 2 - feet.x,
      y: (this.hitBottom.y + this.hitTop.y) / 2 - feet.y,
      z: (this.hitBottom.z + this.hitTop.z) / 2 - feet.z,
    });
    const q = this.hitTurn.setFromUnitVectors(UP, axis);
    this.bodyBox.setRotationWrtParent({ x: q.x, y: q.y, z: q.z, w: q.w });
  }
}
