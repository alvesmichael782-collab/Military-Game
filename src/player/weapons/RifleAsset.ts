import { Box3, LoadingManager, Mesh, MeshLambertMaterial, NearestFilter, Object3D, Vector3, type Material, type Texture } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import modelUrl from '../../assets/models/m4.fbx?url';
import textureUrl from '../../assets/textures/m4.png?url';

/** A view-model-ready rifle: barrel along -Z, in meters, centered on its bounding box. */
export interface RifleView {
  readonly model: Object3D;
  /** Muzzle tip in the model's local space. */
  readonly muzzle: Vector3;
  /**
   * The magazine, a child of `model` that can move on its own. Its origin is the center of the magazine's top
   * and its axes match the model's (up the well is +Y); its transform as loaded is the seated rest pose.
   */
  readonly magazine: Object3D;
}

/** The FBX is authored in centimeters. */
const CM_TO_M = 0.01;
/** Object names in m4.fbx ("M4 Body", "M4 Magzine", sic), as the loader sanitizes them. */
const BODY_NAME = 'M4_Body';
const MAGAZINE_NAME = 'M4_Magzine';
/**
 * Where the magazine sits when seated, in the FBX's own centimeters and axes (+Z toward the muzzle). The file
 * leaves it at (0.549, -13.674, 2.75), hanging 1-2 cm below the magwell and 0.8 cm forward. The magwell opening
 * runs z -2.34..4.20 between vertical walls with its rim sloping from y -3.8 (front) to -5.0 (rear); the
 * magazine's upper body (z -1.2..4.7) is vertical too, so it only moves: centered front to back in the opening,
 * with its top 1.3-2 cm up inside the receiver.
 */
const MAGAZINE_SEATED = { x: 0.549, y: -10.174, z: 1.92 };
/** Vertices this close (meters) to the very front of the model count as the muzzle face. */
const MUZZLE_DEPTH = 0.01;

/**
 * Load the M4 carbine (src/assets/models/m4.fbx). The file was authored with the barrel along +Z,
 * so it is turned to face -Z like the camera. Materials become Lambert so the gun is lit the same
 * way as the rest of the game.
 */
export async function loadRifleModel(): Promise<RifleView> {
  // Any texture path stored inside the FBX is redirected to our bundled copy.
  const manager = new LoadingManager();
  manager.setURLModifier((url) => (/\.(png|jpe?g|tga|dds)$/i.test(url) ? textureUrl : url));
  const fbx = await new FBXLoader(manager).loadAsync(modelUrl);

  fbx.traverse((child) => {
    if (child instanceof Mesh) child.material = toLambert(child.material);
  });
  const body = fbx.getObjectByName(BODY_NAME);
  const magazineMesh = fbx.getObjectByName(MAGAZINE_NAME);
  if (!body || !magazineMesh) throw new Error(`m4.fbx is missing "${BODY_NAME}" or "${MAGAZINE_NAME}"`);

  fbx.scale.setScalar(CM_TO_M);
  fbx.rotation.y = Math.PI;
  fbx.updateMatrixWorld(true);

  // Center on the bounding box so the view model can place it like any other prop. This is measured with the
  // magazine where the file leaves it, before it is seated, so the rifle sits exactly where the view model and
  // the aim-down-sights pose were tuned (centering on the body alone would move it 4.6 cm).
  const center = new Box3().setFromObject(fbx).getCenter(new Vector3());
  fbx.position.sub(center);

  const model = new Object3D();
  model.name = 'rifle';
  model.add(fbx);
  magazineMesh.position.set(MAGAZINE_SEATED.x, MAGAZINE_SEATED.y, MAGAZINE_SEATED.z);
  model.updateMatrixWorld(true);

  return { model, muzzle: findMuzzle(body), magazine: magazinePivot(model, magazineMesh) };
}

/** Wrap the seated magazine in a pivot at the center of its top, aligned with the model, without moving it. */
function magazinePivot(model: Object3D, magazineMesh: Object3D): Object3D {
  const box = new Box3().setFromObject(magazineMesh);
  const pivot = new Object3D();
  pivot.name = 'magazine';
  pivot.position.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
  model.add(pivot);
  model.updateMatrixWorld(true);
  pivot.attach(magazineMesh);
  return pivot;
}

function toLambert(material: Material | Material[]): Material | Material[] {
  if (Array.isArray(material)) return material.map((m) => toLambert(m) as Material);
  const map = (material as Material & { map?: Texture | null }).map ?? null;
  // Crisp texels up close, like every world texture.
  if (map) map.magFilter = NearestFilter;
  material.dispose();
  return new MeshLambertMaterial({ map, name: material.name });
}

/** Average of the frontmost vertices (smallest Z) of the body, which is the end of the barrel. */
function findMuzzle(root: Object3D): Vector3 {
  const points: Vector3[] = [];
  let front = Infinity;
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const position = child.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const p = new Vector3().fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      points.push(p);
      front = Math.min(front, p.z);
    }
  });
  const muzzle = new Vector3();
  let count = 0;
  for (const p of points) {
    if (p.z - front > MUZZLE_DEPTH) continue;
    muzzle.add(p);
    count++;
  }
  return muzzle.divideScalar(Math.max(1, count));
}
