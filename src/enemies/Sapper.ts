import { Vector3 } from 'three';
import { config } from '../core/config';
import { Enemy } from './Enemy';
import type { SatchelHandle } from './Satchels';

/** Seconds it will keep running back before it stops to wait for the blast anyway. */
const RETREAT_TIMEOUT = 4;
/** Seconds after the fuse should have run out before it stops waiting (the satchel pool was full). */
const WAIT_TIMEOUT = 1;
/** It starts planting this close to its kneeling spot, or this close to where the charge goes (the wall or core face), in meters. */
const PLANT_REACH = 0.4;
const FACE_REACH = 1;
/** Stuck (pressed against the wall, pushed by others) this close to where the charge goes, it plants there instead of re-planning, in meters. */
const STUCK_PLANT_REACH = 2;
/** Where it kneels in front of a wall, measured from the wall's center line, in meters. */
const WALL_APPROACH = 0.85;
/** Gap between the satchel and the face of the wall or core, in meters. */
const SATCHEL_GAP = 0.13;
/** Half the core's footprint, in meters (it is 2.4 m square). */
const CORE_HALF = 1.2;
/** How quickly it drops into the planting crouch and stands back up (0..1 per second). */
const CROUCH_RATE = 6;

/**
 * Sapper: no rifle, a big satchel charge on the chest and a red helmet band, so it reads as the priority
 * target. Sprints along its path to its breach wall (or, when there is an open way in, to the core), crouches
 * and plants a charge (vulnerable for `plantTime`), runs back about 8 m and waits for the blast, then goes
 * again with its next charge. Killed while still carrying a charge, it drops it where it falls, and it goes
 * off soon after: that can chain into other sappers and kill other enemies.
 */
export class Sapper extends Enemy {
  readonly type = 'sapper';
  readonly maxHp: number = config.sapper.hp;

  private charges = 0;
  private plantTimer = 0;
  private stateTimer = 0;
  private planted: SatchelHandle | null = null;
  /** The wall it last called out a breach on, so it only calls once per wall. */
  private calledWall = 0;
  private hasPlantSpot = false;
  private readonly approach = new Vector3();
  private readonly plantPoint = new Vector3();
  private readonly retreatPoint = new Vector3();
  private readonly tmp = new Vector3();

  protected override onSpawn(): void {
    this.charges = config.sapper.satchels;
    this.pose.armed = false;
    this.pose.satchel = true;
    this.pose.band = true;
    this.pose.fullSpeed = config.sapper.speed;
    this.pose.lean = 0.32;
    this.planted = null;
    this.calledWall = 0;
    this.hasPlantSpot = false;
  }

  /** A new route: work out where to kneel and where the charge goes, at the breach wall or at the core. */
  protected override onPathChanged(): void {
    this.hasPlantSpot = false;
    if (this.charges <= 0) return;
    const path = this.path;
    const grid = this.ctx.grid;
    if (path.breachWallId !== 0) {
      const mid = grid.edgeMidpoint(path.breachEdge, this.tmp);
      // The side of the wall the route arrives from.
      const before = path.breachIndex;
      const side = path.breachEdge.axis === 'x'
        ? Math.sign(path.zs[before] - mid.z) || 1
        : Math.sign(path.xs[before] - mid.x) || 1;
      const nx = path.breachEdge.axis === 'x' ? 0 : side;
      const nz = path.breachEdge.axis === 'x' ? side : 0;
      const w = config.structures.wall;
      this.approach.set(mid.x + nx * WALL_APPROACH, 0, mid.z + nz * WALL_APPROACH);
      const face = w.thickness / 2 + w.lipWidth + SATCHEL_GAP;
      this.plantPoint.set(mid.x + nx * face, 0, mid.z + nz * face);
      this.hasPlantSpot = true;
      if (this.calledWall !== path.breachWallId && this.state === 'advance') {
        this.calledWall = path.breachWallId;
        this.ctx.events.emit('enemyCallout', { line: 'breach', position: this.eye(this.tmp) });
      }
    } else if (path.reachesCore) {
      const core = this.ctx.core.base;
      const last = path.length - 1;
      let dx = path.xs[last] - core.x;
      let dz = path.zs[last] - core.z;
      const length = Math.hypot(dx, dz) || 1;
      dx /= length;
      dz /= length;
      this.approach.set(core.x + dx * (CORE_HALF + 0.6), 0, core.z + dz * (CORE_HALF + 0.6));
      this.plantPoint.set(core.x + dx * (CORE_HALF + SATCHEL_GAP + 0.1), 0, core.z + dz * (CORE_HALF + SATCHEL_GAP + 0.1));
      this.hasPlantSpot = true;
    }
  }

  think(): void {
    if (!this.isAlive) return;
    const s = config.sapper;
    switch (this.state) {
      case 'advance':
      case 'loiter': {
        if (this.charges <= 0) this.state = 'loiter';
        this.lookAt(null);
        if (!this.hasPath) {
          this.stop();
          return;
        }
        if (this.state === 'loiter' || !this.hasPlantSpot) {
          this.followPath(s.speed);
          return;
        }
        // Run the route to its last walkable waypoint, then straight to the kneeling spot.
        const routeDone = this.pathIndex >= this.stopIndex && (this.arrived || this.moveMode === 'point');
        if (!routeDone && this.flatDistance(this.approach) > 2.5) {
          this.followPath(s.speed);
          return;
        }
        this.moveTo(this.approach, s.speed);
        if (this.flatDistance(this.approach) <= PLANT_REACH || this.flatDistance(this.plantPoint) <= FACE_REACH) this.startPlant();
        return;
      }
      case 'retreat':
        if (this.arrived || this.stateTimer > RETREAT_TIMEOUT) {
          this.state = 'wait';
          this.stateTimer = 0;
          this.stop();
          this.lookAt(this.plantPoint);
        }
        return;
      case 'wait':
        if (!this.ctx.satchels.isArmed(this.planted) || this.stateTimer > config.satchel.fuse + WAIT_TIMEOUT) {
          this.planted = null;
          this.state = this.charges > 0 ? 'advance' : 'loiter';
          this.lookAt(null);
          this.ctx.requestPath(this);
        }
        return;
      default:
        return;
    }
  }

  protected override tick(dt: number): void {
    this.stateTimer += dt;
    this.setCrouch(this.state === 'plant' ? 1 : 0, dt, CROUCH_RATE);
    if (this.state !== 'plant') return;
    this.plantTimer -= dt;
    if (this.plantTimer > 0) return;

    // Charge set: leave it at the wall (or core) and run back the way it came.
    this.planted = this.ctx.satchels.arm(this.plantPoint, this.yaw, config.satchel.fuse, false);
    this.charges--;
    this.pose.satchel = this.charges > 0;
    this.ctx.events.emit('enemyCallout', { line: 'chargeSet', position: this.eye(this.tmp) });
    this.findRetreatPoint(this.retreatPoint);
    this.state = 'retreat';
    this.stateTimer = 0;
    this.lookAt(null);
    this.moveTo(this.retreatPoint, config.sapper.speed);
  }

  protected override onDeath(): void {
    // Dead before planting (or with charges left): the satchel drops and arms where the body falls.
    if (this.charges > 0 && !this.quietDeath) {
      this.ctx.satchels.arm(this.currFeet, this.yaw, config.satchel.droppedFuse, true);
    }
    this.charges = 0;
    this.pose.satchel = false;
  }

  protected override onStuck(): void {
    if (this.state === 'retreat') {
      this.stateTimer = RETREAT_TIMEOUT + 1;
      return;
    }
    // Held up right next to its target: plant here. The charge still goes at the face, where it was worked out.
    if (this.state === 'advance' && this.hasPlantSpot && this.charges > 0 && this.flatDistance(this.plantPoint) <= STUCK_PLANT_REACH) {
      this.startPlant();
      return;
    }
    super.onStuck();
  }

  private startPlant(): void {
    this.state = 'plant';
    this.plantTimer = config.sapper.plantTime;
    this.stop();
    this.lookAt(this.plantPoint);
  }

  /** About `retreatDistance` meters back along the route it came in on. */
  private findRetreatPoint(out: Vector3): void {
    let remaining = config.sapper.retreatDistance;
    let fromX = this.currFeet.x;
    let fromZ = this.currFeet.z;
    const xs = this.path.xs;
    const zs = this.path.zs;
    for (let k = Math.min(this.stopIndex, xs.length - 1); k >= 0; k--) {
      const segment = Math.hypot(xs[k] - fromX, zs[k] - fromZ);
      if (segment >= remaining) {
        const t = remaining / segment;
        out.set(fromX + (xs[k] - fromX) * t, 0, fromZ + (zs[k] - fromZ) * t);
        return;
      }
      remaining -= segment;
      fromX = xs[k];
      fromZ = zs[k];
    }
    out.set(fromX, 0, fromZ);
  }
}
