import { Color, Vector3 } from 'three';
import { config } from '../core/config';
import type { EventBus, ExplosionEvent, GameEvents } from '../core/EventBus';
import type { DecalPool } from './DecalPool';
import type { LightFlashes } from './LightFlashes';
import { createParticleSpec, type ParticleSpec, type ParticleSystem } from './Particles';

const LIGHT_COLOR = 0xffa040;

const FIRE_CORE = new Color(0xfff0b0);
const FIRE_CORE_END = new Color(0xff5a10);
const FIRE = new Color(0xffc040);
const FIRE_END = new Color(0xb02800);
const SPARK = new Color(0xffe6a0);
const SPARK_END = new Color(0xff6a10);
const SMOKE = new Color(0x2e2925);
const SMOKE_END = new Color(0x8a8070);
const DIRT = new Color(0x5a4632);
const DUST = new Color(0xc2a272);
const DUST_END = new Color(0xd8c6a2);

const FIRE_BLOBS = 7;
const SPARKS = 14;
const SMOKE_PUFFS = 10;
const DIRT_CHUNKS = 14;
const DUST_RING = 8;

/** Spread `count` values evenly around a circle with some jitter, so puffs do not clump. */
function ringAngle(i: number, count: number): number {
  return ((i + Math.random() * 0.6) / count) * Math.PI * 2;
}

/**
 * Explosion visuals, driven by the `explosion` event: a sprite fireball, rising smoke,
 * sparks and dirt, a bright light flash and a scorch mark. All pooled.
 */
export class ExplosionEffects {
  private readonly spec = createParticleSpec();
  private readonly dir = new Vector3();

  constructor(
    events: EventBus<GameEvents>,
    private readonly smoke: ParticleSystem,
    private readonly glow: ParticleSystem,
    private readonly scorchMarks: DecalPool,
    private readonly lights: LightFlashes,
  ) {
    events.on('explosion', (e) => this.onExplosion(e));
  }

  private onExplosion({ position, groundPoint, groundNormal }: ExplosionEvent): void {
    const cfg = config.explosion;
    this.lights.flash(position, LIGHT_COLOR, cfg.lightIntensity, cfg.lightRange, cfg.lightDuration);
    if (groundPoint) this.scorchMarks.add(groundPoint, groundNormal, cfg.scorchSize * (0.85 + Math.random() * 0.3));

    // Lift the effect a little so a blast on the ground is not half buried.
    const x = position.x;
    const y = position.y + 0.3;
    const z = position.z;
    const s = this.spec;

    // Fireball: one bright core and several blobs that swell and darken.
    this.reset(s, x, y + 0.3, z);
    s.life = 0.35;
    s.size = 1.2;
    s.endSize = 4.2;
    s.color.copy(FIRE_CORE);
    s.endColor.copy(FIRE_CORE_END);
    s.fadeOutStart = 0.3;
    s.angle = Math.random() * Math.PI * 2;
    this.glow.spawn(s);

    for (let i = 0; i < FIRE_BLOBS; i++) {
      const a = ringAngle(i, FIRE_BLOBS);
      this.reset(s, x + Math.cos(a) * 0.5, y + 0.2 + Math.random() * 0.6, z + Math.sin(a) * 0.5);
      s.vx = Math.cos(a) * (2 + Math.random() * 2);
      s.vy = 1.5 + Math.random() * 2.5;
      s.vz = Math.sin(a) * (2 + Math.random() * 2);
      s.life = 0.3 + Math.random() * 0.25;
      s.size = 0.8 + Math.random() * 0.5;
      s.endSize = 2.2 + Math.random() * 1.2;
      s.color.copy(FIRE);
      s.endColor.copy(FIRE_END);
      s.fadeOutStart = 0.35;
      s.drag = 3;
      s.angle = Math.random() * Math.PI * 2;
      s.spin = (Math.random() - 0.5) * 3;
      this.glow.spawn(s);
    }

    for (let i = 0; i < SPARKS; i++) {
      this.randomUpward(0.3).multiplyScalar(9 + Math.random() * 9);
      this.reset(s, x, y, z);
      this.setVelocity(s);
      s.life = 0.5 + Math.random() * 0.4;
      s.size = 0.14;
      s.endSize = 0.05;
      s.color.copy(SPARK);
      s.endColor.copy(SPARK_END);
      s.fadeOutStart = 0.6;
      s.gravity = 9.8;
      s.drag = 0.8;
      this.glow.spawn(s);
    }

    // Chunky smoke that rises and fades over about 2 seconds.
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const a = ringAngle(i, SMOKE_PUFFS);
      const r = Math.random() * 0.9;
      this.reset(s, x + Math.cos(a) * r, y + 0.3 + Math.random() * 0.8, z + Math.sin(a) * r);
      s.vx = Math.cos(a) * (0.6 + Math.random() * 1.2);
      s.vy = 1 + Math.random() * 1.6;
      s.vz = Math.sin(a) * (0.6 + Math.random() * 1.2);
      s.life = 1.6 + Math.random() * 0.8;
      s.size = 1.3 + Math.random() * 0.6;
      s.endSize = 3.8 + Math.random() * 1.4;
      s.color.copy(SMOKE);
      s.endColor.copy(SMOKE_END);
      s.alpha = 0.8;
      s.fadeIn = 0.08;
      s.fadeOutStart = 0.35;
      s.gravity = -0.3;
      s.drag = 1.2;
      s.angle = Math.random() * Math.PI * 2;
      s.spin = (Math.random() - 0.5) * 0.8;
      this.smoke.spawn(s);
    }

    for (let i = 0; i < DIRT_CHUNKS; i++) {
      this.randomUpward(0.5).multiplyScalar(5 + Math.random() * 6);
      this.reset(s, x, y, z);
      this.setVelocity(s);
      s.life = 0.9 + Math.random() * 0.5;
      s.size = 0.12 + Math.random() * 0.14;
      s.endSize = s.size;
      s.color.copy(DIRT);
      s.endColor.copy(DIRT);
      s.fadeOutStart = 0.75;
      s.gravity = 14;
      s.drag = 0.3;
      s.angle = Math.random() * Math.PI;
      s.spin = (Math.random() - 0.5) * 10;
      this.smoke.spawn(s);
    }

    // A ring of dust kicked out along the ground.
    for (let i = 0; i < DUST_RING; i++) {
      const a = ringAngle(i, DUST_RING);
      const speed = 4 + Math.random() * 2;
      this.reset(s, x + Math.cos(a) * 0.6, Math.max(0.3, position.y), z + Math.sin(a) * 0.6);
      s.vx = Math.cos(a) * speed;
      s.vy = 0.3;
      s.vz = Math.sin(a) * speed;
      s.life = 1 + Math.random() * 0.4;
      s.size = 0.8;
      s.endSize = 2.6 + Math.random();
      s.color.copy(DUST);
      s.endColor.copy(DUST_END);
      s.alpha = 0.6;
      s.fadeIn = 0.05;
      s.fadeOutStart = 0.3;
      s.drag = 2.5;
      s.angle = Math.random() * Math.PI * 2;
      s.spin = (Math.random() - 0.5);
      this.smoke.spawn(s);
    }
  }

  /** Random direction biased upward; `minUp` is the smallest vertical component before normalizing. */
  private randomUpward(minUp: number): Vector3 {
    const a = Math.random() * Math.PI * 2;
    return this.dir.set(Math.cos(a), minUp + Math.random() * (1 - minUp), Math.sin(a)).normalize();
  }

  private setVelocity(s: ParticleSpec): void {
    s.vx = this.dir.x;
    s.vy = this.dir.y;
    s.vz = this.dir.z;
  }

  /** Position the spec and clear motion and fade settings to defaults. */
  private reset(s: ParticleSpec, x: number, y: number, z: number): void {
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    s.alpha = 1;
    s.fadeIn = 0;
    s.fadeOutStart = 0.5;
    s.gravity = 0;
    s.drag = 0;
    s.angle = 0;
    s.spin = 0;
  }
}
