import { PerspectiveCamera, type Scene, type Vector3, type WebGLRenderer } from 'three';
import type { RetroFilter } from '../../core/RetroFilter';

/** Distance and height of the slow orbit around the outpost, in meters, and its speed in radians per second. */
const RADIUS = 30;
const HEIGHT = 8;
const SPEED = 0.035;

/**
 * Behind the start screen: the map, seen from a camera slowly circling the outpost core, through the retro
 * filter like the game itself. Runs its own frame loop until `stop`.
 */
export class MenuBackdrop {
  private readonly camera = new PerspectiveCamera(55, 1, 0.1, 600);
  private angle = 0.6;
  private last = performance.now();
  private frame = 0;
  private running = false;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly retro: RetroFilter,
    private readonly scene: Scene,
    private readonly center: Vector3,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.draw);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private readonly draw = (now: number): void => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.draw);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.angle += SPEED * dt;
    const c = this.center;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(c.x + Math.sin(this.angle) * RADIUS, HEIGHT, c.z + Math.cos(this.angle) * RADIUS);
    this.camera.lookAt(c.x, 1.5, c.z);
    this.renderer.info.reset();
    this.retro.begin();
    this.renderer.render(this.scene, this.camera);
    this.retro.end();
  };
}
