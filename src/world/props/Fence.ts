import { Groups } from '../../core/CollisionGroups';
import type { PropBuilder } from '../PropBuilder';
import { PropMaterials } from '../PropMaterials';
import { createRandom } from '../random';

const HEIGHT = 2.1;
const POST_SPACING = 2.5;

/**
 * A run of chain-link fence from (x0, z0) to (x1, z1), axis-aligned: metal posts, a top rail and the mesh.
 * `gaps` are post intervals left open (torn down), `lean` intervals sag over. The fence stops bodies but bullets
 * and grenades go through the mesh; it blocks its row of cells for enemy routes, except at the gaps.
 */
export function addFence(b: PropBuilder, x0: number, z0: number, x1: number, z1: number, seed: number, gaps: number[] = [], lean: number[] = []): void {
  const random = createRandom(seed);
  const mesh = PropMaterials.chainLink();
  const metal = PropMaterials.darkMetal();
  const length = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(-(z1 - z0), x1 - x0);
  b.at(x0, z0, yaw);
  const count = Math.max(1, Math.round(length / POST_SPACING));
  const step = length / count;
  for (let k = 0; k <= count; k++) {
    const x = k * step;
    const tilt = (random() - 0.5) * 0.06;
    b.cylinder(metal, 0.045, 0.05, HEIGHT + 0.1, 6, x, (HEIGHT + 0.1) / 2, 0, { rz: tilt, tint: [0.8, 0.8, 0.78], collide: 'metal' });
  }
  for (let k = 0; k < count; k++) {
    if (gaps.includes(k)) continue;
    const mid = (k + 0.5) * step;
    const sag = lean.includes(k) ? 0.35 : 0;
    // The mesh panel: a double-sided plane, leaning over if it sags.
    b.box(mesh, step - 0.08, HEIGHT - 0.1, 0.01, mid, (HEIGHT - 0.1) / 2 + 0.05, sag * 0.5, { rx: sag, uv: 2, ao: false });
    b.cylinder(metal, 0.025, 0.025, step, 5, mid, HEIGHT, sag * 0.9, { rz: Math.PI / 2, tint: [0.85, 0.85, 0.82], ao: false });
    b.collider(step / 2, HEIGHT / 2, 0.05, mid, HEIGHT / 2, 0, 0, null, Groups.movementBlocker);
    b.block(step / 2 - 0.2, 0.05, mid, 0);
  }
}
