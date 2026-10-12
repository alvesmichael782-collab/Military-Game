import { Color, InstancedMesh, Matrix4, MeshLambertMaterial, type BufferGeometry, type Scene } from 'three';
import { createSoldierGeometries, UNIFORM_COLORS, UNIFORM_MASK, type SoldierGeometries } from './SoldierGeometry';

/** Body parts, and how many of each one soldier has. */
const PARTS = {
  pelvis: 1,
  torso: 1,
  head: 1,
  upperArm: 2,
  forearm: 2,
  thigh: 2,
  shin: 2,
  rifle: 1,
  satchel: 1,
  band: 1,
} as const satisfies Record<keyof SoldierGeometries, number>;

export type SoldierPart = keyof typeof PARTS;

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const tmpColor = new Color();

/**
 * Lambert with vertex colors, where the instance color tints only the vertices flagged as uniform cloth
 * (`uniformMask`), so each soldier's uniform takes its own color while gear, skin and the rifle stay as painted.
 */
function createSoldierMaterial(): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float ${UNIFORM_MASK};`)
      .replace('vColor.rgb *= instanceColor.rgb;', `vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, ${UNIFORM_MASK});`);
  };
  material.customProgramCacheKey = () => 'soldier-uniform-mask';
  return material;
}

const tmpMatrix = new Matrix4();

/**
 * Draws every soldier with one instanced mesh per body part, so the whole pool costs about ten draw
 * calls (plus their shadows) no matter how many are alive. Soldiers on the field are packed into the
 * first instances (a soldier's parts sit at `index * count + side` in each part's mesh) and each mesh
 * draws only those, so the rest of the pool costs nothing. Parts a soldier lacks get a zero-scale matrix.
 */
export class SoldierRenderer {
  private readonly meshes = new Map<SoldierPart, InstancedMesh>();
  private readonly dirty = new Set<InstancedMesh>();
  /** Packed draw index of each soldier slot, or -1 while it is not drawn. */
  private readonly indexOf: number[];
  /** The soldier slot at each packed draw index. */
  private readonly slotAt: number[] = [];

  constructor(scene: Scene, private readonly capacity: number) {
    this.indexOf = new Array<number>(capacity).fill(-1);
    const geometries = createSoldierGeometries();
    const material = createSoldierMaterial();
    tmpColor.setHex(UNIFORM_COLORS.tan);
    for (const name of Object.keys(PARTS) as SoldierPart[]) {
      const geometry: BufferGeometry = geometries[name];
      const mesh = new InstancedMesh(geometry, material, capacity * PARTS[name]);
      mesh.name = `soldier.${name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Instances move every frame, so a bounding sphere computed once would cull them wrongly.
      mesh.frustumCulled = false;
      for (let i = 0; i < mesh.count; i++) {
        mesh.setMatrixAt(i, HIDDEN);
        mesh.setColorAt(i, tmpColor);
      }
      mesh.count = 0;
      scene.add(mesh);
      this.meshes.set(name, mesh);
    }
  }

  /** Triangles in one soldier with every part shown, for the art budget. */
  get trianglesPerSoldier(): number {
    let total = 0;
    for (const [name, mesh] of this.meshes) total += (mesh.geometry.getAttribute('position').count / 3) * PARTS[name];
    return total;
  }

  set(part: SoldierPart, slot: number, side: number, matrix: Matrix4): void {
    const mesh = this.mesh(part);
    mesh.setMatrixAt(this.draw(slot) * PARTS[part] + side, matrix);
    this.dirty.add(mesh);
  }

  hide(part: SoldierPart, slot: number): void {
    const mesh = this.mesh(part);
    const index = this.draw(slot);
    for (let side = 0; side < PARTS[part]; side++) mesh.setMatrixAt(index * PARTS[part] + side, HIDDEN);
    this.dirty.add(mesh);
  }

  /** Dress a soldier's uniform in `color` (a hex color), on every part. */
  setUniform(slot: number, color: number): void {
    tmpColor.setHex(color);
    const index = this.draw(slot);
    for (const [part, mesh] of this.meshes) {
      for (let side = 0; side < PARTS[part]; side++) mesh.setColorAt(index * PARTS[part] + side, tmpColor);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Stop drawing a soldier (back in the pool). The last drawn soldier moves into its place, so the
   * drawn ones stay packed at the front.
   */
  hideAll(slot: number): void {
    const index = this.indexOf[slot];
    if (index < 0) return;
    const last = this.slotAt.length - 1;
    const moved = this.slotAt[last];
    for (const [part, mesh] of this.meshes) {
      for (let side = 0; side < PARTS[part]; side++) {
        const from = last * PARTS[part] + side;
        const to = index * PARTS[part] + side;
        if (index !== last) {
          mesh.getMatrixAt(from, tmpMatrix);
          mesh.setMatrixAt(to, tmpMatrix);
          mesh.getColorAt(from, tmpColor);
          mesh.setColorAt(to, tmpColor);
        }
        mesh.setMatrixAt(from, HIDDEN);
      }
      mesh.count = last * PARTS[part];
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.dirty.add(mesh);
    }
    this.slotAt[index] = moved;
    this.indexOf[moved] = index;
    this.slotAt.pop();
    this.indexOf[slot] = -1;
  }

  /** Upload changed matrices. Call once per rendered frame after posing. */
  flush(): void {
    for (const mesh of this.dirty) mesh.instanceMatrix.needsUpdate = true;
    this.dirty.clear();
  }

  /** The soldier's packed draw index, giving it the next free one (and drawing one more soldier) if it has none. */
  private draw(slot: number): number {
    let index = this.indexOf[slot];
    if (index >= 0) return index;
    index = this.slotAt.length;
    this.slotAt.push(slot);
    this.indexOf[slot] = index;
    for (const [part, mesh] of this.meshes) mesh.count = (index + 1) * PARTS[part];
    return index;
  }

  private mesh(part: SoldierPart): InstancedMesh {
    const mesh = this.meshes.get(part);
    if (!mesh || this.capacity <= 0) throw new Error(`No soldier part ${part}`);
    return mesh;
  }
}
