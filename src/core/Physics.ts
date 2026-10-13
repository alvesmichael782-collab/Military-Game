import RAPIER from '@dimforge/rapier3d-compat';
import { config } from './config';

/** Steps between Rapier's handle-map clean-ups (see `step`). */
const MAP_SYNC_STEPS = 60;

/** Owns the Rapier world. Stepped once per fixed update. */
export class Physics {
  readonly world: RAPIER.World;
  private stepsSinceSync = 0;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: config.physics.gravity, z: 0 });
    this.world.timestep = config.physics.step;
  }

  /** Loads the Rapier WASM module, then creates the world. */
  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  /**
   * One physics step. `World.step` also re-syncs Rapier's JS handle maps after every step, walking every body and
   * collider through a JS callback and allocating as it goes, which grows with each wall, rubble pile and enemy.
   * The game only creates and removes bodies and colliders through the World API, which keeps those maps up to
   * date itself, so the step runs the pipeline directly and the full re-sync runs once a second as a safety net.
   */
  step(): void {
    const w = this.world;
    w.physicsPipeline.step(w.gravity, w.integrationParameters, w.islands, w.broadPhase, w.narrowPhase, w.bodies, w.colliders, w.softBodies, w.impulseJoints, w.multibodyJoints, w.ccdSolver);
    if (++this.stepsSinceSync >= MAP_SYNC_STEPS) {
      this.stepsSinceSync = 0;
      w.mapNewSoftBodies();
    }
  }
}
