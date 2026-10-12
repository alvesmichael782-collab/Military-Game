import RAPIER from '@dimforge/rapier3d-compat';
import { config } from './config';

/** Owns the Rapier world. Stepped once per fixed update. */
export class Physics {
  readonly world: RAPIER.World;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: config.physics.gravity, z: 0 });
    this.world.timestep = config.physics.step;
  }

  /** Loads the Rapier WASM module, then creates the world. */
  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  step(): void {
    this.world.step();
  }
}
