import { MathUtils } from 'three';
import { config } from '../../core/config';
import type { EventBus, GameEvents } from '../../core/EventBus';
import { verticalFovFrom4x3 } from '../../player/FPSCamera';
import './Crosshair.css';

/** Line length and thickness, and the smallest gap from center, in CSS pixels. */
const LENGTH = 5;
const THICKNESS = 2;
const MIN_GAP = 3;
const MAX_GAP = 90;

const tanHalfFov = (horizontalDegrees: number): number =>
  Math.tan(MathUtils.degToRad(verticalFovFrom4x3(horizontalDegrees)) / 2);

/**
 * Small four-line crosshair whose gap opens with weapon spread. Shown only while the player is in control;
 * fades out as the sights come up and is hidden while fully aimed (the hit marker stays).
 */
export class Crosshair {
  private readonly element = document.createElement('div');
  private readonly lines: HTMLDivElement[] = [];
  private targetSpread = 0;
  private spread = 0;
  private lastGap = -1;
  private tanHalfFov = tanHalfFov(config.camera.fov);
  private controlled = false;
  private aimAmount = 0;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.element.className = 'hud-crosshair';
    for (let i = 0; i < 4; i++) {
      const line = document.createElement('div');
      const horizontal = i < 2;
      line.className = 'hud-crosshair__line';
      line.style.width = `${horizontal ? LENGTH : THICKNESS}px`;
      line.style.height = `${horizontal ? THICKNESS : LENGTH}px`;
      this.lines.push(line);
      this.element.append(line);
    }
    this.element.style.display = 'none';
    parent.append(this.element);

    events.on('weaponSpreadChanged', ({ spread }) => {
      this.targetSpread = spread;
    });
    events.on('playerControlChanged', ({ active }) => {
      this.controlled = active;
      this.refreshVisibility();
    });
    events.on('adsProgress', ({ amount, fov }) => {
      this.aimAmount = amount;
      this.tanHalfFov = tanHalfFov(fov);
      // Zooming changes how wide the spread cone looks on screen.
      this.lastGap = -1;
      this.refreshVisibility();
    });
  }

  private refreshVisibility(): void {
    const shown = this.controlled && this.aimAmount < 1;
    this.element.style.display = shown ? 'block' : 'none';
    this.element.style.opacity = String(1 - this.aimAmount);
  }

  update(dt: number): void {
    this.spread += (this.targetSpread - this.spread) * (1 - Math.exp(-config.hud.crosshairSpeed * dt));
    // Where the edge of the spread cone lands on screen.
    const spreadPx = (Math.tan(this.spread) / this.tanHalfFov) * (window.innerHeight / 2);
    const gap = Math.round(Math.min(MAX_GAP, MIN_GAP + spreadPx));
    if (gap === this.lastGap) return;
    this.lastGap = gap;

    const half = THICKNESS / 2;
    const [left, right, top, bottom] = this.lines;
    left.style.transform = `translate(${-gap - LENGTH}px, ${-half}px)`;
    right.style.transform = `translate(${gap}px, ${-half}px)`;
    top.style.transform = `translate(${-half}px, ${-gap - LENGTH}px)`;
    bottom.style.transform = `translate(${-half}px, ${gap}px)`;
  }
}
