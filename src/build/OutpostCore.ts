import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, type Camera, type MeshLambertMaterial, type Scene } from 'three';
import type { Damageable } from '../combat/Damageable';
import type { DamageableRegistry } from '../combat/DamageableRegistry';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import { WorldHpBar } from '../ui/WorldHpBar';
import type { BuildGrid } from '../world/BuildGrid';
import { tagSurface } from '../world/Surfaces';
import { createCoreBunker } from './CoreBunkerModel';
import { distanceToGroundBox } from './Structure';

const BASE_SIZE = 2.4;
/** Side of the core's square footprint, in meters. */
export const CORE_SIZE = BASE_SIZE;
const BASE_HEIGHT = 1.6;
const TOP_HEIGHT = 0.8;
/** The bunker's materials darken by this much, scorched, when it is destroyed. */
const DEAD_SHADE = 0.4;
const BAR_HEIGHT = BASE_HEIGHT + TOP_HEIGHT + 0.6;

/**
 * The outpost core the player defends. Takes damage through `applyDamage`; its HP shows on a bar above it.
 * At 0 HP it emits `coreDestroyed`, which ends the game as a loss. Its grid cells are permanently blocked.
 */
export class OutpostCore implements Damageable {
  readonly kind = 'core';
  readonly maxHp: number = config.structures.core.hp;
  private hp = this.maxHp;
  /** Ground point under the core. */
  readonly base: Vector3;
  private readonly center: Vector3;
  private readonly materials: MeshLambertMaterial[];
  private readonly bar = new WorldHpBar();

  constructor(
    scene: Scene,
    world: RAPIER.World,
    registry: DamageableRegistry,
    grid: BuildGrid,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.base = new Vector3(config.map.corePosition.x, 0, config.map.corePosition.z);
    const height = BASE_HEIGHT + TOP_HEIGHT;
    this.center = new Vector3(this.base.x, height / 2, this.base.z);

    // A command bunker filling the collider: same footprint, same height.
    const bunker = createCoreBunker(BASE_SIZE, height);
    bunker.object.position.copy(this.base);
    scene.add(bunker.object);
    this.materials = bunker.materials;

    this.bar.object.position.set(this.base.x, BAR_HEIGHT, this.base.z);
    this.bar.object.scale.setScalar(1.6);
    this.bar.setFraction(1);
    scene.add(this.bar.object);

    // One box collider covering the full height keeps it simple and impossible to climb.
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(this.base.x, height / 2, this.base.z));
    const collider = tagSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(BASE_SIZE / 2, height / 2, BASE_SIZE / 2), body), 'concrete');
    registry.addHitbox(collider, this, 'body');
    grid.blockArea(this.base, BASE_SIZE / 2, BASE_SIZE / 2);
  }

  get position(): Vector3 {
    return this.center;
  }

  get isAlive(): boolean {
    return this.hp > 0;
  }

  /** Blasts measure to the core's surface, so a charge planted against it hits it in full. */
  blastDistance(point: Vector3): number {
    return distanceToGroundBox(point, this.base, 0, BASE_SIZE / 2, BASE_HEIGHT + TOP_HEIGHT, BASE_SIZE / 2);
  }

  takeDamage(amount: number): void {
    if (!this.isAlive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.bar.setFraction(this.hp / this.maxHp);
    this.events.emit('coreDamaged', { hp: this.hp, maxHp: this.maxHp });
    if (!this.isAlive) {
      for (const material of this.materials) material.color.multiplyScalar(DEAD_SHADE);
      this.bar.object.visible = false;
      this.events.emit('coreDestroyed', {});
    }
  }

  get health(): number {
    return this.hp;
  }

  /** Keep the HP bar facing the camera. Call once per rendered frame. */
  update(camera: Camera): void {
    if (this.bar.object.visible) this.bar.faceCamera(camera);
  }
}
