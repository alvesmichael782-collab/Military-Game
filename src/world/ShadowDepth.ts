import { InstancedMesh, MeshDepthMaterial, type Object3D } from 'three';

/**
 * three.js draws every shadow caster with one shared depth material unless the caster has its own. That
 * material's shader differs for instanced meshes (and again for instanced meshes with per-instance colors), so
 * as the shadow pass goes back and forth between plain and instanced casters, three re-derives the shader for
 * the shared material many times a frame, allocating as it goes. Giving the instanced casters their own shared
 * depth materials, one per kind, keeps each material on one shader.
 *
 * Call once after the scene is built (every instanced mesh is created up front). Casters cut out by alpha
 * (shrubs) are left to three, which already gives them a depth material of their own.
 */
export function separateInstancedShadowDepth(root: Object3D): void {
  const plain = new MeshDepthMaterial({ name: 'instancedShadowDepth' });
  const colored = new MeshDepthMaterial({ name: 'instancedColorShadowDepth' });
  root.traverse((object) => {
    if (!(object instanceof InstancedMesh) || !object.castShadow || object.customDepthMaterial) return;
    const material = object.material;
    if (Array.isArray(material) || material.alphaTest > 0 || material.alphaToCoverage) return;
    object.customDepthMaterial = object.instanceColor ? colored : plain;
  });
}
