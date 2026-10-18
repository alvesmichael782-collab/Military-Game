import { config } from '../../core/config';
import type { EventBus, GameEvents } from '../../core/EventBus';
import { createRandom } from '../../world/random';
import { viewAngleTo, type ViewTracker } from './ViewTracker';
import './ArmorShatter.css';

/**
 * A crack layout in its own frame: the impact point at the origin, cracks running mostly toward +x (into the screen),
 * one unit being the screen diagonal.
 */
interface CrackLayout {
  /** Polylines as x, y pairs, each with its stroke width at the start in CSS pixels (it tapers along the line). */
  readonly lines: { readonly points: readonly number[]; readonly width: number }[];
  /** Glass facets between cracks, as x, y pairs. */
  readonly shards: (readonly number[])[];
}

/** Distances from the impact where the spider-web rings cross the radial cracks, and the chance of each link. */
const RING_RADII = [0.028, 0.06, 0.1, 0.16, 0.24];
const RING_CHANCE = [0.95, 0.85, 0.65, 0.42, 0.25];

type Random = () => number;

function grow(
  random: Random,
  lines: CrackLayout['lines'][number][],
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  depth: number,
): number[] {
  const points = [x, y];
  let travelled = 0;
  let direction = angle;
  while (travelled < length) {
    const step = 0.018 + random() * 0.03;
    direction += (random() - 0.5) * 0.4;
    x += Math.cos(direction) * step;
    y += Math.sin(direction) * step;
    travelled += step;
    points.push(x, y);
    // Branches split off at a slant and run out shorter and thinner.
    if (depth < 2 && travelled > 0.05 && random() < 0.11 - depth * 0.04) {
      const side = random() < 0.5 ? -1 : 1;
      grow(random, lines, x, y, direction + side * (0.35 + random() * 0.5), (length - travelled) * (0.3 + random() * 0.45), width * 0.6, depth + 1);
    }
  }
  lines.push({ points, width });
  return points;
}

/** The first point of `line` at least `radius` from the impact, or null if the crack is shorter. */
function pointAt(line: readonly number[], radius: number): [number, number] | null {
  for (let i = 0; i < line.length; i += 2) {
    if (Math.hypot(line[i], line[i + 1]) >= radius) return [line[i], line[i + 1]];
  }
  return null;
}

function createLayout(random: Random): CrackLayout {
  const lines: CrackLayout['lines'][number][] = [];
  // Radial cracks fanning into the screen, roughly evenly spaced.
  const count = 10 + Math.floor(random() * 4);
  const spread = Math.PI * 1.25;
  const radials: number[][] = [];
  for (let i = 0; i < count; i++) {
    const angle = -spread / 2 + (i + 0.5 + (random() - 0.5) * 0.7) * (spread / count);
    const forward = Math.abs(angle) < 1.1;
    const length = forward ? 0.6 + random() * 0.7 : 0.3 + random() * 0.35;
    radials.push(grow(random, lines, 0, 0, angle, length, 2.2 + random() * 1.2, 0));
  }
  // A few short ones back toward the screen edge behind the impact.
  for (let i = 0; i < 3; i++) {
    grow(random, lines, 0, 0, Math.PI + (random() - 0.5) * 1.6, 0.05 + random() * 0.08, 1.6, 2);
  }

  // Spider-web rings linking neighboring radial cracks, with a slight inward bow.
  RING_RADII.forEach((radius, k) => {
    for (let i = 0; i + 1 < radials.length; i++) {
      if (random() > RING_CHANCE[k]) continue;
      const a = pointAt(radials[i], radius);
      const b = pointAt(radials[i + 1], radius * (0.9 + random() * 0.2));
      if (!a || !b) continue;
      const bow = 0.88 + random() * 0.08;
      const mx = ((a[0] + b[0]) / 2) * bow + (random() - 0.5) * 0.006;
      const my = ((a[1] + b[1]) / 2) * bow + (random() - 0.5) * 0.006;
      lines.push({ points: [a[0], a[1], mx, my, b[0], b[1]], width: 1.4 - k * 0.15 });
    }
  });

  // Crushed glass right at the impact.
  for (let i = 0; i < 16; i++) {
    const angle = random() * Math.PI * 2;
    const r = 0.003 + random() * 0.016;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    const turn = angle + Math.PI / 2 + (random() - 0.5);
    const l = 0.004 + random() * 0.008;
    lines.push({ points: [x, y, x + Math.cos(turn) * l, y + Math.sin(turn) * l], width: 1 });
  }

  // Facets: cells between two neighboring radial cracks and two rings, near the impact.
  const shards: number[][] = [];
  const facets = 5 + Math.floor(random() * 4);
  for (let tries = 0; tries < 40 && shards.length < facets; tries++) {
    const i = Math.floor(random() * (radials.length - 1));
    const k = Math.floor(random() * 3);
    const corners = [
      pointAt(radials[i], RING_RADII[k]),
      pointAt(radials[i + 1], RING_RADII[k]),
      pointAt(radials[i + 1], RING_RADII[k + 1]),
      pointAt(radials[i], RING_RADII[k + 1]),
    ];
    if (corners.some((c) => c === null)) continue;
    shards.push(corners.flatMap((c) => c as [number, number]));
  }
  return { lines, shards };
}

/** `#rrggbb` as an `rgba()` string. */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Broken glass over the whole screen when the last armor plate breaks: procedural cracks radiating from the side the
 * breaking hit came from, with a bright impact point, branching cracks and a few blue-tinted shards. It snaps in with
 * a short blue-white flash, holds, then fades. A few layouts are generated at startup; each break picks one.
 */
export class ArmorShatter {
  private readonly element = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly flash = document.createElement('div');
  private readonly layouts: CrackLayout[] = [];
  private readonly random: Random = createRandom((Math.random() * 2 ** 32) >>> 0);
  private time = -1;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement, private readonly view: ViewTracker) {
    this.element.className = 'hud-shatter';
    this.element.style.display = 'none';
    this.canvas.className = 'hud-shatter__cracks';
    this.flash.className = 'hud-shatter__flash';
    this.element.append(this.flash, this.canvas);
    parent.append(this.element);
    for (let i = 0; i < config.damageFeedback.shatter.layouts; i++) this.layouts.push(createLayout(this.random));

    events.on('armorBroken', ({ position }) => this.play(viewAngleTo(this.view, position.x, position.z)));
  }

  /** `angle` is the hit's screen direction, clockwise from straight up. */
  private play(angle: number): void {
    const s = config.damageFeedback.shatter;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    // Sized only while showing, so the full-screen buffer is not held the rest of the time.
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);

    // Where the line from the middle toward the hit meets the screen edge, pulled in by `edgeInset`.
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const reach = Math.min(
      Math.abs(dx) > 1e-4 ? (width * (0.5 - s.edgeInset)) / Math.abs(dx) : Infinity,
      Math.abs(dy) > 1e-4 ? (height * (0.5 - s.edgeInset)) / Math.abs(dy) : Infinity,
    );
    const x = width / 2 + dx * reach;
    const y = height / 2 + dy * reach;

    const layout = this.layouts[Math.floor(this.random() * this.layouts.length)];
    this.draw(layout, x, y, Math.atan2(-dy, -dx), dpr);
    this.flash.style.setProperty('--x', `${x}px`);
    this.flash.style.setProperty('--y', `${y}px`);
    this.time = 0;
    this.element.style.display = '';
    this.apply();
  }

  private draw(layout: CrackLayout, x: number, y: number, rotation: number, dpr: number): void {
    const s = config.damageFeedback.shatter;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const scale = Math.hypot(this.canvas.width, this.canvas.height);
    const cos = Math.cos(rotation) * scale;
    const sin = Math.sin(rotation) * scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(cos, sin, -sin, cos, x * dpr, y * dpr);
    /** CSS pixels to layout units. */
    const px = dpr / scale;

    // A faint frosting around the impact.
    const frost = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.32);
    frost.addColorStop(0, rgba(s.shardTint, 0.22));
    frost.addColorStop(1, rgba(s.shardTint, 0));
    ctx.fillStyle = frost;
    ctx.fillRect(-0.4, -0.4, 0.8, 0.8);

    for (const shard of layout.shards) {
      ctx.beginPath();
      ctx.moveTo(shard[0], shard[1]);
      for (let i = 2; i < shard.length; i += 2) ctx.lineTo(shard[i], shard[i + 1]);
      ctx.closePath();
      const tint = ctx.createLinearGradient(shard[0], shard[1], shard[4], shard[5]);
      tint.addColorStop(0, rgba(s.shardTint, 0.45));
      tint.addColorStop(0.55, rgba(s.shardTint, 0.16));
      tint.addColorStop(1, 'rgba(255, 255, 255, 0.36)');
      ctx.fillStyle = tint;
      ctx.fill();
      // A white glint along the facet's inner edge.
      ctx.beginPath();
      ctx.moveTo(shard[0], shard[1]);
      ctx.lineTo(shard[2], shard[3]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // A dark edge under each crack first, then the bright fracture line, tapering along its length.
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass === 0 ? 'rgba(12, 24, 40, 0.38)' : rgba(s.crackColor, 0.92);
      for (const { points, width } of layout.lines) {
        const segments = points.length / 2 - 1;
        for (let i = 0; i < segments; i++) {
          const taper = 1 - 0.75 * (i / Math.max(1, segments));
          ctx.lineWidth = (width * taper + (pass === 0 ? 1.6 : 0)) * px;
          ctx.beginPath();
          ctx.moveTo(points[i * 2], points[i * 2 + 1]);
          ctx.lineTo(points[i * 2 + 2], points[i * 2 + 3]);
          ctx.stroke();
        }
      }
    }

    // The bright impact point.
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.045);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    glow.addColorStop(0.25, rgba(s.crackColor, 0.85));
    glow.addColorStop(1, rgba(s.shardTint, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 0.045, 0, Math.PI * 2);
    ctx.fill();
  }

  private apply(): void {
    const s = config.damageFeedback.shatter;
    const t = this.time;
    const cracks = t <= s.holdTime ? 1 : Math.max(0, 1 - (t - s.holdTime) / s.fadeTime);
    this.canvas.style.opacity = String(cracks);
    this.flash.style.opacity = String(Math.max(0, s.flashOpacity * (1 - t / s.flashTime)));
  }

  /** Call once per rendered frame. */
  update(dt: number): void {
    if (this.time < 0) return;
    const s = config.damageFeedback.shatter;
    this.time += dt;
    if (this.time >= s.holdTime + s.fadeTime) {
      this.time = -1;
      this.element.style.display = 'none';
      this.canvas.width = 1;
      this.canvas.height = 1;
      return;
    }
    this.apply();
  }
}
