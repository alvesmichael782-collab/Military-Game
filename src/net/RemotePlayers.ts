import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Vector3, type PerspectiveCamera, type Scene } from 'three';
import { MgNest } from '../build/MgNest';
import type { Structure } from '../build/Structure';
import type { DamageInfo } from '../combat/Damage';
import type { Damageable } from '../combat/Damageable';
import type { DamageableRegistry } from '../combat/DamageableRegistry';
import type { DamageType } from '../combat/DamageType';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { AllyTag, EventBus, GameEvents } from '../core/EventBus';
import type { PlayerTarget } from '../enemies/EnemyContext';
import { SoldierRenderer } from '../enemies/SoldierRenderer';
import { createSoldierPose, SoldierRig } from '../enemies/SoldierRig';
import type { PlayerState } from './protocol';

/** Called on the host when an enemy shot or blast hits a teammate; the damage is dealt on their machine. */
export type AllyHurtHandler = (id: string, amount: number, type: DamageType, from: Vector3, attacker: object | undefined) => void;

const deg = MathUtils.degToRad;
/** Name tags float this far over the feet, in meters (lower while crouched). */
const TAG_HEIGHT = 2.1;
const TAG_HEIGHT_CROUCHED = 1.45;
/** How deep the soldier body crouches (its crouch pose goes down to a sapper's planting kneel). */
const CROUCH_POSE = 0.7;
const CROUCH_RATE = 5;
const RECOIL_DECAY = 9;
/** States kept for blending. */
const HISTORY = 6;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** What enemies hit when they hit a teammate. Their own team's shots and grenades pass (no friendly fire). */
class AllyBody implements Damageable {
  readonly kind = 'player';
  private readonly center = new Vector3();

  constructor(
    private readonly owner: RemotePlayer,
    private readonly onHurt: AllyHurtHandler,
  ) {}

  get position(): Vector3 {
    const feet = this.owner.position;
    return this.center.set(feet.x, feet.y + config.player.standHeight / 2, feet.z);
  }

  get isAlive(): boolean {
    return this.owner.alive;
  }

  takeDamage(amount: number, type: DamageType, from: Vector3, info: DamageInfo = {}): void {
    if (info.source === 'player') return;
    this.onHurt(this.owner.id, amount, type, from, info.attacker);
  }
}

/**
 * One teammate, as seen on this machine: drawn as a soldier in the team's blue-gray, `interpolationDelay`
 * behind their latest update so they move smoothly, with a capsule so players bump into each other and
 * (on the host) enemies can see and shoot them. Also an enemy target (`PlayerTarget`).
 */
export class RemotePlayer implements PlayerTarget {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  crouching = false;
  alive = true;
  sprinting = false;
  /** View, as FPSCamera's: yaw 0 looks down -Z, positive turns left; pitch positive looks up. */
  yaw = 0;
  pitch = 0;
  /** The MG nest they are on, or 0. */
  nestId = 0;
  readonly damageable: AllyBody;
  readonly rig = new SoldierRig();
  /** Their name tag, refreshed each frame. */
  readonly tag: AllyTag;
  private readonly pose = createSoldierPose();
  private readonly states: { time: number; s: PlayerState }[] = [];
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly lastFeet = new Vector3();
  private hasLast = false;
  private deadTime = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly slot: number,
    private readonly world: RAPIER.World,
    onHurt: AllyHurtHandler,
  ) {
    const p = config.player;
    this.damageable = new AllyBody(this, onHurt);
    this.tag = { id, name, x: 0, y: 0, visible: false, down: false };
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(p.standHeight / 2 - p.radius, p.radius).setTranslation(0, p.standHeight / 2, 0).setCollisionGroups(Groups.ally),
      this.body,
    );
    Object.assign(this.pose, { armed: true, satchel: false, band: false, fullSpeed: p.walkSpeed, lean: 0.08 });
  }

  get colliderHandle(): number {
    return this.collider.handle;
  }

  receive(state: PlayerState): void {
    this.states.push({ time: performance.now() / 1000, s: state });
    if (this.states.length > HISTORY) this.states.shift();
  }

  /** They fired: kick the rifle back. */
  onShot(): void {
    this.pose.recoil = 1;
  }

  /** Blend to this frame's moment, move the capsule and pose the body. False until their first update arrives. */
  update(dt: number): boolean {
    if (!this.blend()) return false;
    const feet = this.position;
    this.body.setNextKinematicTranslation(feet);
    this.collider.setEnabled(this.alive);

    const moved = this.hasLast ? Math.hypot(feet.x - this.lastFeet.x, feet.z - this.lastFeet.z) : 0;
    if (dt > 0) this.velocity.set((feet.x - this.lastFeet.x) / dt, 0, (feet.z - this.lastFeet.z) / dt);
    if (!this.hasLast) this.velocity.set(0, 0, 0);
    this.lastFeet.copy(feet);
    this.hasLast = true;

    const pose = this.pose;
    const speed = dt > 0 ? moved / dt : 0;
    pose.speed += (speed - pose.speed) * Math.min(1, dt * 10);
    pose.phase += (moved / config.enemies.stride) * Math.PI;
    pose.aim = this.sprinting ? 0 : 1;
    pose.aimPitch = this.pitch;
    const crouch = this.crouching ? CROUCH_POSE : 0;
    pose.crouch += Math.max(-CROUCH_RATE * dt, Math.min(CROUCH_RATE * dt, crouch - pose.crouch));
    pose.recoil = Math.max(0, pose.recoil - RECOIL_DECAY * dt);
    // The soldier faces +Z at yaw 0; the camera looks down -Z.
    const facing = this.yaw + Math.PI;
    if (this.alive) {
      this.deadTime = 0;
      pose.fall = 0;
    } else {
      this.deadTime += dt;
      pose.fall = Math.min(1, this.deadTime / config.enemies.fallTime);
      pose.fallX = -Math.sin(facing);
      pose.fallZ = -Math.cos(facing);
      pose.speed = 0;
    }
    this.rig.pose(feet, facing, pose);
    return true;
  }

  /** Where the name tag floats. */
  tagPoint(out: Vector3): Vector3 {
    const height = !this.alive ? 0.6 : this.crouching ? TAG_HEIGHT_CROUCHED : TAG_HEIGHT;
    return out.set(this.position.x, this.position.y + height, this.position.z);
  }

  dispose(): void {
    this.world.removeRigidBody(this.body);
  }

  /** Set the blended state for now. False before the first update has arrived. */
  private blend(): boolean {
    const states = this.states;
    if (states.length === 0) return false;
    const renderTime = performance.now() / 1000 - config.multiplayer.interpolationDelay;
    let older = states[0];
    let newer = older;
    for (let i = states.length - 1; i >= 0; i--) {
      if (states[i].time <= renderTime) {
        older = states[i];
        newer = states[Math.min(i + 1, states.length - 1)];
        break;
      }
    }
    const span = newer.time - older.time;
    const t = span > 1e-4 ? Math.min(1, Math.max(0, (renderTime - older.time) / span)) : 1;
    const a = older.s;
    const b = newer.s;
    this.position.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    this.yaw = a[3] + wrapAngle(b[3] - a[3]) * t;
    this.pitch = a[4] + (b[4] - a[4]) * t;
    this.crouching = b[5] === 1;
    this.alive = b[6] === 1;
    this.sprinting = b[7] === 1;
    this.nestId = b[8];
    return true;
  }
}

/**
 * Every teammate on this machine: their bodies (one soldier renderer for all), the enemies' target list
 * (shared with the EnemyManager, local player first), the guns of the nests they are on, and their name tags.
 * On the host the teammates also join the damageable registry, so blasts reach them.
 */
export class RemotePlayers {
  private readonly renderer: SoldierRenderer;
  private readonly players = new Map<string, RemotePlayer>();
  private readonly tags: AllyTag[] = [];
  private readonly tagEvent = { tags: this.tags };
  private readonly point = new Vector3();
  private readonly forward = new Vector3();

  constructor(
    scene: Scene,
    private readonly world: RAPIER.World,
    private readonly events: EventBus<GameEvents>,
    /** The enemies' target list: the local player is already in it; teammates are added and removed here. */
    private readonly targets: PlayerTarget[],
    private readonly structureById: (id: number) => Structure | undefined,
    /** Host only: blasts find teammates here. */
    private readonly registry: DamageableRegistry | null,
    private readonly onHurt: AllyHurtHandler,
  ) {
    this.renderer = new SoldierRenderer(scene, config.multiplayer.maxPlayers);
  }

  get all(): Iterable<RemotePlayer> {
    return this.players.values();
  }

  get(id: string): RemotePlayer | undefined {
    return this.players.get(id);
  }

  add(id: string, name: string): RemotePlayer {
    const existing = this.players.get(id);
    if (existing) return existing;
    const used = new Set([...this.players.values()].map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const player = new RemotePlayer(id, name, slot, this.world, this.onHurt);
    this.players.set(id, player);
    this.targets.push(player);
    this.registry?.add(player.damageable);
    this.renderer.setUniform(slot, config.multiplayer.allyUniform);
    return player;
  }

  remove(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    const index = this.targets.indexOf(player);
    if (index >= 0) this.targets.splice(index, 1);
    this.registry?.remove(player.damageable, []);
    this.renderer.hideAll(player.slot);
    player.dispose();
  }

  /** The teammate on nest `nestId`'s gun, if any. */
  mountedOn(nestId: number): RemotePlayer | undefined {
    for (const player of this.players.values()) if (player.alive && player.nestId === nestId) return player;
    return undefined;
  }

  /** Move, pose and draw every teammate, swing the guns they are on, and place their name tags. Once per frame. */
  update(dt: number, camera: PerspectiveCamera): void {
    const mg = config.mg;
    this.tags.length = 0;
    camera.getWorldDirection(this.forward);
    for (const player of this.players.values()) {
      if (!player.update(dt)) continue;
      player.rig.write(this.renderer, player.slot);
      const nest = player.nestId ? this.structureById(player.nestId) : undefined;
      if (nest instanceof MgNest && player.alive) {
        const yaw = MathUtils.clamp(wrapAngle(player.yaw - nest.yaw), -deg(mg.yawLimit), deg(mg.yawLimit));
        nest.aimGun(yaw, MathUtils.clamp(player.pitch, deg(mg.pitchMin), deg(mg.pitchMax)));
      }
      const p = player.tagPoint(this.point);
      const ahead = (p.x - camera.position.x) * this.forward.x + (p.y - camera.position.y) * this.forward.y + (p.z - camera.position.z) * this.forward.z;
      p.project(camera);
      const tag = player.tag;
      tag.x = ((p.x + 1) / 2) * window.innerWidth;
      tag.y = ((1 - p.y) / 2) * window.innerHeight;
      tag.visible = ahead > 0.1;
      tag.down = !player.alive;
      this.tags.push(tag);
    }
    this.renderer.flush();
    this.events.emit('allyTags', this.tagEvent);
  }
}
