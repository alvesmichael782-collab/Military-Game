import type RAPIER from '@dimforge/rapier3d-compat';

/** What the ground is made of, for footsteps (and later impacts). */
export const SURFACE_TYPES = ['gravel', 'sand', 'dirt', 'concrete', 'wood', 'metal', 'grass'] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];

/** Surface of every tagged collider, by collider handle. Untagged colliders count as the default surface. */
const surfaces = new Map<number, SurfaceType>();

/** Mark what a collider is made of. Returns the collider, so it can wrap `createCollider`. */
export function tagSurface(collider: RAPIER.Collider, surface: SurfaceType): RAPIER.Collider {
  surfaces.set(collider.handle, surface);
  return collider;
}

/** Forget the surfaces of a body's colliders. Call before removing the body from the world. */
export function untagSurfaces(body: RAPIER.RigidBody): void {
  for (let k = 0; k < body.numColliders(); k++) surfaces.delete(body.collider(k).handle);
}

/** What a collider is made of, or undefined if it was never tagged. */
export function surfaceOf(collider: RAPIER.Collider): SurfaceType | undefined {
  return surfaces.get(collider.handle);
}
