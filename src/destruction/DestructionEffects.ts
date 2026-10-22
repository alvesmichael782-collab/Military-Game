import { Color, type Vector3 } from 'three';
import type { StructureType } from '../build/Buildables';
import { createParticleSpec, type ParticleSystem } from '../combat/Particles';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';

const DUST = new Color(0xcdb487);
const DUST_END = new Color(0xe2d3b0);
const CHUNK = new Color(0xb89e74);
const BRICK = new Color(0x8f4f38);
const PLASTER = new Color(0xd8c39a);
const SAND = new Color(0xa89a6a);

/** How big a cloud each structure type throws up: footprint radius and height, in meters. */
function extentOf(type: StructureType): { radius: number; height: number } {
  if (type === 'wall') return { radius: config.build.cellSize / 2, height: config.structures.wall.height };
  if (type === 'weaponCrate' || type === 'consumablesCrate') return { radius: config.build.cellSize / 2, height: 0.8 };
  return { radius: config.build.cellSize, height: 0.9 };
}

/**
 * Dust and chunk particles when structures go: a full cloud plus a shower of falling brick and plaster bits
 * when one collapses, and a light puff when the player takes one down or clears rubble. The solid debris
 * chunks that bounce and settle are the Debris system's.
 */
export class DestructionEffects {
  private readonly spec = createParticleSpec();

  constructor(
    events: EventBus<GameEvents>,
    private readonly smoke: ParticleSystem,
  ) {
    events.on('segmentDestroyed', ({ type, position, yaw }) => {
      this.cloud(type, position, 1);
      this.fallingChunks(type, position, yaw);
    });
    events.on('structureRemoved', ({ type, position }) => this.cloud(type, position, 0.4));
    events.on('rubbleCleared', ({ position }) => this.cloud('wall', position, 0.3));
  }

  /** `strength` 1 is a full collapse cloud; less is a lighter puff. */
  private cloud(type: StructureType, base: Vector3, strength: number): void {
    const { radius, height } = extentOf(type);
    const s = this.spec;
    const puffs = Math.round(22 * strength);
    for (let i = 0; i < puffs; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      s.x = base.x + Math.cos(a) * r;
      s.y = Math.random() * height * 0.8 + 0.2;
      s.z = base.z + Math.sin(a) * r;
      s.vx = Math.cos(a) * (0.6 + Math.random() * 1.2);
      s.vy = 0.3 + Math.random() * 0.9;
      s.vz = Math.sin(a) * (0.6 + Math.random() * 1.2);
      s.life = 1.4 + Math.random() * 1.4;
      s.size = 0.7 + Math.random() * 0.5;
      s.endSize = 2.2 + Math.random() * 1.4;
      s.color.copy(DUST);
      s.endColor.copy(DUST_END);
      s.alpha = 0.6;
      s.fadeIn = 0.08;
      s.fadeOutStart = 0.35;
      s.gravity = -0.15;
      s.drag = 1.4;
      s.angle = Math.random() * Math.PI * 2;
      s.spin = (Math.random() - 0.5) * 0.8;
      this.smoke.spawn(s);
    }
    const chunks = Math.round(14 * strength);
    for (let i = 0; i < chunks; i++) {
      const a = Math.random() * Math.PI * 2;
      s.x = base.x + Math.cos(a) * radius * Math.random();
      s.y = 0.3 + Math.random() * height;
      s.z = base.z + Math.sin(a) * radius * Math.random();
      s.vx = Math.cos(a) * (1 + Math.random() * 2.5);
      s.vy = 1 + Math.random() * 3;
      s.vz = Math.sin(a) * (1 + Math.random() * 2.5);
      s.life = 0.7 + Math.random() * 0.5;
      s.size = 0.07 + Math.random() * 0.08;
      s.endSize = s.size;
      s.color.copy(CHUNK);
      s.endColor.copy(CHUNK);
      s.alpha = 1;
      s.fadeIn = 0;
      s.fadeOutStart = 0.75;
      s.gravity = 12;
      s.drag = 0.4;
      s.angle = Math.random() * Math.PI;
      s.spin = (Math.random() - 0.5) * 10;
      this.smoke.spawn(s);
    }
  }

  /** Bits of brick and plaster raining down out of where the wall stood (sandbag scraps for the nest). */
  private fallingChunks(type: StructureType, base: Vector3, yaw: number): void {
    const { radius, height } = extentOf(type);
    const s = this.spec;
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    for (let i = 0; i < 26; i++) {
      if (type === 'wall') {
        const along = (Math.random() - 0.5) * 2 * radius;
        s.x = base.x + ax * along + (Math.random() - 0.5) * 0.4 * az;
        s.z = base.z + az * along - (Math.random() - 0.5) * 0.4 * ax;
        s.y = height * (0.35 + Math.random() * 0.75);
      } else {
        const a = Math.random() * Math.PI * 2;
        s.x = base.x + Math.cos(a) * radius * 0.8;
        s.z = base.z + Math.sin(a) * radius * 0.8;
        s.y = 0.4 + Math.random() * 0.8;
      }
      s.vx = (Math.random() - 0.5) * 1.6;
      s.vy = Math.random() * 1.2 - 0.3;
      s.vz = (Math.random() - 0.5) * 1.6;
      s.life = 0.55 + Math.random() * 0.35;
      s.size = 0.05 + Math.random() * 0.07;
      s.endSize = s.size;
      const color = type === 'wall' ? (Math.random() < 0.55 ? BRICK : PLASTER) : SAND;
      s.color.copy(color);
      s.endColor.copy(color);
      s.alpha = 1;
      s.fadeIn = 0;
      s.fadeOutStart = 0.8;
      s.gravity = 14;
      s.drag = 0.2;
      s.angle = Math.random() * Math.PI;
      s.spin = (Math.random() - 0.5) * 12;
      this.smoke.spawn(s);
    }
  }
}
