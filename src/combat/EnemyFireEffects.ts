import { Color, type Vector3 } from 'three';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { LightFlashes } from './LightFlashes';
import { createParticleSpec, type ParticleSystem } from './Particles';
import type { Tracers } from './Tracers';

const LIGHT_COLOR = 0xffc070;
const LIGHT_DURATION = 0.06;
const FLASH_COLOR = new Color(0xfff2c0);
const FLASH_END = new Color(0xff9a30);
/** Size of the star-shaped flash at an enemy muzzle, in meters, and how long it shows. */
const FLASH_SIZE = 0.75;
const FLASH_TIME = 0.06;

/**
 * What the player sees when an enemy (or, in multiplayer, a teammate) fires: a big orange-yellow star flash at
 * the muzzle that briefly lights the surroundings (when a light is free), and a tracer streak to where the bullet stopped.
 */
export class EnemyFireEffects {
  private readonly spec = createParticleSpec();

  constructor(
    events: EventBus<GameEvents>,
    private readonly flashes: ParticleSystem,
    private readonly tracers: Tracers,
    private readonly lights: LightFlashes,
  ) {
    events.on('enemyFired', ({ muzzle, end }) => this.onFired(muzzle, end));
    events.on('allyFired', ({ muzzle, end }) => this.onFired(muzzle, end));
  }

  private onFired(muzzle: Vector3, end: Vector3 | null): void {
    const s = this.spec;
    s.x = muzzle.x;
    s.y = muzzle.y;
    s.z = muzzle.z;
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    s.life = FLASH_TIME;
    s.size = FLASH_SIZE * (0.8 + Math.random() * 0.4);
    s.endSize = s.size * 0.7;
    s.color.copy(FLASH_COLOR);
    s.endColor.copy(FLASH_END);
    s.alpha = 1;
    s.fadeIn = 0;
    s.fadeOutStart = 0.5;
    s.gravity = 0;
    s.drag = 0;
    s.angle = Math.random() * Math.PI * 2;
    s.spin = 0;
    this.flashes.spawn(s);
    if (end) this.tracers.add(muzzle, end);
    const fx = config.effects;
    this.lights.flashIfIdle(muzzle, LIGHT_COLOR, fx.muzzleLightIntensity, fx.muzzleLightRange, LIGHT_DURATION);
  }
}
