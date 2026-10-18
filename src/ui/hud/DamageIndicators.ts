import { MathUtils } from 'three';
import { config } from '../../core/config';
import type { EventBus, GameEvents, PlayerDamagedEvent } from '../../core/EventBus';
import { viewAngleTo, type ViewTracker } from './ViewTracker';
import './DamageIndicators.css';

/** Half the sprite's size, in ring radii: room for the thickest bar's outer edge. */
const EXTENT = 1.2;

interface Indicator {
  active: boolean;
  /** Whoever fired, or null for a one-off source (a blast). */
  attacker: object | null;
  /** Where the hit came from, flat. */
  x: number;
  z: number;
  /** 0..1, set by the hits; drives thickness and peak opacity. */
  strength: number;
  /** Seconds since the last hit. */
  age: number;
  /** The last hit reached health. */
  red: boolean;
}

/** 1 while holding, then fading to 0. */
function visibility(age: number): number {
  const c = config.damageFeedback.indicators;
  if (age <= c.holdTime) return 1;
  return Math.max(0, 1 - (age - c.holdTime) / c.fadeTime);
}

/** `#rrggbb` as [r, g, b]. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/**
 * Directional damage indicators in the style of early-2000s shooters: flat, hard-edged curved bars following an
 * invisible ring around the crosshair, drawn as a low-res sprite and blown up with nearest-neighbor scaling (no glow,
 * no smoothing). Each points at where a hit came from (straight ahead is the top of the ring, behind
 * the bottom) and turns with the view. Blue for a hit the armor took, red once it reached health. A repeat hit from
 * the same attacker refreshes and strengthens that attacker's bar; different attackers and every blast get their own.
 */
export class DamageIndicators {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly image: ImageData | null;
  private readonly indicators: Indicator[] = [];
  private readonly armorColor = rgb(config.damageFeedback.indicators.armorColor);
  private readonly healthColor = rgb(config.damageFeedback.indicators.healthColor);
  /** Sprite pixels across, and the ring radius in sprite pixels. */
  private readonly size: number;
  private readonly radius: number;
  private shown = false;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement, private readonly view: ViewTracker) {
    const c = config.damageFeedback.indicators;
    this.radius = c.ringRadius / c.pixelSize;
    this.size = Math.ceil(this.radius * EXTENT) * 2;
    this.canvas.className = 'hud-damage-ring';
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.style.setProperty('--ring-size', `${this.size * c.pixelSize * 100}vh`);
    this.canvas.style.display = 'none';
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx?.createImageData(this.size, this.size) ?? null;

    for (let i = 0; i < c.maxWedges; i++) {
      this.indicators.push({ active: false, attacker: null, x: 0, z: 0, strength: 0, age: 0, red: false });
    }
    parent.append(this.canvas);

    events.on('playerDamaged', (hit) => this.hit(hit));
  }

  private hit({ amount, position, healthDamage, attacker }: PlayerDamagedEvent): void {
    const c = config.damageFeedback.indicators;
    const strength = Math.min(1, amount / c.fullStrengthDamage);
    let indicator = attacker ? this.indicators.find((w) => w.active && w.attacker === attacker) : undefined;
    if (indicator) {
      indicator.strength = Math.min(1, Math.max(strength, indicator.strength * visibility(indicator.age) + strength * c.repeatGain));
    } else {
      indicator = this.free();
      indicator.strength = strength;
      indicator.active = true;
      indicator.attacker = attacker;
    }
    indicator.age = 0;
    indicator.x = position.x;
    indicator.z = position.z;
    // Red as soon as any of the hit reached health, including a hit that broke the last plate and spilled over.
    indicator.red = healthDamage > 0;
    this.draw();
  }

  /** An unused indicator, or the faintest one when all are showing. */
  private free(): Indicator {
    let faintest = this.indicators[0];
    for (const w of this.indicators) {
      if (!w.active) return w;
      if (w.strength * visibility(w.age) < faintest.strength * visibility(faintest.age)) faintest = w;
    }
    return faintest;
  }

  /** Redraw the sprite: every active bar, pixel by pixel, at its current angle. */
  private draw(): void {
    const c = config.damageFeedback.indicators;
    let any = false;
    for (const w of this.indicators) any ||= w.active;
    if (any !== this.shown) {
      this.shown = any;
      this.canvas.style.display = any ? '' : 'none';
    }
    if (!any || !this.ctx || !this.image) return;

    const data = this.image.data;
    data.fill(0);
    const center = this.size / 2;
    const halfArc = MathUtils.degToRad(c.arcDegrees) / 2;
    for (const w of this.indicators) {
      if (!w.active) continue;
      const halfThickness = Math.max(1.5, Math.round(this.radius * MathUtils.lerp(c.minThickness, c.maxThickness, w.strength)) / 2);
      // Hard steps instead of a smooth fade.
      const steps = Math.ceil(visibility(w.age) * c.fadeSteps) / c.fadeSteps;
      const alpha = Math.round(255 * MathUtils.lerp(c.minOpacity, c.maxOpacity, w.strength) * steps);
      const fill = w.red ? this.healthColor : this.armorColor;
      const angle = viewAngleTo(this.view, w.x, w.z);
      // Outward along the ring at the bar's middle, in sprite pixels with y down.
      const nx = Math.sin(angle);
      const ny = -Math.cos(angle);
      const reach = Math.ceil(this.radius * Math.sin(halfArc) + halfThickness) + 1;
      const x0 = Math.max(0, Math.floor(center + nx * this.radius - reach));
      const x1 = Math.min(this.size, Math.ceil(center + nx * this.radius + reach));
      const y0 = Math.max(0, Math.floor(center + ny * this.radius - reach));
      const y1 = Math.min(this.size, Math.ceil(center + ny * this.radius + reach));
      for (let y = y0; y < y1; y++) {
        const dy = y + 0.5 - center;
        for (let x = x0; x < x1; x++) {
          const dx = x + 0.5 - center;
          // A band of the ring within the bar's arc, full thickness in the middle and thinning toward the ends.
          const along = Math.abs(Math.atan2(dx * -ny + dy * nx, dx * nx + dy * ny)) / halfArc;
          if (along > 1) continue;
          const taper = MathUtils.lerp(1, c.endThickness, along * along);
          if (Math.abs(Math.hypot(dx, dy) - this.radius) > Math.max(0.6, halfThickness * taper)) continue;
          const i = (y * this.size + x) * 4;
          data[i] = fill[0];
          data[i + 1] = fill[1];
          data[i + 2] = fill[2];
          data[i + 3] = alpha;
        }
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  /** Age the bars and keep each pointing at its source as the player turns and moves. Call once per rendered frame. */
  update(dt: number): void {
    if (!this.shown) return;
    for (const w of this.indicators) {
      if (!w.active) continue;
      w.age += dt;
      if (visibility(w.age) <= 0) {
        w.active = false;
        w.attacker = null;
      }
    }
    this.draw();
  }
}
