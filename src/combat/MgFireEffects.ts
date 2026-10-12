import { Color } from 'three';
import { config } from '../core/config';
import type { EventBus, GameEvents, MgFiredEvent } from '../core/EventBus';
import type { LightFlashes } from './LightFlashes';
import { createParticleSpec, type ParticleSystem } from './Particles';
import type { Tracers } from './Tracers';

const LIGHT_COLOR = 0xffc070;
const LIGHT_DURATION = 0.06;
const FLASH_COLOR = new Color(0xfff2c0);
const FLASH_END = new Color(0xff9a30);
/** How long each flash shows, in seconds. */
const FLASH_TIME = 0.05;

/**
 * What the mounted MG's shots look like: a big orange-yellow star flash on the nest gun's barrel that lights
 * the sandbags around it, and a tracer streak for every tracer round.
 */
export class MgFireEffects {
  private readonly spec = createParticleSpec();

  constructor(
    events: EventBus<GameEvents>,
    private readonly flashes: ParticleSystem,
    private readonly tracers: Tracers,
    private readonly lights: LightFlashes,
  ) {
    events.on('mgFired', (e) => this.onFired(e));
  }

  private onFired({ muzzle, end, tracer }: MgFiredEvent): void {
    const s = this.spec;
    s.x = muzzle.x;
    s.y = muzzle.y;
    s.z = muzzle.z;
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    s.life = FLASH_TIME;
    s.size = config.mg.muzzleFlashSize * (0.8 + Math.random() * 0.4);
    s.endSize = s.size * 0.75;
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
    if (tracer) this.tracers.add(muzzle, end);
    const fx = config.effects;
    this.lights.flashIfIdle(muzzle, LIGHT_COLOR, fx.muzzleLightIntensity, fx.muzzleLightRange, LIGHT_DURATION);
  }
}
