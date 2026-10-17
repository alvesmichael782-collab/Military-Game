import RAPIER from '@dimforge/rapier3d-compat';
import { Object3D, Vector3, type Scene } from 'three';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { EventBus, GameEvents, InteractPromptEvent } from '../core/EventBus';
import type { Input } from '../core/Input';
import { aimBasis, type AimState } from '../player/Aim';
import type { BuildGrid } from '../world/BuildGrid';
import { PropBuilder } from '../world/PropBuilder';
import { PropMaterials } from '../world/PropMaterials';
import { tagSurface } from '../world/Surfaces';
import type { Purse } from './Purse';

const SIZE = { x: 1.3, y: 0.95, z: 1.0 };

export const CrateError = {
  CASH: 'NOT ENOUGH CASH',
  FULL: 'PLATES FULL',
} as const;

/**
 * Wooden supply crate beside the outpost core. Look at it from close by and press E to buy a spare
 * armor plate, in any phase. Learns the player's cash and spare plates from events; a purchase emits
 * `platePurchased`, which the player's armor answers by adding the plate.
 */
export class ArmorCrate {
  readonly position: Vector3;
  private readonly collider: RAPIER.Collider;
  private cash = 0;
  private spares = 0;
  private wantBuy = false;
  private promptKey = '';

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

  constructor(
    scene: Scene,
    private readonly world: RAPIER.World,
    grid: BuildGrid,
    private readonly purse: Purse,
    private readonly events: EventBus<GameEvents>,
  ) {
    const core = config.map.corePosition;
    const offset = config.armorCrate.offset;
    this.position = new Vector3(core.x + offset.x, 0, core.z + offset.z);

    scene.add(this.createModel());

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(this.position.x, SIZE.y / 2, this.position.z),
    );
    this.collider = tagSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(SIZE.x / 2, SIZE.y / 2, SIZE.z / 2), body), 'wood');
    grid.blockArea(this.position, SIZE.x / 2, SIZE.z / 2);

    events.on('cashChanged', ({ cash }) => {
      this.cash = cash;
    });
    events.on('armorChanged', ({ spares }) => {
      this.spares = spares;
    });
  }

  /** Call once per rendered frame, before `input.endFrame()`. */
  handleInput(input: Input, enabled: boolean): void {
    if (enabled && input.wasActionPressed('interact')) this.wantBuy = true;
  }

  /** Check whether the player is looking at the crate, update the prompt, and handle E. */
  update(aim: AimState, enabled: boolean): void {
    const looking = enabled && this.isLookedAt(aim);
    if (!looking) {
      this.wantBuy = false;
      this.setPrompt({ mode: 'hidden' });
      return;
    }
    const cost = config.economy.prices.armorPlate;
    const error = this.spares >= config.armor.maxSpares ? CrateError.FULL : this.cash < cost ? CrateError.CASH : null;
    this.setPrompt({ mode: 'armorCrate', cost, error });
    if (this.wantBuy) this.buy(cost, error);
    this.wantBuy = false;
  }

  private buy(cost: number, error: string | null): void {
    if (error === CrateError.FULL) {
      this.events.emit('actionDenied', {});
      return;
    }
    // A failed spend reports `cashInsufficient` itself, which flashes the HUD cash.
    if (!this.purse.spend(cost, 'plate')) return;
    this.events.emit('platePurchased', { cost });
  }

  /** How far away the crate is along the crosshair, in meters, or Infinity if the player is not looking at it in reach. */
  interactDistance(aim: AimState): number {
    aimBasis(aim.yaw, aim.pitch, this.forward, this.right, this.up);
    this.ray.origin = { x: aim.eye.x, y: aim.eye.y, z: aim.eye.z };
    this.ray.dir = { x: this.forward.x, y: this.forward.y, z: this.forward.z };
    const hit = this.world.castRay(this.ray, config.armorCrate.useRange, true, undefined, Groups.bullet);
    return hit !== null && hit.collider.handle === this.collider.handle ? hit.timeOfImpact : Infinity;
  }

  private isLookedAt(aim: AimState): boolean {
    return this.interactDistance(aim) < Infinity;
  }

  private setPrompt(prompt: InteractPromptEvent): void {
    const key = JSON.stringify(prompt);
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.events.emit('interactPromptChanged', prompt);
  }

  /**
   * A wooden supply crate with "ARMOR" stenciled on every side, steel bands down the corners and across the
   * lid, and a pair of rope handles. Same size as the collider.
   */
  private createModel(): Object3D {
    const object = new Object3D();
    object.name = 'armorCrate';
    object.position.copy(this.position);
    const metal = PropMaterials.darkMetal();
    const b = new PropBuilder().at(0, 0, 0);
    b.box(PropMaterials.armorCrate(), SIZE.x, SIZE.y, SIZE.z, 0, SIZE.y / 2, 0, { uv: 'native' });
    // Corner bands: L-shaped steel down each vertical edge.
    const band = 0.11;
    const t = 0.012;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (SIZE.x / 2 - band / 2 + t);
        const z = sz * (SIZE.z / 2 - band / 2 + t);
        b.box(metal, band, SIZE.y + 0.01, t, x, SIZE.y / 2, sz * (SIZE.z / 2 + t / 2), { tint: 0.75 });
        b.box(metal, t, SIZE.y + 0.01, band, sx * (SIZE.x / 2 + t / 2), SIZE.y / 2, z, { tint: 0.75 });
      }
    }
    // Two straps over the lid and down the long sides.
    for (const x of [-SIZE.x * 0.3, SIZE.x * 0.3]) {
      b.box(metal, 0.07, t, SIZE.z + 2 * t, x, SIZE.y + t / 2, 0, { tint: 0.7, ao: false });
      for (const sz of [-1, 1]) b.box(metal, 0.07, SIZE.y, t, x, SIZE.y / 2, sz * (SIZE.z / 2 + t / 2), { tint: 0.7 });
    }
    // Rope handles on the short ends.
    for (const sx of [-1, 1]) b.box(PropMaterials.burlap(), t * 2, 0.05, 0.3, sx * (SIZE.x / 2 + t), SIZE.y * 0.72, 0, { tint: [0.75, 0.66, 0.5], ao: false });
    b.buildMeshes(object, 'armorCrate');
    return object;
  }
}
