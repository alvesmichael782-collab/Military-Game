import { Color, type Scene, type Vector3 } from 'three';
import { createSmokeTexture } from '../combat/EffectTextures';
import { createParticleSpec, ParticleSystem } from '../combat/Particles';
import type { EventBus, GameEvents } from '../core/EventBus';
import { Phase } from '../core/GameState';

/** Puffs per second per column, and how long each lives, in seconds. Sized so the pool never runs dry. */
const RATE = 9;
const LIFE = 11;
const CAPACITY = 240;
/** Puffs start just above the spawn marker's flag, in meters, and rise at this speed, in m/s. */
const START_HEIGHT = 4;
const RISE_SPEED = 4.5;
/** A light breeze bends every column the same way, in m/s. */
const WIND_X = 0.5;
const WIND_Z = 0.25;
/** Puff size at birth and at the top of the column, in meters. */
const START_SIZE = 3;
const END_SIZE = 12;
/** Red signal smoke that pales as it spreads. */
const START_COLOR = new Color(0xc2361f);
const END_COLOR = new Color(0xcf9480);

/**
 * Tall colored smoke columns over the spawn points the next wave will use, shown during the build phase
 * and visible from anywhere on the map. Its own small particle pool, so it never starves combat smoke.
 */
export class SpawnSmoke {
  private readonly particles: ParticleSystem;
  private readonly spec = createParticleSpec();
  private active: readonly number[] = [];
  private building = false;
  private carry = 0;

  constructor(
    scene: Scene,
    events: EventBus<GameEvents>,
    private readonly spawnPoints: readonly Vector3[],
  ) {
    this.particles = new ParticleSystem(scene, createSmokeTexture(), CAPACITY, false);
    events.on('wavePlanned', ({ spawnPoints }) => {
      this.active = spawnPoints;
    });
    events.on('phaseChanged', ({ to }) => {
      this.building = to === Phase.BUILD;
    });
  }

  /** Puffs going up now, for tests. */
  get activeCount(): number {
    return this.particles.activeCount;
  }

  update(dt: number): void {
    if (this.building) {
      // Whole puffs only, carrying the fraction to the next frame so the rate holds at any frame rate.
      this.carry += RATE * dt;
      while (this.carry >= 1) {
        this.carry -= 1;
        for (const index of this.active) {
          const point = this.spawnPoints[index];
          if (point) this.puff(point);
        }
      }
    }
    this.particles.update(dt);
  }

  private puff(point: Vector3): void {
    const s = this.spec;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.6;
    s.x = point.x + Math.cos(a) * r;
    s.y = point.y + START_HEIGHT;
    s.z = point.z + Math.sin(a) * r;
    s.vx = WIND_X + (Math.random() - 0.5) * 0.6;
    s.vy = RISE_SPEED * (0.85 + Math.random() * 0.3);
    s.vz = WIND_Z + (Math.random() - 0.5) * 0.6;
    s.life = LIFE * (0.85 + Math.random() * 0.3);
    s.size = START_SIZE * (0.8 + Math.random() * 0.4);
    s.endSize = END_SIZE * (0.8 + Math.random() * 0.4);
    s.color.copy(START_COLOR);
    s.endColor.copy(END_COLOR);
    s.alpha = 0.9;
    s.fadeIn = 0.08;
    s.fadeOutStart = 0.7;
    s.gravity = 0;
    s.drag = 0.04;
    s.angle = Math.random() * Math.PI * 2;
    s.spin = (Math.random() - 0.5) * 0.4;
    this.particles.spawn(s);
  }
}
