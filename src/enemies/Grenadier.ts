import { MathUtils, Vector3 } from 'three';
import { config } from '../core/config';
import type { Cell } from '../world/BuildGrid';
import type { PlayerTarget } from './EnemyContext';
import { Rifleman } from './Rifleman';

/** Seconds the last throw's arc stays in the F4 debug view. */
const ARC_SHOW_TIME = 2.5;
/** How quickly the rifle drops to the hip for the throw (0..1 per second). */
const LOWER_RATE = 6;

/**
 * Grenadier: a rifleman (the same advance, cover, perception and bursts, with a worse aim) with a bandolier of
 * frags, there to punish players who hide behind walls. When a player 12-35 m away is out of its sight or standing
 * near walls, it stops, shouts and winds up an overhand throw (the players' warning), then lobs a frag on an arc
 * worked out to land at them, give or take its inaccuracy. In co-op it aims at the middle of the biggest group.
 * Throws are a few seconds apart and it carries a handful. Its grenades come from the shared pool with source
 * 'enemy', so they hurt players, walls, structures and other enemies, and reach the other players like any grenade.
 */
export class Grenadier extends Rifleman {
  override readonly type = 'grenadier';
  override readonly maxHp: number = config.grenadier.hp;
  protected override readonly speed: number = config.grenadier.speed;
  protected override readonly spreadMultiplier: number = config.grenadier.spreadMultiplier;

  /** Where the current (or last) throw aims and is planned to land, its release point and launch velocity, for the debug view. */
  readonly throwAim = new Vector3();
  readonly throwLanding = new Vector3();
  readonly throwFrom = new Vector3();
  readonly throwVelocity = new Vector3();
  /** The debug view shows the throw arc until this time (`ctx.now()`); the wind-up shows the aim only. */
  arcShownUntil = -Infinity;

  private grenadesLeft = 0;
  private cooldown = 0;
  private checkTimer = 0;
  private throwTime = 0;
  private released = false;
  /** It was fighting a player it can see when it started the throw: it goes back to that afterwards. */
  private resumeEngage = false;
  private readonly head = new Vector3();
  private readonly cell: Cell = { i: 0, j: 0 };

  /** True while winding up or throwing. */
  get throwing(): boolean {
    return this.state === 'throw';
  }

  /** The grenade has left the hand: the debug view draws its arc for a moment. */
  get showArc(): boolean {
    return this.ctx.now() < this.arcShownUntil;
  }

  protected override onSpawn(): void {
    super.onSpawn();
    const g = config.grenadier;
    this.pose.bandolier = true;
    this.pose.grenade = false;
    this.pose.throwing = 0;
    this.grenadesLeft = g.grenades;
    // The first throw can come a little sooner than the gap between throws.
    this.cooldown = MathUtils.randFloat(g.cooldownMin * 0.4, g.cooldownMin * 0.7);
    this.checkTimer = Math.random() * g.checkInterval;
    this.arcShownUntil = -Infinity;
  }

  protected override onDeath(): void {
    this.pose.grenade = false;
    this.pose.throwing = 0;
  }

  override think(): void {
    if (!this.isAlive || this.state === 'throw') return;
    super.think();
    if (this.grenadesLeft > 0 && this.cooldown <= 0 && this.checkTimer <= 0) {
      this.checkTimer = config.grenadier.checkInterval;
      this.tryThrow();
    }
  }

  protected override tick(dt: number): void {
    this.cooldown -= dt;
    this.checkTimer -= dt;
    if (this.state !== 'throw') {
      super.tick(dt);
      return;
    }
    const g = config.grenadier;
    this.throwTime += dt;
    this.pose.aim = Math.max(0, this.pose.aim - LOWER_RATE * dt);
    this.pose.aimPitch *= Math.max(0, 1 - dt * 4);
    if (!this.released) {
      this.pose.throwing = Math.min(1, this.throwTime / g.windupTime);
      if (this.throwTime >= g.windupTime) this.releaseGrenade();
      return;
    }
    this.pose.throwing = 1 + (this.throwTime - g.windupTime) / g.followThroughTime;
    if (this.pose.throwing < 2) return;
    this.pose.throwing = 0;
    if (this.resumeEngage) {
      this.state = 'engage';
    } else {
      this.state = 'advance';
      this.fireTarget = null;
      this.lookAt(null);
    }
  }

  /** Someone worth a grenade? Start the wind-up at them (or at the middle of their group). */
  private tryThrow(): void {
    const g = config.grenadier;
    const now = this.ctx.now();
    this.eye(this.eyePos);
    let best: PlayerTarget | null = null;
    let bestGroup = 0;
    let bestDistance = Infinity;
    for (const p of this.ctx.players) {
      if (!p.damageable.isAlive) continue;
      const d = this.flatDistance(p.position);
      if (d < g.throwMinRange || d > g.throwMaxRange) continue;
      if (!this.nearWalls(p.position) && this.canSee(p, now) !== false) continue;
      let group = 0;
      for (const other of this.ctx.players) {
        if (other.damageable.isAlive && other.position.distanceTo(p.position) <= g.groupRadius) group++;
      }
      if (group > bestGroup || (group === bestGroup && d < bestDistance)) {
        best = p;
        bestGroup = group;
        bestDistance = d;
      }
    }
    if (!best) return;

    // The middle of the group around that player.
    this.throwAim.set(0, 0, 0);
    let count = 0;
    for (const other of this.ctx.players) {
      if (!other.damageable.isAlive || other.position.distanceTo(best.position) > g.groupRadius) continue;
      this.throwAim.add(other.position);
      count++;
    }
    this.throwAim.divideScalar(Math.max(1, count));
    const miss = g.inaccuracy.base + (g.inaccuracy.perTenMeters * this.flatDistance(this.throwAim)) / 10;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * miss;
    this.throwLanding.set(this.throwAim.x + Math.cos(angle) * r, this.throwAim.y, this.throwAim.z + Math.sin(angle) * r);

    this.resumeEngage = this.state === 'engage' && this.fireTarget === 'player';
    this.state = 'throw';
    this.stop();
    this.lookAt(this.throwLanding);
    this.lean.x = 0;
    this.lean.z = 0;
    this.throwTime = 0;
    this.released = false;
    this.pose.grenade = true;
    this.pose.throwing = 0;
    this.ctx.events.emit('enemyCallout', { line: 'grenade', position: this.eyePos });
  }

  /** Is `p` in clear sight? Its own target uses the rifleman's perception; others take a budgeted sight line (null: over budget). */
  private canSee(p: PlayerTarget, now: number): boolean | null {
    if (p === this.target) return this.seesPlayer && now - this.lastSeen < config.rifleman.perceptionInterval * 2;
    this.playerHeadOf(p, this.head);
    return this.ctx.sight.look(this.eyePos, this.head, (c) => c.handle === p.colliderHandle);
  }

  private playerHeadOf(p: PlayerTarget, out: Vector3): Vector3 {
    const eye = p.crouching ? config.player.crouchEyeHeight : config.player.standEyeHeight;
    return out.set(p.position.x, p.position.y + eye, p.position.z);
  }

  /** A standing wall ends within `nearWallDistance` (plus half a wall) of `point`? */
  private nearWalls(point: Vector3): boolean {
    const grid = this.ctx.grid;
    const reach = config.grenadier.nearWallDistance + config.build.cellSize / 2;
    const span = Math.ceil(reach / config.build.cellSize);
    grid.vertexNear(point.x, point.z, this.cell);
    for (let dj = -span; dj <= span; dj++) {
      for (let di = -span; di <= span; di++) {
        const i = this.cell.i + di;
        const j = this.cell.j + dj;
        if (i < 0 || j < 0 || i > grid.columns || j > grid.rows) continue;
        if (Math.hypot(grid.vertexX(i) - point.x, grid.vertexZ(j) - point.z) > reach) continue;
        if (grid.wallMaskAt(i, j) !== 0) return true;
      }
    }
    return false;
  }

  /** Let go: a frag from the right hand on a damped ballistic arc that comes down on the landing point. */
  private releaseGrenade(): void {
    const g = config.grenadier;
    this.released = true;
    this.pose.grenade = false;
    this.rig.handGrenade(this.throwFrom);
    const dx = this.throwLanding.x - this.throwFrom.x;
    const dy = this.throwLanding.y + config.grenade.bodyRadius - this.throwFrom.y;
    const dz = this.throwLanding.z - this.throwFrom.z;
    const t = g.flightTime.base + g.flightTime.perMeter * Math.hypot(dx, dz);
    launchVelocity(dx, dy, dz, t, this.throwVelocity);
    if (!this.ctx.grenades.throw(this.throwFrom, this.throwVelocity, 'enemy', false, t + g.fuseAfterLanding)) return;
    this.grenadesLeft--;
    this.cooldown = MathUtils.randFloat(g.cooldownMin, g.cooldownMax);
    this.arcShownUntil = this.ctx.now() + ARC_SHOW_TIME;
  }
}

/**
 * The launch velocity that carries a grenade (`dx`, `dy`, `dz`) in `time` seconds under gravity and the grenade body's
 * linear damping (velocity decays as e^(-c t)), into `out`.
 */
export function launchVelocity(dx: number, dy: number, dz: number, time: number, out: Vector3): Vector3 {
  const c = config.grenade.linearDamping;
  const g = -config.physics.gravity;
  const k = c > 1e-4 ? (1 - Math.exp(-c * time)) / c : time;
  const vy = c > 1e-4 ? (dy + (g * time) / c) / k - g / c : (dy + 0.5 * g * time * time) / time;
  return out.set(dx / k, vy, dz / k);
}
