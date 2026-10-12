import type { Camera, Scene } from 'three';
import type { EventBus, GameEvents } from '../core/EventBus';
import { WorldHpBar } from './WorldHpBar';

/** The bar keeps about the screen size it has at full scale this far away, in meters, wherever the player stands. */
const NATURAL_DISTANCE = 7;
const MIN_SCALE = 0.22;
const MAX_SCALE = 1.6;

/**
 * The HP bar floating over the damaged structure the player is aiming at or repairing, driven by
 * `structureFocusChanged`. One bar, moved to whichever structure has focus, sized to read the same up close and far off.
 */
export class StructureHpBar {
  private readonly bar = new WorldHpBar();

  constructor(scene: Scene, events: EventBus<GameEvents>) {
    this.bar.object.visible = false;
    this.bar.object.name = 'structureHpBar';
    scene.add(this.bar.object);
    events.on('structureFocusChanged', ({ target }) => {
      this.bar.object.visible = target !== null;
      if (!target) return;
      this.bar.object.position.copy(target.anchor);
      this.bar.setFraction(target.hp / target.maxHp);
    });
  }

  /** Keep the bar facing the camera at a steady size on screen. Call once per rendered frame. */
  update(camera: Camera): void {
    const object = this.bar.object;
    if (!object.visible) return;
    this.bar.faceCamera(camera);
    const scale = camera.position.distanceTo(object.position) / NATURAL_DISTANCE;
    object.scale.setScalar(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)));
  }
}
