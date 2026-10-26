import { MathUtils, Vector3 } from 'three';
import type { Structure } from '../build/Structure';
import { config } from '../core/config';
import type { Cell } from '../world/BuildGrid';
import { Enemy, type EnemyState } from './Enemy';
import type { EnemyContext, PlayerTarget } from './EnemyContext';
import { fireEnemyRound, spreadDirection } from './EnemyGunfire';

/** How quickly it kneels and stands (0..1 per second). */
const CROUCH_RATE = 2.5;
/** Seconds before each shell it reaches up to drop the round in. */
const LOAD_TIME = 0.6;
/** Seconds from finishing the setup to its first shell. */
const FIRST_SHELL_DELAY = 1.5;
/** It counts as at its firing spot this close, in meters. */
const SPOT_REACH = 1.2;
/** New firing spots it tries when the route to one cannot get there. */
const SPOT_RETRIES = 3;
/** Seconds between sight checks on the player it defends itself from. */
const DEFEND_SIGHT_INTERVAL = 0.2;
/** How quickly the pistol comes up (0..1 per second). */
const RAISE_RATE = 5;
/** A player aimed at by the mortar this far outside the build radius still draws its fire, in meters. */
const PLAYER_TARGET_SLACK = 6;
/** Aim this far below the player's eyes, in meters. */
const CHEST_DROP = 0.4;

/** What the shells are walking in on. */
type TargetKind = 'player' | 'gear' | 'core' | 'random';

/** Every mortar team in the pool, so two never pick firing spots on top of each other. */
const teams: MortarTeam[] = [];

/**
 * Mortar team: one soldier with a mortar on its back. It walks (by its own route, never breaching) to a firing
 * spot 45-70 m from the core, outside the build radius on the side it came from, next to rocks, props or ruins
 * when it can find one. There it kneels and sets the mortar up with an ammo crate beside it, calls it out, and
 * shells the inside of the base every few seconds: targets weighted toward players, then the MG nest and
 * crates, then the core, with each series walking in from about 6 m off to about 2.5 m. A player who comes
 * within 12 m makes it stand and fight with a weak pistol until they back off.
 */
export class MortarTeam extends Enemy {
  readonly type = 'mortar';
  readonly maxHp: number = config.mortar.hp;

  /** Where it fires from, once chosen. */
  readonly firePosition = new Vector3();
  hasFirePosition = false;
  /** What the shells are walking in on, and how far off the next one may land, in meters (debug view). */
  readonly target = new Vector3();
  hasTarget = false;
  nextError = 0;

  private setupTime = 0;
  private fireTimer = 0;
  private shotIndex = 0;
  private shotsLeft = 0;
  private targetKind: TargetKind = 'core';
  private targetPlayer: PlayerTarget | null = null;
  /** Each series misses toward one side, closer every shot. */
  private missAngle = 0;
  private spotRetries = 0;
  private calledSetup = false;
  /** Where it was before a player came close: it goes back to that. */
  private resumeState: EnemyState = 'advance';
  private defendTarget: PlayerTarget | null = null;
  private seesDefendTarget = false;
  private sightTimer = 0;
  private reaction = 0;
  private shotTimer = 0;
  private readonly eyePos = new Vector3();
  private readonly aim = new Vector3();
  private readonly muzzle = new Vector3();
  private readonly impact = new Vector3();
  private readonly direction = new Vector3();
  private readonly cell: Cell = { i: 0, j: 0 };
  private readonly gear: Structure[] = [];

  constructor(slot: number, ctx: EnemyContext) {
    super(slot, ctx);
    teams.push(this);
  }

  /** The mortar is down and firing (or ready to). */
  get deployed(): boolean {
    return this.pose.mortarSet;
  }

  protected override onSpawn(): void {
    const p = this.pose;
    p.armed = false;
    p.satchel = false;
    p.band = false;
    p.bandolier = false;
    p.mortarPack = true;
    p.mortarSet = false;
    p.pistol = false;
    p.reach = 0;
    p.fullSpeed = config.mortar.speed;
    p.lean = 0.16;
    this.hasTarget = false;
    this.setupTime = 0;
    this.calledSetup = false;
    this.spotRetries = 0;
    this.defendTarget = null;
    this.chooseFirePosition();
  }

  protected override onDeath(): void {
    this.pose.pistol = false;
    this.pose.reach = 0;
    this.hasFirePosition = false;
    this.hasTarget = false;
  }

  /** The route came back: if it cannot reach the firing spot, try another; out of tries, it fires from where the route ends. */
  protected override onPathChanged(): void {
    if (this.path.reachesGoal || this.state !== 'advance') return;
    if (this.spotRetries++ < SPOT_RETRIES) {
      this.chooseFirePosition();
      this.ctx.requestPath(this);
      return;
    }
    const last = this.path.length - 1;
    this.firePosition.set(this.path.xs[last], 0, this.path.zs[last]);
    this.path.setGoal(this.firePosition.x, this.firePosition.z);
  }

  think(): void {
    if (!this.isAlive) return;
    const m = config.mortar;
    const near = this.nearestPlayer();
    const distance = near ? this.flatDistance(near.position) : Infinity;
    if (this.state === 'defend') {
      if (distance > m.defendExitRange) this.leaveDefend();
      else this.defendTarget = near;
      return;
    }
    if (near && distance <= m.defendRange) {
      this.enterDefend(near);
      return;
    }
    if (this.state !== 'advance') return;
    this.lookAt(null);
    if (!this.hasPath) {
      this.stop();
      return;
    }
    this.followPath(m.speed);
    const atEnd = this.arrived && this.pathIndex >= this.stopIndex;
    if (atEnd || this.flatDistance(this.firePosition) <= SPOT_REACH) this.startSetup();
  }

  protected override tick(dt: number): void {
    switch (this.state) {
      case 'setup':
        this.tickSetup(dt);
        break;
      case 'shell':
        this.tickShell(dt);
        break;
      case 'defend':
        this.tickDefend(dt);
        break;
      default:
        this.setCrouch(0, dt, CROUCH_RATE);
        break;
    }
    if (this.state !== 'defend') {
      this.pose.aim = Math.max(0, this.pose.aim - RAISE_RATE * dt);
      this.pose.aimPitch *= Math.max(0, 1 - dt * 4);
    }
  }

  protected override onStuck(): void {
    // Held up close enough to the spot: set up here.
    if (this.state === 'advance' && this.flatDistance(this.firePosition) <= SPOT_REACH * 3) {
      this.startSetup();
      return;
    }
    super.onStuck();
  }

  // ---- Firing spot ----

  /**
   * Pick a walkable cell `minRange`-`maxRange` from the core, within `sideAngle` of the line out to where it spawned,
   * outside the build radius and clear of other mortar teams' spots. Spots with more blocked cells around them
   * (rocks, props, ruins) win. The route there decides whether it is reachable (see `onPathChanged`).
   */
  private chooseFirePosition(): void {
    const m = config.mortar;
    const grid = this.ctx.grid;
    const core = this.ctx.core.base;
    const out = Math.atan2(this.currFeet.z - core.z, this.currFeet.x - core.x);
    const side = MathUtils.degToRad(m.sideAngle);
    const coverCells = Math.ceil(m.coverRadius / config.build.cellSize);
    let bestScore = -Infinity;
    for (let n = 0; n < m.spotCandidates; n++) {
      const angle = out + MathUtils.randFloat(-side, side);
      const r = MathUtils.randFloat(m.minRange, m.maxRange);
      if (!grid.cellAt(core.x + Math.cos(angle) * r, core.z + Math.sin(angle) * r, this.cell)) continue;
      const { i, j } = this.cell;
      if (!grid.isWalkable(i, j) || grid.isInBuildRadius(i, j)) continue;
      const x = grid.centerX(i);
      const z = grid.centerZ(j);
      if (Math.hypot(x - core.x, z - core.z) <= config.build.buildRadius + config.build.cellSize) continue;
      if (this.tooCloseToOtherTeams(x, z)) continue;
      // Cover: blocked cells close by, but room to kneel (its own cell and the one toward the core open).
      let cover = 0;
      for (let dj = -coverCells; dj <= coverCells; dj++) {
        for (let di = -coverCells; di <= coverCells; di++) {
          if (Math.hypot(di, dj) * config.build.cellSize > m.coverRadius) continue;
          if (grid.contains(i + di, j + dj) && !grid.isWalkable(i + di, j + dj)) cover++;
        }
      }
      const score = Math.min(cover, 4) + Math.random() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        this.firePosition.set(x, 0, z);
      }
    }
    if (bestScore === -Infinity) {
      // Nothing fit: straight in toward the core, halfway through the range.
      const r = (m.minRange + m.maxRange) / 2;
      this.firePosition.set(core.x + Math.cos(out) * r, 0, core.z + Math.sin(out) * r);
    }
    this.hasFirePosition = true;
    this.path.setGoal(this.firePosition.x, this.firePosition.z);
  }

  private tooCloseToOtherTeams(x: number, z: number): boolean {
    const spacing = config.mortar.spotSpacing;
    for (const team of teams) {
      if (team === this || !team.isAlive || !team.hasFirePosition) continue;
      if (Math.hypot(team.firePosition.x - x, team.firePosition.z - z) < spacing) return true;
    }
    return false;
  }

  // ---- Setting up and shelling ----

  private startSetup(): void {
    this.state = 'setup';
    this.stop();
    // Face the base while setting up.
    this.lookAt(this.ctx.core.base);
  }

  private tickSetup(dt: number): void {
    const m = config.mortar;
    this.setCrouch(1, dt, CROUCH_RATE);
    this.setupTime += dt;
    // Halfway through, the mortar comes off the back and onto the ground.
    if (this.setupTime >= m.setupTime / 2) {
      this.pose.mortarPack = false;
      this.pose.mortarSet = true;
    }
    if (this.setupTime < m.setupTime) return;
    this.state = 'shell';
    this.fireTimer = FIRST_SHELL_DELAY;
    if (!this.calledSetup) {
      this.calledSetup = true;
      this.ctx.events.emit('enemyCallout', { line: 'mortarSetup', position: this.eye(this.eyePos) });
    }
  }

  private tickShell(dt: number): void {
    this.setCrouch(1, dt, CROUCH_RATE);
    if (!this.hasTarget || this.shotsLeft <= 0) this.pickTarget();
    this.updateTarget();
    this.lookAt(this.target);
    this.fireTimer -= dt;
    this.pose.reach = Math.min(1, Math.max(0, 1 - this.fireTimer / LOAD_TIME));
    if (this.fireTimer > 0) return;
    const m = config.mortar;
    this.fireShell();
    this.pose.reach = 0;
    this.pose.recoil = 1;
    this.fireTimer = MathUtils.randFloat(m.fireIntervalMin, m.fireIntervalMax);
  }

  /**
   * A new target, by weight: a player inside the build radius, the MG nest or a crate, the core, or a random point
   * inside the build radius. Kinds with nothing to aim at are skipped.
   */
  private pickTarget(): void {
    const m = config.mortar;
    const w = m.targetWeights;
    const core = this.ctx.core.base;
    const radius = config.build.buildRadius;
    let players = 0;
    for (const p of this.ctx.players) if (this.playerInBase(p)) players++;
    this.gear.length = 0;
    for (const s of this.ctx.structures()) if (s.type !== 'wall' && s.isAlive) this.gear.push(s);
    const weights = [players > 0 ? w.player : 0, this.gear.length > 0 ? w.gear : 0, this.ctx.core.isAlive ? w.core : 0, w.random];
    const kinds: TargetKind[] = ['player', 'gear', 'core', 'random'];
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    let k = 0;
    while (k < weights.length - 1 && roll >= weights[k]) roll -= weights[k++];
    this.targetKind = kinds[k];
    this.targetPlayer = null;
    switch (this.targetKind) {
      case 'player': {
        let pick = Math.floor(Math.random() * players);
        for (const p of this.ctx.players) {
          if (!this.playerInBase(p)) continue;
          if (pick-- === 0) this.targetPlayer = p;
        }
        break;
      }
      case 'gear': {
        const s = this.gear[Math.floor(Math.random() * this.gear.length)];
        this.target.set(s.base.x, 0, s.base.z);
        break;
      }
      case 'core':
        this.target.set(core.x, 0, core.z);
        break;
      case 'random': {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        this.target.set(core.x + Math.cos(a) * r, 0, core.z + Math.sin(a) * r);
        break;
      }
    }
    this.gear.length = 0;
    this.hasTarget = true;
    this.shotIndex = 0;
    this.shotsLeft = MathUtils.randInt(m.shotsPerTargetMin, m.shotsPerTargetMax);
    this.missAngle = Math.random() * Math.PI * 2;
    this.updateTarget();
  }

  /** A player target is followed while they stay in the base; the rest stay put. */
  private updateTarget(): void {
    const m = config.mortar;
    const p = this.targetPlayer;
    if (p && this.playerInBase(p)) this.target.set(p.position.x, 0, p.position.z);
    const t = m.walkInShots > 1 ? Math.min(1, this.shotIndex / (m.walkInShots - 1)) : 1;
    this.nextError = MathUtils.lerp(m.firstShotError, m.minError, t);
  }

  private playerInBase(p: PlayerTarget): boolean {
    const core = this.ctx.core.base;
    const reach = config.build.buildRadius + PLAYER_TARGET_SLACK;
    return p.damageable.isAlive && Math.hypot(p.position.x - core.x, p.position.z - core.z) <= reach;
  }

  /** One shell at the target, off by up to the current error toward this series' side, a little closer each shot. */
  private fireShell(): void {
    const m = config.mortar;
    this.updateTarget();
    const miss = this.nextError * MathUtils.randFloat(0.55, 1);
    const angle = this.missAngle + MathUtils.randFloat(-0.6, 0.6);
    const limit = config.map.size / 2 - 1;
    this.impact.set(
      MathUtils.clamp(this.target.x + Math.cos(angle) * miss, -limit, limit),
      0,
      MathUtils.clamp(this.target.z + Math.sin(angle) * miss, -limit, limit),
    );
    this.rig.mortarMuzzle(this.muzzle);
    const flight = m.shell.flightTime.base + m.shell.flightTime.perMeter * this.flatDistance(this.impact);
    if (!this.ctx.mortarShells.fire(this.muzzle, this.impact, flight)) return;
    this.shotIndex++;
    this.shotsLeft--;
  }

  // ---- Defending with the pistol ----

  private nearestPlayer(): PlayerTarget | null {
    let best: PlayerTarget | null = null;
    let bestDistance = Infinity;
    for (const p of this.ctx.players) {
      if (!p.damageable.isAlive) continue;
      const d = this.flatDistance(p.position);
      if (d < bestDistance) {
        bestDistance = d;
        best = p;
      }
    }
    return best;
  }

  private enterDefend(target: PlayerTarget): void {
    this.resumeState = this.state === 'setup' || this.state === 'shell' ? this.state : 'advance';
    this.state = 'defend';
    this.defendTarget = target;
    this.seesDefendTarget = false;
    this.sightTimer = 0;
    this.reaction = config.mortar.pistol.reactionTime;
    this.shotTimer = 0;
    this.stop();
    this.pose.pistol = true;
    this.pose.reach = 0;
  }

  private leaveDefend(): void {
    this.state = this.resumeState;
    this.defendTarget = null;
    this.pose.pistol = false;
    this.lookAt(this.state === 'advance' ? null : this.hasTarget ? this.target : this.ctx.core.base);
  }

  private tickDefend(dt: number): void {
    const pistol = config.mortar.pistol;
    this.setCrouch(0, dt, CROUCH_RATE * 2);
    const target = this.defendTarget;
    if (!target || !target.damageable.isAlive) return;
    this.chestOf(target, this.aim);
    this.lookAt(this.aim);
    this.eye(this.eyePos);
    const horizontal = Math.hypot(this.aim.x - this.eyePos.x, this.aim.z - this.eyePos.z);
    this.pose.aimPitch = Math.atan2(this.aim.y - this.eyePos.y, Math.max(0.5, horizontal));

    this.sightTimer -= dt;
    if (this.sightTimer <= 0) {
      this.chestOf(target, this.aim).y += CHEST_DROP;
      const clear = this.ctx.sight.look(this.eyePos, this.aim, (c) => c.handle === target.colliderHandle);
      if (clear !== null) {
        if (clear && !this.seesDefendTarget) this.reaction = pistol.reactionTime;
        this.seesDefendTarget = clear;
        this.sightTimer = DEFEND_SIGHT_INTERVAL;
      }
      this.chestOf(target, this.aim);
    }
    const raise = this.seesDefendTarget ? 1 : 0.3;
    this.pose.aim += Math.max(-RAISE_RATE * dt, Math.min(RAISE_RATE * dt, raise - this.pose.aim));
    this.reaction -= dt;
    this.shotTimer -= dt;
    if (!this.seesDefendTarget || this.reaction > 0 || this.shotTimer > 0 || this.pose.aim < 0.8 || Math.abs(this.lookError()) > 0.3) return;
    this.shotTimer = MathUtils.randFloat(pistol.fireIntervalMin, pistol.fireIntervalMax);
    const v = target.velocity;
    const spread = pistol.spread + pistol.targetMoving * (Math.hypot(v.x, v.z) / config.player.walkSpeed);
    this.direction.subVectors(this.aim, this.eyePos).normalize();
    spreadDirection(this.direction, spread, this.direction);
    this.rig.pistolMuzzle(this.muzzle);
    this.pose.recoil = 1;
    fireEnemyRound(this.ctx, this, this.eyePos, this.direction, pistol.range, pistol.damage, this.muzzle);
  }

  /** The player's chest, into `out`. */
  private chestOf(p: PlayerTarget, out: Vector3): Vector3 {
    const eye = p.crouching ? config.player.crouchEyeHeight : config.player.standEyeHeight;
    return out.set(p.position.x, p.position.y + eye - CHEST_DROP, p.position.z);
  }
}
