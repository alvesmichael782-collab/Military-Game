import { Color, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, type Camera } from 'three';

const WIDTH = 0.8;
const HEIGHT = 0.08;
const BORDER = 0.02;
const FULL = new Color(0x3ccf4e);
const HALF = new Color(0xf2c230);
const EMPTY = new Color(0xd8402a);

const geometry = new PlaneGeometry(1, 1);

/** Small health bar floating in the world, always facing the camera. Plain shapes, no text. */
export class WorldHpBar {
  readonly object = new Object3D();
  private readonly fill: Mesh<PlaneGeometry, MeshBasicMaterial>;

  constructor() {
    const back = new Mesh(geometry, new MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.7, fog: false }));
    back.scale.set(WIDTH + BORDER * 2, HEIGHT + BORDER * 2, 1);
    this.fill = new Mesh(geometry, new MeshBasicMaterial({ color: FULL, fog: false }));
    this.fill.position.z = 0.001;
    this.object.add(back, this.fill);
  }

  /** `fraction` of health remaining, 0..1. */
  setFraction(fraction: number): void {
    const f = Math.min(1, Math.max(0, fraction));
    // Shrink toward the left edge.
    this.fill.scale.set(Math.max(1e-3, WIDTH * f), HEIGHT, 1);
    this.fill.position.x = (WIDTH * (f - 1)) / 2;
    const color = this.fill.material.color;
    if (f > 0.5) color.copy(HALF).lerp(FULL, (f - 0.5) * 2);
    else color.copy(EMPTY).lerp(HALF, f * 2);
  }

  faceCamera(camera: Camera): void {
    this.object.quaternion.copy(camera.quaternion);
  }
}
