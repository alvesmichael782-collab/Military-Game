import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Vector3 } from 'three';
import type { Grenades } from '../combat/Grenades';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { Input } from '../core/Input';
import { aimBasis, type AimState } from './Aim';

/** Where the grenade leaves the hand, relative to the eye, in meters. */
const HAND_FORWARD = 0.45;
const HAND_RIGHT = 0.15;
const HAND_DOWN = 0.1;
/** Gap kept from a wall when throwing point-blank into it, in meters. */
const WALL_MARGIN = 0.12;
const MAX_PITCH = MathUtils.degToRad(85);

/** Halo-style grenade throw on a dedicated key: no weapon switch, a short cooldown, a limited supply. */
export class GrenadeThrower {
  private _count: number = config.grenade.count;
  private cooldown = 0;
  private requested = false;

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly hand = new Vector3();
  private readonly velocity = new Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  constructor(
    private readonly world: RAPIER.World,
    private readonly grenades: Grenades,
    private readonly events: EventBus<GameEvents>,
  ) {}

  get count(): number {
    return this._count;
  }

  /** Call once per rendered frame, before `input.endFrame()`. */
  handleInput(input: Input, active: boolean): void {
    if (active && input.wasPressed('KeyG')) this.requested = true;
  }

  /** Returns true on the frame a grenade is thrown. */
  update(dt: number, aim: AimState): boolean {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const wanted = this.requested;
    this.requested = false;
    if (!wanted || this.cooldown > 0 || this._count <= 0) return false;

    const g = config.grenade;
    const pitch = Math.min(MAX_PITCH, aim.pitch + MathUtils.degToRad(g.throwUpAngle));
    aimBasis(aim.yaw, pitch, this.forward, this.right, this.up);

    this.hand
      .copy(aim.eye)
      .addScaledVector(this.forward, HAND_FORWARD)
      .addScaledVector(this.right, HAND_RIGHT)
      .addScaledVector(this.up, -HAND_DOWN);
    this.keepHandOutOfWalls(aim.eye);

    this.velocity.copy(this.forward).multiplyScalar(g.throwSpeed).addScaledVector(aim.velocity, g.inheritVelocity);
    if (!this.grenades.throw(this.hand, this.velocity, 'player')) return false;

    this._count--;
    this.cooldown = g.cooldown;
    this.announce();
    return true;
  }

  /** Debug: restore the starting supply. */
  refill(): void {
    this._count = config.grenade.count;
    this.announce();
  }

  /** Emit the current count, e.g. so a freshly built HUD can draw it. */
  announce(): void {
    this.events.emit('grenadesChanged', { count: this._count, max: config.grenade.count });
  }

  /** If a wall sits between the eye and the hand, release the grenade just in front of the wall instead. */
  private keepHandOutOfWalls(eye: Vector3): void {
    const toHand = this.velocity.copy(this.hand).sub(eye);
    const distance = toHand.length();
    toHand.divideScalar(distance);
    this.ray.origin = { x: eye.x, y: eye.y, z: eye.z };
    this.ray.dir = { x: toHand.x, y: toHand.y, z: toHand.z };
    const hit = this.world.castRay(this.ray, distance + WALL_MARGIN, true, undefined, Groups.bullet);
    if (hit) this.hand.copy(eye).addScaledVector(toHand, Math.max(0, hit.timeOfImpact - WALL_MARGIN));
  }
}
