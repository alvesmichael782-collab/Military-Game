import type { EventBus, GameEvents } from '../../core/EventBus';
import { createBrushSmear } from './BrushSmear';
import { setFixedDigits } from './digits';
import { EASE_OUT, pop, prefersReducedMotion } from './motion';
import './CashCounter.css';

/** How quickly the shown amount rolls toward the real one (higher = faster). About 0.4 s to settle. */
const COUNT_SPEED = 10;

export function formatCash(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}

/** Bottom left: portrait slot and the player's cash over a dark red smear, where UI-Model.jpg shows the highlighted score. */
export class CashCounter {
  /** Cash popups attach here, just right of the amount. */
  readonly popupAnchor = document.createElement('div');
  private readonly amount = document.createElement('span');
  private target = -1;
  private shown = 0;
  private shownText = '';

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud-cash';

    const portrait = document.createElement('div');
    portrait.className = 'hud-cash__portrait';

    const row = document.createElement('div');
    row.className = 'hud-cash__row';
    const smear = createBrushSmear({
      width: 160,
      height: 44,
      color: '#74141a',
      seed: 11235,
      fadeLeft: 0.3,
      fadeRight: 0.2,
      streaks: 14,
      coreOpacity: 0.85,
      coreStart: 0.08,
    });
    this.amount.className = 'hud-cash__amount';
    this.popupAnchor.className = 'hud-cash__popups';
    row.append(smear, this.amount, this.popupAnchor);

    root.append(portrait, row);
    parent.append(root);

    events.on('cashChanged', ({ cash }) => {
      // The first value (and every value under reduced motion) shows at once; later changes roll.
      if (this.target < 0 || prefersReducedMotion()) this.shown = cash;
      this.target = cash;
      this.render();
    });
    events.on('cashEarned', () => pop(this.amount, 1.08));
    events.on('cashInsufficient', () => this.flashInsufficient());
    events.on('cashSpent', () => {
      if (prefersReducedMotion()) return;
      this.amount.animate(
        [{ transform: 'translateY(calc(2 * var(--rp)))', opacity: 0.6 }, { transform: 'none', opacity: 1 }],
        { duration: 300, easing: EASE_OUT },
      );
    });
  }

  /** Tried to buy something unaffordable: the amount flashes red, with a small shake unless motion is reduced. */
  private flashInsufficient(): void {
    const x = (n: number): string => `translateX(calc(${n} * var(--rp)))`;
    const still = prefersReducedMotion();
    this.amount.animate(
      [
        { color: '#ff3a30', transform: x(0) },
        { color: '#ff3a30', transform: x(still ? 0 : -4), offset: 0.15 },
        { transform: x(still ? 0 : 4), offset: 0.35 },
        { transform: x(still ? 0 : -2), offset: 0.55 },
        { color: 'var(--hud-white)', transform: x(0) },
      ],
      { duration: 550, easing: 'ease-out' },
    );
  }

  /** Roll the shown amount toward the real one. Call once per rendered frame. */
  update(dt: number): void {
    if (this.target < 0 || this.shown === this.target) return;
    const step = (this.target - this.shown) * (1 - Math.exp(-COUNT_SPEED * dt));
    // Always move at least a dollar so the roll finishes instead of creeping forever.
    this.shown += Math.sign(step) * Math.max(1, Math.abs(step));
    if ((step > 0 && this.shown > this.target) || (step < 0 && this.shown < this.target)) this.shown = this.target;
    this.render();
  }

  private render(): void {
    const text = formatCash(this.shown);
    if (text === this.shownText) return;
    this.shownText = text;
    setFixedDigits(this.amount, text);
  }
}
