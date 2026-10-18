import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Vector3 } from 'three';
import type { Structure } from '../build/Structure';
import { applyDamage } from '../combat/Damage';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { ImpactSurface } from '../core/EventBus';
import { Enemy } from './Enemy';
import type { EnemyContext } from './EnemyContext';

/** A place to fight from. */
interface CoverSpot {
  x: number;
  z: number;
  /** Distance from the rifleman now. */
  d: number;
  /** Where it leans out to, as a world offset at eye height. */
  leanX: number;
  leanZ: number;
  /** Where the shield test starts, as an offset from the spot, and at what height. */
  shieldX: number;
  shieldZ: number;
  shieldY: number;
}

/** What the rifleman is shooting at. */
type FireTarget = 'player' | 'wall' | 'core' | null;

/** Seconds between checks for a clear shot at the core or the breach wall while advancing. */
const TARGET_CHECK_INTERVAL = 0.5;
/** Seconds it will spend walking to cover before it gives up and fights from where it is. */
const COVER_TIMEOUT = 2.5;
/** Rays the cover search needs at least; it only starts when this many fit in the frame's sight budget. */
const COVER_RAYS = 6;
/** Height of the ray that decides whether something low (rubble, a rock) shields a cover spot, in meters. */
const COVER_RAY_HEIGHT = 0.35;
/** Something within this distance on that ray counts as cover, in meters. */
const COVER_SHIELD_DISTANCE = 2;
/** The far face of an obstacle is found by casting back toward the player from this far beyond its middle, in meters. */
const COVER_BACKCAST = 8;
/** How far past that face the rifleman stands, in meters (its capsule radius plus a little). */
const COVER_GAP = 0.6;
/** Sideways steps when looking for an obstacle's edge, the farthest to look, and how far past the edge to lean out, in meters. */
const COVER_EDGE_STEP = 0.4;
const COVER_EDGE_MAX = 4;
/** Heights at which an obstacle's outline is measured, in meters (shin, chest, eyes). */
const COVER_SCAN_HEIGHTS = [0.35, 1.0, 1.55];
/**
 * At an edge: it stands this far outside the outline (just clear of it), the shield test starts this far
 * inside it, and it leans out this far to shoot, in meters.
 */
const COVER_EDGE_CLEAR = 0.4;
const COVER_EDGE_INSIDE = 0.1;
const COVER_LEAN = 0.2;
/** Aim this far below the player's eyes (center mass), in meters. */
const CHEST_DROP = 0.4;
/** Height on a wall to aim at, in meters. */
const WALL_AIM_HEIGHT = 1.2;
/** Must face within this angle of the target to fire, in radians. */
const FIRE_CONE = 0.25;
/** How quickly the rifle comes up to the shoulder and goes back down (0..1 per second). */
const RAISE_RATE = 5;

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const deg = MathUtils.degToRad;

/**
 * Rifleman: advances along its path toward the core. Checks every 0.2 s whether it can see the player's
 * head; on sight it moves to nearby cover if there is any (rubble, a rock or a wall), then, after a short
 * reaction time, fires 3-5 round hitscan bursts whose spread tightens the longer it aims (and widens with
 * range and when the player moves). With no player in sight it shoots the wall in its way (weakly: walls
 * shrug off bullets, the sappers do the breaching) or, with a clear line to it, the core.
 */
export class Rifleman extends Enemy {
  readonly type = 'rifleman';
  readonly maxHp: number = config.rifleman.hp;

  private seesPlayer = false;
  private lastSeen = -Infinity;
  private perceptionTimer = 0;
  private targetCheckTimer = 0;
  private reaction = 0;
  private aimTime = 0;
  private burstLeft = 0;
  private shotTimer = 0;
  private pauseTimer = 0;
  private fireTarget: FireTarget = null;
  private coverDeadline = 0;
  /** The lean that goes with the chosen cover spot. */
  private coverLeanX = 0;
  private coverLeanZ = 0;
  private readonly aimPoint = new Vector3();
  private readonly coverPoint = new Vector3();
  private readonly eyePos = new Vector3();
  private readonly headPos = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly direction = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly muzzle = new Vector3();
  private readonly end = new Vector3();
  private readonly normal = new Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private readonly coverBall: RAPIER.Ball;
  /** A standing body, to check a cover spot is free. */
  private readonly standProbe = new RAPIER.Capsule(config.enemies.height / 2 - config.enemies.radius - 0.05, config.enemies.radius);
  /** The height at which the last `farFace` found the obstacle reaching farthest back. */
  private faceHeight = 0;
  private readonly coverRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private readonly nearby: RAPIER.Collider[] = [];
  /** Random point along the wall for this burst, so wall fire spreads out. */
  private wallOffset = 0;

  constructor(slot: number, ctx: EnemyContext) {
    super(slot, ctx);
    this.coverBall = new RAPIER.Ball(config.rifleman.coverSearchRadius);
  }

  protected override onSpawn(): void {
    this.pose.armed = true;
    this.pose.satchel = false;
    this.pose.band = false;
    this.pose.fullSpeed = config.rifleman.speed;
    this.pose.lean = 0.12;
    this.seesPlayer = false;
    this.lastSeen = -Infinity;
    // Spread the perception checks across the pool.
    this.perceptionTimer = Math.random() * config.rifleman.perceptionInterval;
    this.targetCheckTimer = Math.random() * TARGET_CHECK_INTERVAL;
    this.fireTarget = null;
    this.burstLeft = 0;
  }

  protected override onPathChanged(): void {
    if (this.state === 'shootWall' && this.path.breachWallId === 0) this.state = 'advance';
  }

  think(): void {
    if (!this.isAlive) return;
    const r = config.rifleman;
    const now = this.ctx.now();
    const playerAlive = this.ctx.player.damageable.isAlive;
    const sees = playerAlive && this.seesPlayer && now - this.lastSeen < r.perceptionInterval * 2;

    if (sees) {
      if (this.state !== 'engage' && this.state !== 'cover') this.startEngage();
      if (this.state === 'cover' && (this.arrived || now > this.coverDeadline)) this.enterEngage();
      return;
    }
    if (this.state === 'engage' || this.state === 'cover') {
      // Hold and keep watching the last spot for a moment before moving on.
      if (playerAlive && now - this.lastSeen < r.loseSightTime) return;
      this.state = 'advance';
      this.fireTarget = null;
      this.lean.x = 0;
      this.lean.z = 0;
    }

    if (this.state === 'shootCore') {
      if (this.ctx.core.isAlive) return;
      this.state = 'advance';
      this.fireTarget = null;
    }
    if (this.state === 'shootWall') {
      const wall = this.breachWall();
      if (wall && this.path.breachWallId !== 0) return;
      this.state = 'advance';
      this.fireTarget = null;
    }

    // Advancing.
    this.state = 'advance';
    this.lookAt(null);
    this.followPath(r.speed);
    if (!this.hasPath) return;
    if (this.targetCheckTimer > 0) return;
    this.targetCheckTimer = TARGET_CHECK_INTERVAL;
    this.eye(this.eyePos);

    if (this.path.breachWallId === 0) {
      const core = this.ctx.core;
      if (core.isAlive && this.flatDistance(core.position) <= r.coreShootRange) {
        const clear = this.ctx.sight.look(this.eyePos, core.position, (c) => this.ctx.registry.hitboxOf(c)?.target === core);
        if (clear === null) this.targetCheckTimer = 0;
        else if (clear) this.startShooting('core', 'shootCore');
      }
      return;
    }

    const wall = this.breachWall();
    if (!wall) return;
    const near = this.arrived || this.flatDistance(wall.base) <= r.wallShootRange;
    if (!near) return;
    this.wallAimPoint(wall, 0, this.tmp);
    const clear = this.ctx.sight.look(this.eyePos, this.tmp, (c) => this.ctx.registry.hitboxOf(c)?.target === wall);
    if (clear === null) this.targetCheckTimer = 0;
    // Standing right at the wall, shoot it even if something small is in the way.
    else if (clear || this.arrived) this.startShooting('wall', 'shootWall');
  }

  protected override tick(dt: number): void {
    const r = config.rifleman;
    this.perceive(dt);
    this.targetCheckTimer -= dt;
    this.reaction -= dt;

    const firing = this.state === 'engage' || this.state === 'shootWall' || this.state === 'shootCore';
    if (firing || this.state === 'cover') {
      this.updateAimPoint();
      this.lookAt(this.aimPoint);
    }
    const raise = firing ? 1 : this.state === 'cover' ? 0.5 : 0;
    this.pose.aim += Math.max(-RAISE_RATE * dt, Math.min(RAISE_RATE * dt, raise - this.pose.aim));
    if (firing || this.state === 'cover') {
      this.eye(this.eyePos);
      const horizontal = Math.hypot(this.aimPoint.x - this.eyePos.x, this.aimPoint.z - this.eyePos.z);
      this.pose.aimPitch = Math.atan2(this.aimPoint.y - this.eyePos.y, Math.max(0.5, horizontal));
    } else {
      this.pose.aimPitch *= Math.max(0, 1 - dt * 4);
    }
    if (!firing) return;

    this.aimTime += dt;
    if (this.reaction > 0 || Math.abs(this.lookError()) > FIRE_CONE || this.pose.aim < 0.8) return;
    if (this.burstLeft > 0) {
      this.shotTimer -= dt;
      if (this.shotTimer <= 0) {
        this.fire();
        this.burstLeft--;
        this.shotTimer += r.fireInterval;
        if (this.burstLeft === 0) this.pauseTimer = MathUtils.randFloat(r.burstPauseMin, r.burstPauseMax);
      }
    } else {
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) {
        this.burstLeft = MathUtils.randInt(r.burstMin, r.burstMax);
        this.shotTimer = 0;
        this.wallOffset = (Math.random() * 2 - 1) * 0.7;
      }
    }
  }

  /** Every `perceptionInterval`, a budgeted sight line from the eyes to the player's head. */
  private perceive(dt: number): void {
    const r = config.rifleman;
    this.perceptionTimer -= dt;
    if (this.perceptionTimer > 0) return;
    const player = this.ctx.player;
    if (!player.damageable.isAlive) {
      this.seesPlayer = false;
      this.perceptionTimer = r.perceptionInterval;
      return;
    }
    this.playerHead(this.headPos);
    this.eye(this.eyePos);
    if (this.eyePos.distanceToSquared(this.headPos) > r.sightRange * r.sightRange) {
      this.seesPlayer = false;
      this.perceptionTimer = r.perceptionInterval;
      return;
    }
    const clear = this.ctx.sight.look(this.eyePos, this.headPos, (c) => c.handle === player.colliderHandle);
    if (clear === null) return; // over budget: try again next frame
    this.seesPlayer = clear;
    if (clear) this.lastSeen = this.ctx.now();
    this.perceptionTimer = r.perceptionInterval;
  }

  private playerHead(out: Vector3): Vector3 {
    const p = this.ctx.player;
    const eye = p.crouching ? config.player.crouchEyeHeight : config.player.standEyeHeight;
    return out.set(p.position.x, p.position.y + eye, p.position.z);
  }

  /** Spotted the player: call it out, then take cover nearby if there is any, else stop and fight here. */
  private startEngage(): void {
    this.fireTarget = 'player';
    this.reaction = config.rifleman.reactionTime;
    this.aimTime = 0;
    this.burstLeft = 0;
    this.pauseTimer = 0;
    this.eye(this.eyePos);
    this.ctx.events.emit('enemyCallout', { line: 'contact', position: this.eyePos });
    this.updateAimPoint();
    this.coverLeanX = 0;
    this.coverLeanZ = 0;
    this.coverPoint.set(Infinity, 0, Infinity);
    if (this.findCover(this.coverPoint)) {
      this.state = 'cover';
      this.coverDeadline = this.ctx.now() + COVER_TIMEOUT;
      this.moveTo(this.coverPoint, config.rifleman.speed);
    } else {
      this.enterEngage();
    }
  }

  private enterEngage(): void {
    this.state = 'engage';
    this.stop();
    // Lean out only if it made it to its cover spot.
    const atCover = this.flatDistance(this.coverPoint) < 0.8;
    this.lean.x = atCover ? this.coverLeanX : 0;
    this.lean.z = atCover ? this.coverLeanZ : 0;
  }

  private startShooting(target: Exclude<FireTarget, null>, state: 'shootWall' | 'shootCore'): void {
    this.state = state;
    this.fireTarget = target;
    this.stop();
    this.reaction = config.rifleman.reactionTime;
    this.aimTime = 0;
    this.burstLeft = 0;
    this.pauseTimer = 0;
    this.updateAimPoint();
  }

  private breachWall(): Structure | undefined {
    const id = this.breachWallId;
    return id ? this.ctx.wall(id) : undefined;
  }

  /** A point on the wall at aim height, `offset` meters along it from the middle. */
  private wallAimPoint(wall: Structure, offset: number, out: Vector3): Vector3 {
    return out.set(
      wall.base.x + Math.cos(wall.yaw) * offset,
      WALL_AIM_HEIGHT,
      wall.base.z - Math.sin(wall.yaw) * offset,
    );
  }

  private updateAimPoint(): void {
    switch (this.fireTarget) {
      case 'player':
        this.playerHead(this.aimPoint).y -= CHEST_DROP;
        break;
      case 'core':
        this.aimPoint.copy(this.ctx.core.position);
        break;
      case 'wall': {
        const wall = this.breachWall();
        if (wall) this.wallAimPoint(wall, this.wallOffset, this.aimPoint);
        break;
      }
      case null:
        break;
    }
  }

  /**
   * Look for cover within `coverSearchRadius`. For each of the nearest solid things (rubble, rocks, walls),
   * up to three spots on its far side from the player: straight behind its middle (good behind low rubble,
   * shooting over it) and at its left and right edges (leaning out from tall rocks and walls). The nearest
   * spot that has room to stand, can be walked to in a straight line, is shielded low down and can still see
   * the player's head wins.
   */
  private findCover(out: Vector3): boolean {
    const sight = this.ctx.sight;
    if (!sight.has(COVER_RAYS)) return false;
    const world = this.ctx.world;
    const feet = this.currFeet;
    this.nearby.length = 0;
    world.intersectionsWithShape(
      { x: feet.x, y: 0.8, z: feet.z },
      IDENTITY_ROTATION,
      this.coverBall,
      (collider) => {
        if (collider.shapeType() !== RAPIER.ShapeType.HalfSpace) this.nearby.push(collider);
        return this.nearby.length < 8;
      },
      RAPIER.QueryFilterFlags.ONLY_FIXED,
      Groups.groundQuery,
    );
    if (this.nearby.length === 0) return false;

    const player = this.ctx.player.position;
    this.playerHead(this.headPos);
    const probe = { x: feet.x, y: COVER_RAY_HEIGHT, z: feet.z };
    const fromPlayer = { x: player.x, y: COVER_RAY_HEIGHT, z: player.z };
    const spots: CoverSpot[] = [];
    // The two nearest obstacles.
    const nearest = this.nearby
      .map((collider) => {
        const projection = collider.projectPoint(probe, true);
        return projection ? { collider, x: projection.point.x, z: projection.point.z, d: Math.hypot(projection.point.x - feet.x, projection.point.z - feet.z) } : null;
      })
      .filter((p): p is { collider: RAPIER.Collider; x: number; z: number; d: number } => p !== null)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);

    for (const p of nearest) {
      // A line from the player through the obstacle: between its point nearest the rifleman and its point
      // nearest the player, so it goes through the middle rather than grazing an edge.
      const near = p.collider.projectPoint(fromPlayer, true);
      if (!near) continue;
      const mx = (p.x + near.point.x) / 2;
      const mz = (p.z + near.point.z) / 2;
      let ax = mx - player.x;
      let az = mz - player.z;
      const length = Math.hypot(ax, az);
      if (length < 1e-3) continue;
      ax /= length;
      az /= length;
      // Across the line, for the edges.
      const px = -az;
      const pz = ax;
      const behind = this.farFace(p.collider, mx, mz, ax, az);
      if (behind === null) continue;
      // Straight behind the middle: shielded low down, shooting over the top (rubble, low rocks).
      this.addSpot(spots, {
        x: mx + ax * (behind + COVER_GAP), z: mz + az * (behind + COVER_GAP), d: 0,
        leanX: 0, leanZ: 0, shieldX: 0, shieldZ: 0, shieldY: COVER_RAY_HEIGHT,
      });
      for (const side of [1, -1]) {
        // Step sideways until the line misses the obstacle at every height: the last hit is its outline.
        let lastHit = 0;
        let lastBehind = behind;
        let lastHeight = COVER_RAY_HEIGHT;
        for (let s = COVER_EDGE_STEP; s <= COVER_EDGE_MAX; s += COVER_EDGE_STEP) {
          const back = this.farFace(p.collider, mx + px * s * side, mz + pz * s * side, ax, az);
          if (back === null) break;
          lastHit = s;
          lastBehind = back;
          lastHeight = this.faceHeight;
        }
        if (lastHit === 0) continue;
        // Just clear of the outline at its edge, leaning out a little to shoot. The shield test starts just
        // inside the outline, at the height where the outline reaches out that far: that side of the body is covered.
        const out = lastHit + COVER_EDGE_CLEAR;
        const ox = px * side;
        const oz = pz * side;
        this.addSpot(spots, {
          x: mx + ox * out + ax * (lastBehind + COVER_GAP), z: mz + oz * out + az * (lastBehind + COVER_GAP), d: 0,
          leanX: ox * COVER_LEAN, leanZ: oz * COVER_LEAN,
          shieldX: -ox * (COVER_EDGE_CLEAR + COVER_EDGE_INSIDE), shieldZ: -oz * (COVER_EDGE_CLEAR + COVER_EDGE_INSIDE), shieldY: lastHeight,
        });
      }
    }

    spots.sort((a, b) => a.d - b.d);
    const cell = { i: 0, j: 0 };
    for (const spot of spots) {
      if (spot.d > config.rifleman.coverSearchRadius + 1.5) continue;
      // Room to stand there? (The walking grid is too coarse: a rock's cells cover the ground right behind it.)
      if (!this.ctx.grid.cellAt(spot.x, spot.z, cell)) continue;
      if (world.intersectionWithShape(
        { x: spot.x, y: config.enemies.height / 2 + 0.05, z: spot.z },
        IDENTITY_ROTATION,
        this.standProbe,
        RAPIER.QueryFilterFlags.ONLY_FIXED,
        Groups.groundQuery,
      )) continue;
      if (!sight.has(3)) return false;
      // Can it walk there in a straight line (knee height clears wall lips, not walls or rocks)?
      if (spot.d > 0.2) {
        this.direction.set(spot.x - feet.x, 0, spot.z - feet.z).normalize();
        const free = sight.distance(this.tmp2.set(feet.x, 0.5, feet.z), this.direction, spot.d);
        if (free === null || free < spot.d - 0.1) continue;
      }
      // Is (part of) the body shielded toward the player?
      const sx = spot.x + spot.shieldX;
      const sz = spot.z + spot.shieldZ;
      this.direction.set(player.x - sx, 0, player.z - sz).normalize();
      const shield = sight.distance(this.tmp2.set(sx, spot.shieldY, sz), this.direction, COVER_SHIELD_DISTANCE);
      if (shield === null || shield >= COVER_SHIELD_DISTANCE) continue;
      // Can it still see the player from there?
      const sees = sight.look(this.tmp2.set(spot.x + spot.leanX, config.enemies.eyeHeight, spot.z + spot.leanZ), this.headPos, (c) => c.handle === this.ctx.player.colliderHandle);
      if (!sees) continue;
      out.set(spot.x, 0, spot.z);
      this.coverLeanX = spot.leanX;
      this.coverLeanZ = spot.leanZ;
      return true;
    }
    return false;
  }

  /**
   * Distance from (x, z) to the obstacle's face on the far side from the player, along the unit direction
   * (ax, az) pointing away from the player, at whichever body height it reaches farthest back; null if that
   * line misses it at every height. Casts back toward the player from beyond the obstacle, against this
   * one collider only (a shape test, not a world query).
   */
  private farFace(collider: RAPIER.Collider, x: number, z: number, ax: number, az: number): number | null {
    let best: number | null = null;
    for (const y of COVER_SCAN_HEIGHTS) {
      this.coverRay.origin = { x: x + ax * COVER_BACKCAST, y, z: z + az * COVER_BACKCAST };
      this.coverRay.dir = { x: -ax, y: 0, z: -az };
      const toi = collider.castRay(this.coverRay, COVER_BACKCAST * 2, true);
      if (toi >= 0 && (best === null || COVER_BACKCAST - toi > best)) {
        best = COVER_BACKCAST - toi;
        this.faceHeight = y;
      }
    }
    return best;
  }

  private addSpot(spots: CoverSpot[], spot: CoverSpot): void {
    spot.d = Math.hypot(spot.x - this.currFeet.x, spot.z - this.currFeet.z);
    spots.push(spot);
  }

  /** One hitscan round at the aim point, inside the current spread cone. */
  private fire(): void {
    const r = config.rifleman;
    const ctx = this.ctx;
    this.eye(this.eyePos);
    const toTarget = this.tmp.copy(this.aimPoint).sub(this.eyePos);
    const distance = toTarget.length();
    const forward = toTarget.normalize();

    // Spread: tightens with time on target, widens with range and a moving player.
    const s = r.spread;
    let spread = MathUtils.lerp(s.initial, s.aimed, Math.min(1, this.aimTime / s.tightenTime));
    spread += (s.perTenMeters * distance) / 10;
    if (this.fireTarget === 'player') {
      const v = ctx.player.velocity;
      spread += s.targetMoving * (Math.hypot(v.x, v.z) / config.player.walkSpeed);
    }
    this.right.crossVectors(forward, this.up.set(0, 1, 0));
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    this.up.crossVectors(this.right, forward).normalize();
    const offset = Math.tan(deg(spread)) * Math.sqrt(Math.random());
    const angle = Math.random() * Math.PI * 2;
    this.direction
      .copy(forward)
      .addScaledVector(this.right, Math.cos(angle) * offset)
      .addScaledVector(this.up, Math.sin(angle) * offset)
      .normalize();

    this.ray.origin = { x: this.eyePos.x, y: this.eyePos.y, z: this.eyePos.z };
    this.ray.dir = { x: this.direction.x, y: this.direction.y, z: this.direction.z };
    const hit = ctx.world.castRayAndGetNormal(this.ray, r.range, true, undefined, Groups.enemySight);
    this.rig.muzzle(this.muzzle);
    this.pose.recoil = 1;

    if (!hit) {
      this.end.copy(this.eyePos).addScaledVector(this.direction, r.range);
      ctx.events.emit('enemyFired', { type: this.type, muzzle: this.muzzle, end: this.end });
      return;
    }
    this.end.copy(this.eyePos).addScaledVector(this.direction, hit.timeOfImpact);
    ctx.events.emit('enemyFired', { type: this.type, muzzle: this.muzzle, end: this.end });

    if (hit.collider.handle === ctx.player.colliderHandle) {
      // Armor plates absorb it first. The hit comes from the eyes (where the shot was aimed from), for the HUD's
      // damage direction and the camera jolt; `attacker` lets repeat hits from this rifleman share one indicator.
      applyDamage(ctx.player.damageable, r.damage, 'ballistic', this.eyePos, { source: 'enemy', attacker: this });
      return;
    }
    const hitbox = ctx.registry.hitboxOf(hit.collider);
    let surface: ImpactSurface;
    if (hitbox) surface = hitbox.target.impactSurface ?? 'target';
    else surface = hit.collider.shapeType() === RAPIER.ShapeType.HalfSpace ? 'dirt' : 'hard';
    this.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    ctx.events.emit('bulletImpact', { point: this.end, normal: this.normal, surface });
    if (hitbox) applyDamage(hitbox.target, r.damage, 'ballistic', this.end, { source: 'enemy' });
  }
}
