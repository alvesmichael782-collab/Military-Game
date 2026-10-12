import {
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Scene,
  type Texture,
} from 'three';

const FORWARD = new Vector3(0, 0, 1);
/** Lift off the surface, in meters, on top of the depth offset. */
const SURFACE_LIFT = 0.01;

/**
 * Flat decals (bullet holes, scorch marks) in one instanced mesh.
 * A ring buffer: once full, each new decal replaces the oldest.
 */
export class DecalPool {
  private readonly mesh: InstancedMesh;
  private next = 0;

  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly spin = new Quaternion();
  private readonly scale = new Vector3();

  constructor(scene: Scene, texture: Texture, private readonly capacity: number) {
    const material = new MeshLambertMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    // Hide every slot until it is used.
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  /** Place a decal of `size` meters on a surface at `point` facing along `normal`, randomly rotated. */
  add(point: Vector3, normal: Vector3, size: number): void {
    this.rotation.setFromUnitVectors(FORWARD, normal);
    this.spin.setFromAxisAngle(FORWARD, Math.random() * Math.PI * 2);
    this.rotation.multiply(this.spin);
    this.position.copy(point).addScaledVector(normal, SURFACE_LIFT);
    this.scale.set(size, size, 1);
    this.matrix.compose(this.position, this.rotation, this.scale);

    this.mesh.setMatrixAt(this.next, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.next = (this.next + 1) % this.capacity;
  }
}
