import { Mesh, MeshLambertMaterial, NearestFilter, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Converted weapon models and textures (scripts/convert-weapons), found at build time so Vite bundles them. */
const MODEL_URLS = import.meta.glob<string>('../../assets/models/weapons/*.glb', { eager: true, query: '?url', import: 'default' });
const TEXTURE_URLS = import.meta.glob<string>('../../assets/textures/weapons/*.png', { eager: true, query: '?url', import: 'default' });

/** A loaded weapon model, ready to clone: meters, barrel or blade along -Z, centered on its bounding box. */
export interface WeaponAsset {
  /** The model root; its children are the parts ("body", "magazine"...) and the marker node. Clone per use. */
  readonly root: Object3D;
  /** The shared Lambert material with the weapon's color texture. Clone it for a different scene's lights. */
  readonly material: MeshLambertMaterial;
  /** The muzzle (guns) or blade tip (melee), in the model's frame. */
  readonly marker: Vector3;
}

function urlOf(urls: Record<string, string>, name: string, ext: string): string {
  const entry = Object.entries(urls).find(([path]) => path.endsWith(`/${name}.${ext}`));
  if (!entry) throw new Error(`Missing weapon asset ${name}.${ext}; run npm run convert:weapons`);
  return entry[1];
}

async function loadOne(name: string): Promise<WeaponAsset> {
  const [gltf, map] = await Promise.all([
    new GLTFLoader().loadAsync(urlOf(MODEL_URLS, name, 'glb')),
    new TextureLoader().loadAsync(urlOf(TEXTURE_URLS, name, 'png')),
  ]);
  // glTF texture coordinates start at the top left.
  map.flipY = false;
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  // Crisp texels up close, like every world texture.
  map.magFilter = NearestFilter;
  const material = new MeshLambertMaterial({ map, name: `weapon.${name}` });

  const root = gltf.scene.getObjectByName(name) ?? gltf.scene;
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    (child.material as { dispose(): void }).dispose();
    child.material = material;
  });
  const markerNode = root.getObjectByName('muzzle') ?? root.getObjectByName('tip');
  const marker = markerNode ? markerNode.position.clone() : new Vector3();
  return { root, material, marker };
}

/** Load every model named in `names` (file names without extension), keyed by name. */
export async function loadWeaponAssets(names: readonly string[]): Promise<Map<string, WeaponAsset>> {
  const unique = [...new Set(names)];
  const assets = await Promise.all(unique.map(loadOne));
  return new Map(unique.map((name, i) => [name, assets[i]]));
}
