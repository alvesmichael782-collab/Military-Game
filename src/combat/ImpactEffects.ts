import { Color, Vector3 } from 'three';
import { config } from '../core/config';
import type { BulletImpactEvent, EventBus, GameEvents } from '../core/EventBus';
import type { DecalPool } from './DecalPool';
import type { LightFlashes } from './LightFlashes';
import { createParticleSpec, type ParticleSystem } from './Particles';

const MUZZLE_LIGHT_COLOR = 0xffc070;
const MUZZLE_LIGHT_DURATION = 0.06;

const DUST = new Color(0xcdb07e);
const DUST_END = new Color(0xe0cfaa);
const DIRT = new Color(0x6e5236);
const SPARK = new Color(0xffe08a);
const SPARK_END = new Color(0xff7a20);
const GRIT = new Color(0x9a8f84);
const GRIT_END = new Color(0xb8b0a6);
const CHIP = new Color(0xe3cc9e);
const PLASTER_DUST = new Color(0xd9c7a2);
const PLASTER_DUST_END = new Color(0xe8dcc0);
const PLASTER_CHIP = new Color(0xe6d4ae);
const BRICK_DUST = new Color(0xb48a6c);
const BRICK_DUST_END = new Color(0xcdb397);
const BRICK_CHIP = new Color(0x8f4f38);
const SAND_DUST = new Color(0xbfae84);
const SAND_DUST_END = new Color(0xd6c9a6);
const BLOOD = new Color(0x7a1810);
const BLOOD_END = new Color(0x4a1410);

/** A random unit vector, written into `out`. */
function randomDirection(out: Vector3): Vector3 {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

/** Bullet impacts (puffs, sparks, bullet holes) and the muzzle light, driven by weapon events. */
export class ImpactEffects {
  private readonly spec = createParticleSpec();
  private readonly dir = new Vector3();

  constructor(
    events: EventBus<GameEvents>,
    private readonly smoke: ParticleSystem,
    private readonly glow: ParticleSystem,
    private readonly bulletHoles: DecalPool,
    lights: LightFlashes,
  ) {
    events.on('weaponFired', ({ muzzle }) => {
      const fx = config.effects;
      lights.flash(muzzle, MUZZLE_LIGHT_COLOR, fx.muzzleLightIntensity, fx.muzzleLightRange, MUZZLE_LIGHT_DURATION);
    });
    events.on('bulletImpact', (e) => this.onImpact(e));
  }

  private onImpact({ point, normal, surface }: BulletImpactEvent): void {
    switch (surface) {
      case 'dirt':
        this.burst(point, normal, 5, DUST, DUST_END, 0.12, 0.6, 0.5, 0.9, 1.2, 0.5, 0.75);
        this.chunks(point, normal, 4, DIRT, 0.06, 3, 12);
        this.bulletHoles.add(point, normal, config.effects.bulletHoleSize);
        break;
      case 'hard':
        this.sparks(point, normal, 6);
        this.burst(point, normal, 3, GRIT, GRIT_END, 0.1, 0.4, 0.35, 0.5, 1, 0, 0.6);
        this.bulletHoles.add(point, normal, config.effects.bulletHoleSize);
        break;
      case 'plaster':
        // Intact walls: a puff of plaster dust and pale chips. No bullet holes: walls change shape and fall.
        this.burst(point, normal, 4, PLASTER_DUST, PLASTER_DUST_END, 0.1, 0.5, 0.45, 0.8, 1.1, 0.3, 0.7);
        this.chunks(point, normal, 5, PLASTER_CHIP, 0.045, 3, 11);
        break;
      case 'brick':
        // Damaged and breached walls: the brick behind shows, so the chips are brick red.
        this.burst(point, normal, 4, BRICK_DUST, BRICK_DUST_END, 0.1, 0.5, 0.45, 0.8, 1.1, 0.3, 0.7);
        this.chunks(point, normal, 6, BRICK_CHIP, 0.05, 3.2, 11);
        break;
      case 'sand':
        this.burst(point, normal, 5, SAND_DUST, SAND_DUST_END, 0.12, 0.55, 0.5, 0.9, 1, 0.5, 0.7);
        this.chunks(point, normal, 2, SAND_DUST, 0.04, 2, 12);
        break;
      case 'flesh':
        // Soldiers: a quick dark red puff and a few drops. No holes: bodies move and sink away.
        this.burst(point, normal, 3, BLOOD, BLOOD_END, 0.1, 0.4, 0.2, 0.35, 1.2, 1, 0.85);
        this.chunks(point, normal, 3, BLOOD, 0.035, 2, 9);
        break;
      case 'target':
        // Targets move and respawn, so they get no bullet holes.
        this.chunks(point, normal, 4, CHIP, 0.05, 2.5, 10);
        this.burst(point, normal, 2, DUST, DUST_END, 0.1, 0.35, 0.3, 0.4, 0.8, 0, 0.6);
        break;
    }
  }

  /** Soft puffs pushed out along the surface normal. */
  private burst(
    point: Vector3, normal: Vector3, count: number, color: Color, endColor: Color,
    size: number, endSize: number, minLife: number, maxLife: number, speed: number, gravity: number, alpha: number,
  ): void {
    const s = this.spec;
    for (let i = 0; i < count; i++) {
      randomDirection(this.dir).multiplyScalar(0.5).add(normal).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      s.x = point.x + normal.x * 0.05;
      s.y = point.y + normal.y * 0.05;
      s.z = point.z + normal.z * 0.05;
      s.vx = this.dir.x;
      s.vy = this.dir.y;
      s.vz = this.dir.z;
      s.life = minLife + Math.random() * (maxLife - minLife);
      s.size = size;
      s.endSize = endSize * (0.8 + Math.random() * 0.4);
      s.color.copy(color);
      s.endColor.copy(endColor);
      s.alpha = alpha;
      s.fadeIn = 0.05;
      s.fadeOutStart = 0.3;
      s.gravity = gravity;
      s.drag = 2;
      s.angle = Math.random() * Math.PI * 2;
      s.spin = (Math.random() - 0.5) * 2;
      this.smoke.spawn(s);
    }
  }

  /** Small solid bits thrown out of the surface that fall under gravity. */
  private chunks(point: Vector3, normal: Vector3, count: number, color: Color, size: number, speed: number, gravity: number): void {
    const s = this.spec;
    for (let i = 0; i < count; i++) {
      randomDirection(this.dir).multiplyScalar(0.7).add(normal).normalize().multiplyScalar(speed * (0.6 + Math.random() * 0.8));
      s.x = point.x + normal.x * 0.03;
      s.y = point.y + normal.y * 0.03;
      s.z = point.z + normal.z * 0.03;
      s.vx = this.dir.x;
      s.vy = this.dir.y;
      s.vz = this.dir.z;
      s.life = 0.5 + Math.random() * 0.3;
      s.size = size;
      s.endSize = size;
      s.color.copy(color);
      s.endColor.copy(color);
      s.alpha = 1;
      s.fadeIn = 0;
      s.fadeOutStart = 0.7;
      s.gravity = gravity;
      s.drag = 0.5;
      s.angle = Math.random() * Math.PI;
      s.spin = (Math.random() - 0.5) * 12;
      this.smoke.spawn(s);
    }
  }

  private sparks(point: Vector3, normal: Vector3, count: number): void {
    const s = this.spec;
    for (let i = 0; i < count; i++) {
      randomDirection(this.dir).add(normal).normalize().multiplyScalar(3 + Math.random() * 4);
      s.x = point.x + normal.x * 0.03;
      s.y = point.y + normal.y * 0.03;
      s.z = point.z + normal.z * 0.03;
      s.vx = this.dir.x;
      s.vy = this.dir.y;
      s.vz = this.dir.z;
      s.life = 0.15 + Math.random() * 0.2;
      s.size = 0.07;
      s.endSize = 0.02;
      s.color.copy(SPARK);
      s.endColor.copy(SPARK_END);
      s.alpha = 1;
      s.fadeIn = 0;
      s.fadeOutStart = 0.5;
      s.gravity = 9;
      s.drag = 1;
      s.angle = 0;
      s.spin = 0;
      this.glow.spawn(s);
    }
  }
}
