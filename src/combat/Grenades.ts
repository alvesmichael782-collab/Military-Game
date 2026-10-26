import type RAPIER from '@dimforge/rapier3d-compat';
import type { Scene, Vector3 } from 'three';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { DamageSource } from './Damage';
import type { Explosions } from './Explosion';
import { Grenade } from './Grenade';

/** Minimum seconds between bounce sounds from one grenade, so rolling does not rattle. */
const BOUNCE_SOUND_GAP = 0.12;

/** The pool of live grenades: ticks their fuses, reports bounces, and calls `explode` when a fuse runs out. */
export class Grenades {
  private readonly pool: Grenade[] = [];
  private readonly bounceGap: number[] = [];

  constructor(
    scene: Scene,
    world: RAPIER.World,
    private readonly explosions: Explosions,
    private readonly events: EventBus<GameEvents>,
  ) {
    for (let i = 0; i < config.grenade.maxActive; i++) {
      this.pool.push(new Grenade(scene, world));
      this.bounceGap.push(0);
    }
  }

  get activeCount(): number {
    let count = 0;
    for (const grenade of this.pool) if (grenade.active) count++;
    return count;
  }

  /**
   * Launch a grenade that goes off after `fuse` seconds. Its blast carries the thrower's `source`. Returns false if every
   * pooled grenade is already in the air. A `harmless` one is another machine's grenade (a player's, or a grenadier's on
   * the host), shown here: it flies and blows up the same, but its damage is dealt on that machine.
   */
  throw(position: Vector3, velocity: Vector3, source: DamageSource, harmless = false, fuse: number = config.grenade.fuse): boolean {
    const index = this.pool.findIndex((g) => !g.active);
    if (index < 0) return false;
    this.pool[index].launch(position, velocity, source, fuse);
    this.pool[index].harmless = harmless;
    if (!harmless) this.events.emit('grenadeThrown', { position, velocity, fuse, source });
    this.bounceGap[index] = BOUNCE_SOUND_GAP;
    return true;
  }

  /** Call after the physics step. */
  fixedUpdate(dt: number): void {
    const g = config.grenade;
    this.pool.forEach((grenade, i) => {
      if (!grenade.active) return;
      const impact = grenade.afterStep(dt);
      this.bounceGap[i] -= dt;
      if (impact > g.bounceThreshold && this.bounceGap[i] <= 0) {
        this.bounceGap[i] = BOUNCE_SOUND_GAP;
        this.events.emit('grenadeBounced', { position: grenade.position, impactSpeed: impact });
      }

      grenade.fuse -= dt;
      if (grenade.fuse <= 0) {
        grenade.deactivate();
        this.explosions.explode(grenade.position, g.radius, g.damage, grenade.source, { harmless: grenade.harmless });
      }
    });
  }

  render(alpha: number): void {
    for (const grenade of this.pool) {
      if (grenade.active) grenade.render(alpha);
    }
  }
}
