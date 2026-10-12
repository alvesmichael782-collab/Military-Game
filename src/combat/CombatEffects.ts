import type { Scene } from 'three';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import { DestructionEffects } from '../destruction/DestructionEffects';
import { DecalPool } from './DecalPool';
import { createBulletHoleTexture, createGlowTexture, createMuzzleFlashTexture, createScorchTexture, createSmokeTexture } from './EffectTextures';
import { EnemyFireEffects } from './EnemyFireEffects';
import { ExplosionEffects } from './ExplosionEffects';
import { ImpactEffects } from './ImpactEffects';
import { LightFlashes } from './LightFlashes';
import { MgFireEffects } from './MgFireEffects';
import { ParticleSystem } from './Particles';
import { Tracers } from './Tracers';

/** Point lights shared by muzzle flashes and explosions. */
const FLASH_LIGHTS = 4;
/** World muzzle flash sprites (enemy rifles and the MG) and tracer streaks alive at once. */
const MAX_MUZZLE_FLASHES = 48;
const MAX_TRACERS = 64;

/** Owns the pooled effect resources and the systems that draw bullet impacts and explosions. */
export class CombatEffects {
  private readonly smoke: ParticleSystem;
  private readonly glow: ParticleSystem;
  private readonly lights: LightFlashes;
  private readonly muzzleFlashes: ParticleSystem;
  private readonly tracers: Tracers;

  constructor(scene: Scene, events: EventBus<GameEvents>) {
    const fx = config.effects;
    this.smoke = new ParticleSystem(scene, createSmokeTexture(), fx.maxSmokeParticles, false);
    this.glow = new ParticleSystem(scene, createGlowTexture(), fx.maxGlowParticles, true);
    this.lights = new LightFlashes(scene, FLASH_LIGHTS);
    const bulletHoles = new DecalPool(scene, createBulletHoleTexture(), fx.maxBulletHoles);
    const scorchMarks = new DecalPool(scene, createScorchTexture(), fx.maxScorchMarks);

    new ImpactEffects(events, this.smoke, this.glow, bulletHoles, this.lights);
    new ExplosionEffects(events, this.smoke, this.glow, scorchMarks, this.lights);
    new DestructionEffects(events, this.smoke);

    this.muzzleFlashes = new ParticleSystem(scene, createMuzzleFlashTexture(), MAX_MUZZLE_FLASHES, true);
    this.tracers = new Tracers(scene, MAX_TRACERS);
    new EnemyFireEffects(events, this.muzzleFlashes, this.tracers, this.lights);
    new MgFireEffects(events, this.muzzleFlashes, this.tracers, this.lights);
  }

  /** Live particle count, for the debug overlay. */
  get particleCount(): number {
    return this.smoke.activeCount + this.glow.activeCount + this.muzzleFlashes.activeCount;
  }

  update(dt: number): void {
    this.smoke.update(dt);
    this.glow.update(dt);
    this.lights.update(dt);
    this.muzzleFlashes.update(dt);
    this.tracers.update(dt);
  }
}
