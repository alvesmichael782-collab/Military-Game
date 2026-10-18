import { config } from '../../core/config';
import type { EventBus, GameEvents } from '../../core/EventBus';
import { LowHealthLevels } from '../../core/LowHealthLevels';
import { createRandom } from '../../world/random';
import { prefersReducedMotion } from './motion';
import './LowHealthOverlay.css';

/** Size the blood is painted at; the canvases are stretched over the screen (blood is soft, so this holds up). */
const WIDTH = 1280;
const HEIGHT = 800;

type Random = () => number;

/** A blood color between dried near-black and fresh dark red. */
function blood(random: Random, alpha: number): string {
  const t = random();
  const r = Math.round(40 + t * 55);
  const g = Math.round(1 + t * 6);
  const b = Math.round(3 + t * 6);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** An irregular liquid blob: a wobbly outline, dark in the middle and a little redder at the rim, with a soft edge. */
function blob(ctx: CanvasRenderingContext2D, random: Random, x: number, y: number, r: number, alpha: number): void {
  const lobes = 9 + Math.floor(random() * 5);
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2;
    const radius = r * (0.7 + random() * 0.45);
    px.push(x + Math.cos(angle) * radius);
    py.push(y + Math.sin(angle) * radius);
  }
  // A smooth closed curve: through the midpoints between outline points, bending at each point.
  ctx.beginPath();
  ctx.moveTo((px[lobes - 1] + px[0]) / 2, (py[lobes - 1] + py[0]) / 2);
  for (let i = 0; i < lobes; i++) {
    const n = (i + 1) % lobes;
    ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[n]) / 2, (py[i] + py[n]) / 2);
  }
  ctx.closePath();
  const fill = ctx.createRadialGradient(x, y, 0, x, y, r * 1.15);
  fill.addColorStop(0, `rgba(42, 1, 3, ${alpha})`);
  fill.addColorStop(0.7, `rgba(70, 3, 5, ${alpha * 0.9})`);
  fill.addColorStop(1, `rgba(96, 8, 10, ${alpha * 0.7})`);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A splatter at (x, y): a stain, a cluster of liquid blobs, thin spray streaks and droplets thrown toward (dirX, dirY). */
function splat(ctx: CanvasRenderingContext2D, random: Random, x: number, y: number, size: number, dirX: number, dirY: number): void {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 1.5);
  halo.addColorStop(0, 'rgba(56, 2, 4, 0.42)');
  halo.addColorStop(0.6, 'rgba(56, 2, 4, 0.16)');
  halo.addColorStop(1, 'rgba(56, 2, 4, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, size * 1.5, 0, Math.PI * 2);
  ctx.fill();

  const sideX = -dirY;
  const sideY = dirX;
  const heading = Math.atan2(dirY, dirX);
  // Soft-edged body: a few overlapping blobs, biggest at the impact.
  ctx.filter = 'blur(1.5px)';
  const blobs = 4 + Math.floor(random() * 3);
  for (let i = 0; i < blobs; i++) {
    const along = (i / blobs) * size * 0.55;
    const across = (random() - 0.5) * size * 0.5;
    blob(ctx, random, x + dirX * along + sideX * across, y + dirY * along + sideY * across, size * (0.42 - (i / blobs) * 0.22), 0.55 + random() * 0.25);
  }
  ctx.filter = 'none';

  // Spray: thin tapering streaks out of the body.
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const angle = heading + (random() - 0.5) * 1.3;
    const from = size * 0.3;
    const to = size * (0.5 + random() * 0.35);
    ctx.strokeStyle = blood(random, 0.3 + random() * 0.25);
    ctx.lineWidth = 1.5 + random() * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * from, y + Math.sin(angle) * from);
    ctx.lineTo(x + Math.cos(angle) * to, y + Math.sin(angle) * to);
    ctx.stroke();
  }

  // Droplets, smaller the farther they flew, staying close to the body.
  for (let i = 0; i < 26; i++) {
    const angle = heading + (random() - 0.5) * 1.8;
    const distance = size * (0.45 + random() ** 1.5 * 0.95);
    const r = Math.max(1.2, size * 0.035 * (1.4 - distance / size) * (0.4 + random()));
    ctx.fillStyle = blood(random, 0.6 + random() * 0.3);
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, r * (1 + random() * 0.6), r, angle, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A smear wiped in from an edge: several thin parallel streaks of uneven strength. */
function smear(ctx: CanvasRenderingContext2D, random: Random, x: number, y: number, angle: number, length: number, width: number): void {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const bend = (random() - 0.5) * 0.5;
  ctx.lineCap = 'round';
  const streaks = 7 + Math.floor(random() * 5);
  for (let i = 0; i < streaks; i++) {
    const offset = (i / (streaks - 1) - 0.5) * width;
    const sx = x - dirY * offset;
    const sy = y + dirX * offset;
    const reach = length * (0.6 + random() * 0.4);
    const ex = sx + Math.cos(angle + bend) * reach;
    const ey = sy + Math.sin(angle + bend) * reach;
    const cx = sx + dirX * reach * 0.5;
    const cy = sy + dirY * reach * 0.5;
    const gradient = ctx.createLinearGradient(sx, sy, ex, ey);
    gradient.addColorStop(0, blood(random, 0.22 + random() * 0.2));
    gradient.addColorStop(1, 'rgba(60, 3, 5, 0)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = (width / streaks) * (0.6 + random() * 1.2);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
  }
}

/** A thin run of blood down from the top edge, ending in a drop. */
function drip(ctx: CanvasRenderingContext2D, random: Random, x: number, length: number): void {
  const width = 2 + random() * 4;
  ctx.strokeStyle = blood(random, 0.55);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, -4);
  ctx.quadraticCurveTo(x + (random() - 0.5) * 10, length / 2, x + (random() - 0.5) * 6, length);
  ctx.stroke();
  ctx.fillStyle = blood(random, 0.7);
  ctx.beginPath();
  ctx.ellipse(x, length + width * 0.6, width * 0.9, width * 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Points around the screen edge with their inward directions: the four corners, then `perSide` per side. */
function edgeSpots(random: Random, perSide: number, inset: number): [x: number, y: number, dx: number, dy: number][] {
  const spots: [number, number, number, number][] = [
    [inset, inset, 0.707, 0.707],
    [WIDTH - inset, inset, -0.707, 0.707],
    [inset, HEIGHT - inset, 0.707, -0.707],
    [WIDTH - inset, HEIGHT - inset, -0.707, -0.707],
  ];
  for (let i = 0; i < perSide; i++) {
    const t = 0.15 + random() * 0.7;
    spots.push([t * WIDTH, inset * 0.5, 0, 1], [t * WIDTH, HEIGHT - inset * 0.5, 0, -1]);
    const u = 0.2 + random() * 0.6;
    spots.push([inset * 0.5, u * HEIGHT, 1, 0], [WIDTH - inset * 0.5, u * HEIGHT, -1, 0]);
  }
  return spots;
}

function paintWounded(ctx: CanvasRenderingContext2D, random: Random): void {
  // Dark wet edges first, so the splatters sit on a stain.
  for (const [x0, y0, x1, y1] of [[0, 0, 0, 90], [0, HEIGHT, 0, HEIGHT - 90], [0, 0, 90, 0], [WIDTH, 0, WIDTH - 90, 0]]) {
    const edge = ctx.createLinearGradient(x0, y0, x1, y1);
    edge.addColorStop(0, 'rgba(58, 2, 4, 0.55)');
    edge.addColorStop(1, 'rgba(58, 2, 4, 0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  for (const [x, y, dx, dy] of edgeSpots(random, 1, 0)) {
    const corner = dx !== 0 && dy !== 0;
    splat(ctx, random, x, y, corner ? 120 + random() * 60 : 55 + random() * 35, dx, dy);
  }
  for (let i = 0; i < 4; i++) {
    const [x, y, dx, dy] = edgeSpots(random, 1, -10)[Math.floor(random() * 8)];
    smear(ctx, random, x, y, Math.atan2(dy, dx) + (random() - 0.5) * 0.6, 150 + random() * 110, 40 + random() * 40);
  }
}

function paintCritical(ctx: CanvasRenderingContext2D, random: Random): void {
  for (const [x, y, dx, dy] of edgeSpots(random, 2, 60)) {
    const corner = dx !== 0 && dy !== 0;
    splat(ctx, random, x, y, corner ? 210 + random() * 90 : 90 + random() * 60, dx, dy);
  }
  for (let i = 0; i < 6; i++) {
    const [x, y, dx, dy] = edgeSpots(random, 2, -10)[Math.floor(random() * 12)];
    smear(ctx, random, x, y, Math.atan2(dy, dx) + (random() - 0.5) * 0.7, 260 + random() * 180, 60 + random() * 50);
  }
  for (let i = 0; i < 4; i++) {
    const side = random() < 0.5 ? 0.05 + random() * 0.25 : 0.7 + random() * 0.25;
    drip(ctx, random, WIDTH * side, 50 + random() * 90);
  }
}

function bloodCanvas(className: string, paint: (ctx: CanvasRenderingContext2D, random: Random) => void, random: Random): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = `hud-low-health__blood ${className}`;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx, random);
  return canvas;
}

/**
 * Low-health overlay: blood splatter and smears creeping in from the screen edges and corners with a dark red
 * vignette below `config.damageFeedback.lowHealth.wounded` health, reaching further in and darker below `critical`,
 * pulsing with the heartbeat. Painted once at startup and only faded by opacity, so it costs almost nothing per frame.
 * The matching edge blur and color loss are in the retro filter, on the 3D scene only.
 */
export class LowHealthOverlay {
  private readonly element = document.createElement('div');
  private readonly levels: LowHealthLevels;
  private readonly woundedVignette = document.createElement('div');
  private readonly criticalVignette = document.createElement('div');
  private readonly woundedBlood: HTMLCanvasElement;
  private readonly criticalBlood: HTMLCanvasElement;
  private shown = false;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.levels = new LowHealthLevels(events);
    const random = createRandom((Math.random() * 2 ** 32) >>> 0);
    this.element.className = 'hud-low-health';
    this.element.style.display = 'none';
    this.woundedVignette.className = 'hud-low-health__vignette hud-low-health__vignette--wounded';
    this.criticalVignette.className = 'hud-low-health__vignette hud-low-health__vignette--critical';
    this.woundedBlood = bloodCanvas('hud-low-health__blood--wounded', paintWounded, random);
    this.criticalBlood = bloodCanvas('hud-low-health__blood--critical', paintCritical, random);
    this.element.append(this.woundedVignette, this.criticalVignette, this.woundedBlood, this.criticalBlood);
    parent.append(this.element);
  }

  /** Call once per rendered frame. */
  update(dt: number): void {
    const levels = this.levels;
    levels.update(dt);
    const active = levels.active;
    if (active !== this.shown) {
      this.shown = active;
      this.element.style.display = active ? '' : 'none';
    }
    if (!active) return;

    const l = config.damageFeedback.lowHealth;
    const swell = prefersReducedMotion() ? 1 : 1 + l.pulseAmount * (levels.pulse - 0.4 * levels.critical);
    this.woundedBlood.style.opacity = String(levels.wounded);
    this.criticalBlood.style.opacity = String(Math.min(1, levels.critical * swell));
    this.woundedVignette.style.opacity = String(levels.wounded * l.vignetteWounded);
    this.criticalVignette.style.opacity = String(Math.min(1, levels.critical * l.vignetteCritical * swell));
  }
}
