import { PerspectiveCamera, type Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Distance from the focus point when the debug camera is switched on, in meters (x, y, z). */
const FOCUS_OFFSET = { x: 10, y: 8, z: 10 };

/** Debug-only orbit camera, toggled with F1. Never part of normal play. */
export class DebugCamera {
  readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;

  constructor(domElement: HTMLElement) {
    this.camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(70, 55, 70);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 260;
    // Stay above the ground plane.
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.enabled = false;
    this.controls.update();
  }

  /** Mouse orbiting only responds while enabled, so it never fights the FPS camera. */
  setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  /** Orbit around a point, viewed from a short distance. */
  focus(target: Vector3): void {
    this.controls.target.copy(target);
    this.camera.position.set(target.x + FOCUS_OFFSET.x, target.y + FOCUS_OFFSET.y, target.z + FOCUS_OFFSET.z);
    this.controls.update();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(): void {
    this.controls.update();
  }
}
