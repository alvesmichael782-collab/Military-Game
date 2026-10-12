import { PointLight, type ColorRepresentation, type Scene, type Vector3 } from 'three';

interface Flash {
  light: PointLight;
  peak: number;
  duration: number;
  age: number;
}

/**
 * A small pool of point lights for brief flashes (muzzle, explosions).
 * Lights stay in the scene at zero intensity when idle: adding, removing or hiding lights
 * would change the light count and force every material to recompile.
 */
export class LightFlashes {
  private readonly flashes: Flash[] = [];

  constructor(scene: Scene, count: number) {
    for (let i = 0; i < count; i++) {
      const light = new PointLight(0xffffff, 0, 1, 2);
      scene.add(light);
      this.flashes.push({ light, peak: 0, duration: 1, age: 1 });
    }
  }

  /** Flash a light at `position` that fades out over `duration` seconds. Reuses the light closest to finishing. */
  flash(position: Vector3, color: ColorRepresentation, intensity: number, range: number, duration: number): void {
    let pick = this.flashes[0];
    for (const f of this.flashes) {
      if (f.age / f.duration > pick.age / pick.duration) pick = f;
    }
    pick.light.position.copy(position);
    pick.light.color.set(color);
    pick.light.distance = range;
    pick.peak = intensity;
    pick.duration = duration;
    pick.age = 0;
    pick.light.intensity = intensity;
  }

  /**
   * Like `flash`, but only takes a light that is dark right now, so a stream of small flashes (enemy
   * muzzles) never cuts an explosion's light short. Does nothing if every light is busy.
   */
  flashIfIdle(position: Vector3, color: ColorRepresentation, intensity: number, range: number, duration: number): void {
    if (this.flashes.some((f) => f.age >= f.duration)) this.flash(position, color, intensity, range, duration);
  }

  update(dt: number): void {
    for (const f of this.flashes) {
      if (f.age >= f.duration) continue;
      f.age += dt;
      const t = Math.min(1, f.age / f.duration);
      f.light.intensity = f.peak * (1 - t) * (1 - t);
    }
  }
}
