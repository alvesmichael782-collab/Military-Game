import { setFixedDigits } from './digits';
import { prefersReducedMotion } from './motion';
import './CenterPrompt.css';

/**
 * One short text block under the crosshair: a main line (action and price) and an optional red reason line.
 * Shared by the build tool and the armor crate prompts.
 */
export class CenterPrompt {
  private readonly root = document.createElement('div');
  private readonly action = document.createElement('span');
  private readonly amount = document.createElement('span');
  private readonly error = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.root.className = 'hud-prompt';
    const line = document.createElement('div');
    line.className = 'hud-prompt__line';
    this.action.className = 'hud-prompt__action';
    this.amount.className = 'hud-prompt__amount';
    this.error.className = 'hud-prompt__error';
    line.append(this.action, this.amount);
    this.root.append(line, this.error);
    this.hide();
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** `amount` is a HUD-made money string such as "$100" or "+$50"; `tone` colors it. */
  show(action: string, amount: string, tone: 'cost' | 'refund', error: string | null): void {
    this.root.hidden = false;
    this.action.textContent = action;
    setFixedDigits(this.amount, amount);
    this.amount.dataset.tone = tone;
    this.error.textContent = error ?? '';
    this.error.hidden = error === null;
    this.root.classList.toggle('is-invalid', error !== null);
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** The player tried anyway: a short shake so the reason gets read. */
  deny(): void {
    if (!this.visible || prefersReducedMotion()) return;
    const x = (n: number): string => `translateX(calc(${n} * var(--rp)))`;
    this.root.animate(
      [{ transform: x(0) }, { transform: x(-5) }, { transform: x(5) }, { transform: x(-3) }, { transform: x(2) }, { transform: x(0) }],
      { duration: 280, easing: 'ease-out' },
    );
  }
}
