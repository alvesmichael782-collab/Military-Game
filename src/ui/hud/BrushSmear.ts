import { createRandom } from '../../world/random';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface BrushSmearOptions {
  /** Size of the drawing, in viewBox units. The SVG stretches to whatever box CSS gives it. */
  width: number;
  height: number;
  color: string;
  /** Same seed, same smear. */
  seed: number;
  /** Fraction of the width over which the smear fades out at each end. */
  fadeLeft: number;
  fadeRight: number;
  /** Loose bristle streaks around the solid core. More reads as a rougher brush. */
  streaks: number;
  /** Opacity of the solid core band. */
  coreOpacity: number;
  /** Where the solid core begins, as a fraction of the width. Left of it there are only streaks. */
  coreStart: number;
}

let nextId = 0;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function polygon(points: [number, number][]): string {
  return 'M' + points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z';
}

/** A tapered horizontal streak with a ragged top and bottom edge. */
function streak(rand: () => number, x0: number, x1: number, y: number, thickness: number): string {
  const steps = 14;
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Thin at both ends, a quicker taper at the start like a brush touching down.
    const taper = Math.min(1, t / 0.18, (1 - t) / 0.3);
    const half = (thickness / 2) * Math.max(0.15, taper) * (0.75 + rand() * 0.5);
    const x = x0 + (x1 - x0) * t;
    const wobble = (rand() - 0.5) * thickness * 0.3;
    top.push([x, y + wobble - half]);
    bottom.push([x, y + wobble + half]);
  }
  return polygon([...top, ...bottom.reverse()]);
}

/**
 * The solid middle of the stroke: ragged top and bottom edges that pinch in toward each end,
 * like a brush landing and lifting off, with a few bristle tips past the right end.
 */
function core(rand: () => number, w: number, h: number, start: number): string {
  const x0 = w * (start + rand() * 0.04);
  const x1 = w * (0.9 + rand() * 0.04);
  const steps = 32;
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    // Full height through the middle, narrowing to about half at the ends.
    const body = 0.55 + 0.45 * Math.min(1, t / 0.08, (1 - t) / 0.16);
    top.push([x, h * (0.5 - 0.27 * body - rand() * 0.05)]);
    bottom.push([x, h * (0.5 + 0.27 * body + rand() * 0.05)]);
  }
  const rightEnd: [number, number][] = [0.4, 0.47, 0.53, 0.6].map((f, i) => [
    x1 + w * (i % 2 === 0 ? 0.015 + rand() * 0.035 : rand() * 0.01),
    h * f,
  ]);
  const leftEnd: [number, number][] = [0.6, 0.5, 0.4].map((f) => [x0 - w * rand() * 0.03, h * f]);
  return polygon([...top, ...rightEnd, ...bottom.reverse(), ...leftEnd]);
}

/**
 * A rough red paint smear like the ones behind the score and ammo in UI-Model.jpg: a solid core,
 * loose bristle streaks, soft edges, and a fade at either end. Built once as inline SVG.
 */
export function createBrushSmear(o: BrushSmearOptions): SVGSVGElement {
  const id = `hud-smear-${nextId++}`;
  const rand = createRandom(o.seed);
  const { width: w, height: h } = o;

  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', class: 'hud-smear', 'aria-hidden': 'true' });

  const gradient = el('linearGradient', { id: `${id}-fade`, x1: 0, x2: 1, y1: 0, y2: 0 });
  const stops: [number, number][] = [
    [0, 0],
    [o.fadeLeft, 1],
    [1 - o.fadeRight, 1],
    [1, 0],
  ];
  for (const [offset, opacity] of stops) {
    gradient.append(el('stop', { offset, 'stop-color': '#fff', 'stop-opacity': opacity }));
  }
  const mask = el('mask', { id: `${id}-mask`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: w, height: h });
  mask.append(el('rect', { x: 0, y: 0, width: w, height: h, fill: `url(#${id}-fade)` }));
  const filter = el('filter', { id: `${id}-soft`, x: '-5%', y: '-20%', width: '110%', height: '140%' });
  filter.append(el('feGaussianBlur', { stdDeviation: Math.max(0.6, h * 0.025) }));
  const defs = el('defs', {});
  defs.append(gradient, mask, filter);

  const paint = el('g', { fill: o.color, mask: `url(#${id}-mask)`, filter: `url(#${id}-soft)` });
  paint.append(el('path', { d: core(rand, w, h, o.coreStart), opacity: o.coreOpacity }));
  for (let i = 0; i < o.streaks; i++) {
    // Streaks bunch toward the middle of the stroke, with a few strays at the edges.
    const y = h * (0.5 + (rand() + rand() + rand() - 1.5) * 0.42);
    const thickness = h * (0.04 + rand() * 0.12);
    const x0 = w * rand() * 0.45;
    const x1 = w * (0.55 + rand() * 0.45);
    paint.append(el('path', { d: streak(rand, x0, x1, y, thickness), opacity: (0.25 + rand() * 0.6).toFixed(2) }));
  }

  svg.append(defs, paint);
  return svg;
}
