import { config } from '../../core/config';
import type { EventBus, GameEvents } from '../../core/EventBus';
import { formatCash } from './CashCounter';
import { EASE_OUT, prefersReducedMotion, referencePixel } from './motion';
import './CashPopups.css';

/** Seconds the snap-in takes, seconds to settle from the overshoot, and seconds of drift and fade at the end of a popup's life. */
const SNAP_TIME = 0.1;
const SETTLE_TIME = 0.25;
const FADE_TIME = 1;
/**
 * Where successive popups start, relative to the anchor, in reference pixels (y down).
 * Cycling through spread-out slots keeps a burst of kills from stacking on one spot, like the "+10" cluster in the reference.
 */
const SLOTS: readonly [number, number][] = [
  [0, 8],
  [46, -10],
  [92, -20],
  [28, 20],
  [80, 12],
  [16, -18],
];
/** Random jitter added to each slot, how far a popup drifts while it holds, and how far by the end, in reference pixels. */
const JITTER = 6;
const HOLD_DRIFT_Y = 8;
const DRIFT_X = 10;
const DRIFT_Y = 26;
const EASE_IN = 'cubic-bezier(0.55, 0, 1, 0.45)';

/**
 * Small "+$50" texts that pop out right of the cash counter, drift up and fade, like the "+10" popups in UI-Model.jpg.
 * A fixed pool of elements is reused round-robin; the oldest is recycled when all are on screen.
 */
export class CashPopups {
  private readonly pool: HTMLSpanElement[] = [];
  private readonly animations: (Animation | null)[] = [];
  private next = 0;
  private spawned = 0;

  constructor(events: EventBus<GameEvents>, anchor: HTMLElement) {
    for (let i = 0; i < config.hud.maxCashPopups; i++) {
      const popup = document.createElement('span');
      popup.className = 'hud-cash-popup';
      anchor.append(popup);
      this.pool.push(popup);
      this.animations.push(null);
    }
    events.on('cashEarned', ({ amount }) => this.spawn(amount));
  }

  private spawn(amount: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.pool.length;
    const popup = this.pool[i];
    this.animations[i]?.cancel();

    popup.textContent = `+${formatCash(amount)}`;
    const rp = referencePixel();
    const [slotX, slotY] = SLOTS[this.spawned++ % SLOTS.length];
    const x = (slotX + (Math.random() - 0.5) * JITTER) * rp;
    const y = (slotY + (Math.random() - 0.5) * JITTER) * rp;
    const at = (dx: number, dy: number, scale: number): string =>
      `translate(${x + dx * rp}px, calc(${y + dy * rp}px - 50%)) scale(${scale})`;

    // Snap in slightly oversized and settle, hold fully visible while drifting slowly up, then drift away and
    // fade over the last `FADE_TIME`. Under reduced motion it holds still, then fades over the same span.
    // The timeline runs linearly so each phase lasts its real time; each segment carries its own easing.
    const life = config.hud.cashPopupLifetime;
    const t = (seconds: number): number => Math.min(1, Math.max(0, seconds / life));
    const fadeStart = t(life - FADE_TIME);
    const keyframes: Keyframe[] = prefersReducedMotion()
      ? [
          { opacity: 1, transform: at(0, 0, 1) },
          { opacity: 1, transform: at(0, 0, 1), offset: fadeStart, easing: EASE_IN },
          { opacity: 0, transform: at(0, 0, 1) },
        ]
      : [
          { opacity: 0, transform: at(0, 3, 0.7), easing: EASE_OUT },
          { opacity: 1, transform: at(1, -1, 1.1), offset: t(SNAP_TIME), easing: EASE_OUT },
          { opacity: 1, transform: at(2, -2, 1), offset: t(SNAP_TIME + SETTLE_TIME) },
          { opacity: 1, transform: at(3, -2 - HOLD_DRIFT_Y, 1), offset: fadeStart, easing: EASE_IN },
          { opacity: 0, transform: at(DRIFT_X, -DRIFT_Y, 0.96) },
        ];
    this.animations[i] = popup.animate(keyframes, { duration: life * 1000, easing: 'linear', fill: 'forwards' });
  }
}
