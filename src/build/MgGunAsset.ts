import {
  BufferGeometry,
  Float32BufferAttribute,
  LoadingManager,
  MeshLambertMaterial,
  NearestFilter,
  SkinnedMesh,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import modelUrl from '../assets/models/mg.fbx?url';
import textureUrl from '../assets/textures/mg.png?url';

/** The nest's machine gun: one static mesh's geometry and material, and its muzzle, in the gun's turning frame. */
export interface MgGunView {
  /** Origin at the foot of the gun's mount post (which sits on the tripod hub), barrel along -Z, in meters. */
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /** The barrel tip in the same frame. */
  readonly muzzle: Vector3;
}

/*
 * mg.fbx is a skinned M249-style gun on a short mount post, in centimeters, barrel along +Z, as two overlapping
 * copies of the same gun ("mesh0", and "mesh1", which also carries a belt of loose links parked at the origin).
 * It is used as a static mesh in its bind pose: mesh1's geometry with the links dropped, its skinning attributes
 * removed, moved so the foot of the post is the origin, turned to face -Z and scaled to `LENGTH`.
 */
const MESH_NAME = 'mesh1';
/** The foot of the mount post, in the file's centimeters. */
const POST_FOOT = new Vector3(0, 95.8, 71.4);
/** Anything below this height in the file is the stray belt links. */
const LINKS_BELOW = 60;
/** Overall length of the gun, stock to muzzle, in meters. */
const LENGTH = 1.15;
/** Vertices this close (meters) to the very front count as the muzzle face. */
const MUZZLE_DEPTH = 0.01;

let loaded: MgGunView | null = null;

/** Load the gun once at boot, before any nest is built. */
export async function loadMgGunModel(): Promise<MgGunView> {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => (/\.(png|jpe?g|tga|dds)$/i.test(url) ? textureUrl : url));
  const fbx = await new FBXLoader(manager).loadAsync(modelUrl);

  let source: SkinnedMesh | null = null;
  fbx.traverse((child) => {
    if (child instanceof SkinnedMesh && (child.name === MESH_NAME || !source)) source = child;
  });
  if (!source) throw new Error(`mg.fbx has no "${MESH_NAME}"`);
  const mesh: SkinnedMesh = source;

  const geometry = dropLinks(mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone());
  geometry.deleteAttribute('skinIndex');
  geometry.deleteAttribute('skinWeight');
  geometry.translate(-POST_FOOT.x, -POST_FOOT.y, -POST_FOOT.z);
  geometry.computeBoundingBox();
  const length = geometry.boundingBox!.max.z - geometry.boundingBox!.min.z;
  geometry.scale(LENGTH / length, LENGTH / length, LENGTH / length);
  geometry.rotateY(Math.PI);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const map = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material & { map?: Texture | null };
  const texture = map.map ?? null;
  if (texture) texture.magFilter = NearestFilter;
  const material = new MeshLambertMaterial({ map: texture, name: 'mgGun' });
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();

  loaded = { geometry, material, muzzle: findMuzzle(geometry) };
  return loaded;
}

/** The loaded gun. Throws if `loadMgGunModel` has not finished. */
export function mgGunView(): MgGunView {
  if (!loaded) throw new Error('MG gun model not loaded yet');
  return loaded;
}

/** The geometry without the triangles of the loose belt links (any triangle with a corner below `LINKS_BELOW`). */
function dropLinks(g: BufferGeometry): BufferGeometry {
  const position = g.getAttribute('position');
  const keep: number[] = [];
  for (let t = 0; t < position.count; t += 3) {
    if (position.getY(t) >= LINKS_BELOW && position.getY(t + 1) >= LINKS_BELOW && position.getY(t + 2) >= LINKS_BELOW) keep.push(t);
  }
  const out = new BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const attribute = g.getAttribute(name);
    const size = attribute.itemSize;
    const data = new Float32Array(keep.length * 3 * size);
    keep.forEach((t, k) => {
      for (let v = 0; v < 3; v++) for (let c = 0; c < size; c++) data[(k * 3 + v) * size + c] = attribute.getComponent(t + v, c);
    });
    out.setAttribute(name, new Float32BufferAttribute(data, size));
  }
  g.dispose();
  return out;
}

/** Average of the frontmost vertices (smallest Z): the end of the barrel. */
function findMuzzle(g: BufferGeometry): Vector3 {
  const position = g.getAttribute('position');
  const front = g.boundingBox!.min.z;
  const muzzle = new Vector3();
  let count = 0;
  for (let i = 0; i < position.count; i++) {
    if (position.getZ(i) - front > MUZZLE_DEPTH) continue;
    muzzle.x += position.getX(i);
    muzzle.y += position.getY(i);
    muzzle.z += position.getZ(i);
    count++;
  }
  return muzzle.divideScalar(Math.max(1, count));
}
