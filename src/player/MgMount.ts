import { MathUtils, Vector3 } from 'three';
import { MgNest } from '../build/MgNest';
import { MG_HUB, NEST } from '../build/MgNestModel';
import type { Structure } from '../build/Structure';
import { config } from '../core/config';
import type { EventBus, GameEvents, MgDismountReason } from '../core/EventBus';
import type { Input } from '../core/Input';
import { aimBasis, type AimState } from './Aim';
import type { FPSCamera } from './FPSCamera';

const deg = MathUtils.degToRad;
/** The middle of the receiver, above the hub, in the gun's frame: what "looking at the gun" aims at. */
const RECEIVER_UP = 0.12;
/** The back of the gun (its spade grips) in the nest's frame, along -Z from the center. */
const GRIPS_Z = NEST.gunZ + 0.34;

/** Turn `a` into the range -PI..PI. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** What mounting needs from the player's body. */
export interface MountBody {
  readonly position: Vector3;
  teleport(position: Vector3): void;
}

/**
 * Mounting the MG nest's gun. From behind the gun (inside the sandbags, within `mountRange` of its grips),
 * looking at it, E mounts and E again dismounts. Mounted, the player stands still behind the gun, the camera
 * rides just behind and over its receiver, and the gun follows the view within the turn limits.
 * Comes off on its own if the nest is destroyed or removed, the player dies, or the game ends.
 *
 * E is shared with the armor crate and repairs: `interactDistance` reports how close a mount target is,
 * and the caller enables whichever use is closest.
 */
export class MgMount {
  private readonly nests = new Map<number, MgNest>();
  private _nest: MgNest | null = null;
  private _candidate: MgNest | null = null;
  private wantToggle = false;
  private promptShown = false;
  private localYaw = 0;
  private pitch = 0;

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly local = new Vector3();
  private readonly point = new Vector3();
  private readonly offset = new Vector3();

  constructor(
    private readonly events: EventBus<GameEvents>,
    structures: { byId(id: number): Structure | undefined },
    private readonly body: MountBody,
  ) {
    events.on('structurePlaced', ({ id, type }) => {
      const nest = structures.byId(id);
      if (type === 'mgNest' && nest instanceof MgNest) this.nests.set(id, nest);
    });
    const gone = ({ id }: { id: number }): void => {
      if (this._nest?.id === id) this.dismount('destroyed');
      this.nests.delete(id);
    };
    events.on('structureRemoved', gone);
    events.on('segmentDestroyed', gone);
    events.on('playerDied', () => this.dismount('died'));
    events.on('gameOver', () => this.dismount('gameOver'));
  }

  /** The nest the player is on, or null. */
  get nest(): MgNest | null {
    return this._nest;
  }

  get mounted(): boolean {
    return this._nest !== null;
  }

  /** Call once per rendered frame, before `input.endFrame()`. */
  handleInput(input: Input, enabled: boolean): void {
    if (enabled && input.wasActionPressed('interact')) this.wantToggle = true;
  }

  /**
   * How far the gun the player could mount is, in meters (0 while mounted, so E stays with the gun),
   * or Infinity if there is nothing to mount from here.
   */
  interactDistance(aim: AimState): number {
    this._candidate = this._nest;
    if (this._nest) return 0;
    let best = Infinity;
    for (const nest of this.nests.values()) {
      const d = this.mountDistance(nest, aim);
      if (d < best) {
        best = d;
        this._candidate = nest;
      }
    }
    return best;
  }

  /** The nest the last `interactDistance` found (mounted, or mountable from here), or null. */
  get candidate(): MgNest | null {
    return this._candidate;
  }

  /** Mount, dismount and the prompt. `enabled` is false when E belongs to something else this frame (or not at all). */
  update(aim: AimState, enabled: boolean): void {
    const wanted = this.wantToggle;
    this.wantToggle = false;
    if (this._nest) {
      this.setPrompt(false);
      if (wanted && enabled) this.dismount('player');
      return;
    }
    let target: MgNest | null = null;
    if (enabled) {
      let best = Infinity;
      for (const nest of this.nests.values()) {
        const d = this.mountDistance(nest, aim);
        if (d < best) {
          best = d;
          target = nest;
        }
      }
    }
    this.setPrompt(target !== null);
    if (target && wanted) this.mount(target, aim.yaw, aim.pitch);
  }

  /**
   * Mounted: hold the view inside the turn limits, swing the gun after it and put the camera behind the
   * receiver. Call after mouse look, in place of the camera's normal update.
   */
  applyView(camera: FPSCamera): void {
    const nest = this._nest;
    if (!nest) return;
    const mg = config.mg;
    this.localYaw = MathUtils.clamp(wrapAngle(camera.yaw - nest.yaw), -deg(mg.yawLimit), deg(mg.yawLimit));
    this.pitch = MathUtils.clamp(camera.pitch, deg(mg.pitchMin), deg(mg.pitchMax));
    camera.yaw = nest.yaw + this.localYaw;
    camera.pitch = this.pitch;
    nest.aimGun(this.localYaw, this.pitch);

    // The camera rides with the gun, just over and behind the receiver.
    aimBasis(camera.yaw, this.pitch, this.forward, this.right, this.up);
    nest.hubPosition(this.point);
    this.offset.copy(this.up).multiplyScalar(mg.cameraUp).addScaledVector(this.forward, -mg.cameraBack);
    camera.placeAt(this.point.add(this.offset));
  }

  private mount(nest: MgNest, yaw: number, pitch: number): void {
    this._nest = nest;
    // Stand behind the gun, so the sandbags cover the body the enemies shoot at.
    this.local.set(MG_HUB.x, 0, MG_HUB.z + config.mg.mountBack);
    nest.toWorld(this.local, this.point);
    this.point.y = this.body.position.y;
    this.body.teleport(this.point);
    this.localYaw = wrapAngle(yaw - nest.yaw);
    this.pitch = pitch;
    this.events.emit('mgMounted', { nestId: nest.id, displayName: config.mg.displayName });
  }

  private dismount(reason: MgDismountReason): void {
    const nest = this._nest;
    if (!nest) return;
    this._nest = null;
    this.events.emit('mgDismounted', { nestId: nest.id, reason });
  }

  /** Distance from the eye to the gun if the player can mount it from where they are, else Infinity. */
  private mountDistance(nest: MgNest, aim: AimState): number {
    if (!nest.isAlive) return Infinity;
    const mg = config.mg;
    // Behind the gun, inside the nest's width, and close enough to its grips.
    nest.toLocal(this.body.position, this.local);
    if (this.local.z <= GRIPS_Z || Math.abs(this.local.x) > NEST.ring + NEST.bagDepth / 2) return Infinity;
    if (Math.hypot(this.local.x - MG_HUB.x, this.local.z - GRIPS_Z) > mg.mountRange) return Infinity;
    // Looking at the receiver.
    this.local.set(MG_HUB.x, MG_HUB.y + RECEIVER_UP, MG_HUB.z);
    nest.toWorld(this.local, this.point).sub(aim.eye);
    const distance = this.point.length();
    aimBasis(aim.yaw, aim.pitch, this.forward, this.right, this.up);
    if (this.forward.dot(this.point) < distance * Math.cos(deg(mg.mountLookAngle))) return Infinity;
    return distance;
  }

  private setPrompt(shown: boolean): void {
    if (shown === this.promptShown) return;
    this.promptShown = shown;
    this.events.emit('mountPromptChanged', { shown });
  }
}
