import { DoubleSide, MeshLambertMaterial, type Texture } from 'three';
import {
  createArmorCrateTexture,
  createArmsCrateTexture,
  createBarrelTexture,
  createBurlapTexture,
  createChainLinkTexture,
  createConcreteTexture,
  createCorrugatedTexture,
  createCrateTexture,
  createOliveMetalTexture,
  createPlankTexture,
  createPlasterBrickTexture,
  createPoleTexture,
  createShrubTexture,
  createSteelDoorTexture,
} from './PropTextures';

/**
 * The shared prop material kit: one Lambert material per surface role, each with its procedural texture and
 * vertex colors (for tints and fake ambient occlusion). Built on first use and shared by everything that plays
 * the same part, so the whole map dressing costs a handful of materials and textures.
 */
const cache = new Map<string, MeshLambertMaterial>();

function material(name: string, make: () => Texture, extra: Partial<ConstructorParameters<typeof MeshLambertMaterial>[0]> = {}): MeshLambertMaterial {
  let m = cache.get(name);
  if (!m) {
    m = new MeshLambertMaterial({ map: make(), vertexColors: true, name, ...extra });
    cache.set(name, m);
  }
  return m;
}

/**
 * The instanced-mesh copy of a prop material (same texture and settings). three.js builds a different shader for
 * instanced meshes, so a material shared by plain and instanced meshes would switch shaders back and forth every
 * frame; instanced props use these copies instead.
 */
export function forInstances(base: MeshLambertMaterial): MeshLambertMaterial {
  const key = `${base.name}.instanced`;
  let m = cache.get(key);
  if (!m) {
    m = base.clone();
    m.name = key;
    cache.set(key, m);
  }
  return m;
}

export const PropMaterials = {
  plaster: () => material('plaster', createPlasterBrickTexture),
  concrete: () => material('concrete', createConcreteTexture),
  planks: () => material('planks', createPlankTexture),
  crate: () => material('crate', createCrateTexture),
  armorCrate: () => material('armorCrate', createArmorCrateTexture),
  armsCrate: () => material('armsCrate', createArmsCrateTexture),
  corrugated: () => material('corrugated', createCorrugatedTexture, { side: DoubleSide }),
  oliveMetal: () => material('oliveMetal', createOliveMetalTexture),
  barrel: () => material('barrel', createBarrelTexture),
  chainLink: () => material('chainLink', createChainLinkTexture, { alphaTest: 0.5, side: DoubleSide }),
  shrub: () => material('shrub', createShrubTexture, { alphaTest: 0.5, side: DoubleSide }),
  burlap: () => material('burlap', createBurlapTexture),
  pole: () => material('pole', createPoleTexture),
  steelDoor: () => material('steelDoor', createSteelDoorTexture),
  /** Untextured dark metal (antenna, wheels, hinges, fence posts): a plain color through the vertex tint. */
  darkMetal: (): MeshLambertMaterial => {
    let m = cache.get('darkMetal');
    if (!m) cache.set('darkMetal', (m = new MeshLambertMaterial({ color: 0x3c3d3a, vertexColors: true, name: 'darkMetal' })));
    return m;
  },
};
