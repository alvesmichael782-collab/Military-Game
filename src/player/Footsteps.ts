import RAPIER from '@dimforge/rapier3d-compat';
import type { Vector3 } from 'three';
import type { SoundBank } from '../core/audio/SoundBank';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import { surfaceOf, type SurfaceType } from '../world/Surfaces';

/** The probe starts this far above the feet and reaches this far below them, in meters. */
const PROBE_UP = 0.1;
const PROBE_DOWN = 0.4;

/** What footsteps need to know about the player's body. */
export interface FootstepBody {
  readonly renderPosition: Vector3;
  readonly grounded: boolean;
  readonly crouching: boolean;
  readonly sprinting: boolean;
  /** Fall speed of a hard landing since the last call, in m/s, or 0. */
  takeLanding(): number;
  readonly gait: { readonly stepped: boolean };
}

/**
 * Plays `footstep.<surface>` each time a foot comes down (see `Gait`), for the surface under the player:
 * quieter crouched, louder sprinting, none in the air, and a heavier step on landing from a jump or fall.
 * A surface without sounds of its own uses the default surface's.
 */
export class Footsteps {
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly self: RAPIER.Collider;
  private _surface: SurfaceType = config.footsteps.defaultSurface;

  constructor(
    private readonly world: RAPIER.World,
    private readonly sounds: SoundBank,
    playerCollider: number,
  ) {
    this.self = world.getCollider(playerCollider);
  }

  /** The surface under the player at the last update. */
  get surface(): SurfaceType {
    return this._surface;
  }

  /** Call once per rendered frame, after the player's render update. */
  update(body: FootstepBody): void {
    // In the air nothing is below: keep the last surface, which the landing step then uses.
    this._surface = this.probe(body.renderPosition) ?? this._surface;
    const landing = body.takeLanding();
    const f = config.footsteps;
    if (landing > 0) {
      // Harder falls land louder, up to a cap.
      const extra = Math.min(1, (landing - f.landingMinSpeed) / f.landingMinSpeed);
      const volume = f.landingVolume + (f.landingMaxVolume - f.landingVolume) * extra;
      this.step(volume, f.landingPitch);
      return;
    }
    if (!body.gait.stepped || !body.grounded) return;
    this.step(body.crouching ? f.volume.crouch : body.sprinting ? f.volume.sprint : f.volume.walk, 1);
  }

  private step(volume: number, rate: number): void {
    const id = `footstep.${this._surface}`;
    this.sounds.play(this.sounds.has(id) ? id : `footstep.${config.footsteps.defaultSurface}`, { volume, rate });
  }

  /** What the player is standing on (whatever they collide with just below the feet), or null if nothing is. */
  private probe(feet: Vector3): SurfaceType | null {
    this.ray.origin = { x: feet.x, y: feet.y + PROBE_UP, z: feet.z };
    const hit = this.world.castRay(
      this.ray,
      PROBE_UP + PROBE_DOWN,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
      Groups.player,
      this.self,
    );
    if (!hit) return null;
    return surfaceOf(hit.collider) ?? config.footsteps.defaultSurface;
  }
}
