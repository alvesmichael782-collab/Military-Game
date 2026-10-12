import RAPIER from '@dimforge/rapier3d-compat';
import type { Vector3 } from 'three';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';

/** End a sight line this far short of its target, so the target's own surface never counts as blocking. */
const END_MARGIN = 0.05;

/**
 * Line-of-sight raycasts for every enemy, limited to `config.enemies.losBudgetPerFrame` per rendered frame.
 * A look over budget returns null and the enemy tries again next frame. Sight lines hit world geometry and
 * the player; they pass through other enemies and through breach holes (whose blockers only stop walkers).
 */
export class SightBudget {
  private remaining = 0;
  private checks = 0;
  private _lastFrameChecks = 0;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  constructor(private readonly world: RAPIER.World) {}

  /** Sight checks made during the last full frame, for the debug overlay. */
  get lastFrameChecks(): number {
    return this._lastFrameChecks;
  }

  /** Start a new frame's budget. */
  beginFrame(): void {
    this._lastFrameChecks = this.checks;
    this.checks = 0;
    this.remaining = config.enemies.losBudgetPerFrame;
  }

  /** True if `count` more checks fit in this frame's budget. */
  has(count = 1): boolean {
    return this.remaining >= count;
  }

  /**
   * Is the line from `from` to `to` clear? A hit on a collider that `accept` approves (the thing being
   * looked at) counts as clear. Returns null when the frame's budget is spent.
   */
  look(from: Vector3, to: Vector3, accept?: (collider: RAPIER.Collider) => boolean): boolean | null {
    if (this.remaining <= 0) return null;
    this.remaining--;
    this.checks++;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1e-3) return true;
    this.ray.origin = { x: from.x, y: from.y, z: from.z };
    this.ray.dir = { x: dx / distance, y: dy / distance, z: dz / distance };
    const hit = this.world.castRay(this.ray, Math.max(0, distance - END_MARGIN), true, undefined, Groups.enemySight);
    if (!hit) return true;
    return accept ? accept(hit.collider) : false;
  }

  /**
   * How far a ray from `from` along the unit vector `dir` travels before it hits world geometry (not the player),
   * up to `maxDistance`. Counts against the budget; null when it is spent.
   */
  distance(from: Vector3, dir: Vector3, maxDistance: number): number | null {
    if (this.remaining <= 0) return null;
    this.remaining--;
    this.checks++;
    this.ray.origin = { x: from.x, y: from.y, z: from.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRay(this.ray, maxDistance, true, undefined, Groups.groundQuery);
    return hit ? hit.timeOfImpact : maxDistance;
  }
}
