import { config } from '../../core/config';
import type { EventBus, GameEvents } from '../../core/EventBus';
import { EASE_OUT, prefersReducedMotion } from './motion';
import './ArmorBar.css';

/** Seconds the flash lasts when a plate breaks. */
const BREAK_FLASH_TIME = 0.4;

interface Segment {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  trail: HTMLDivElement;
  plating: HTMLDivElement;
  amount: number;
}

function clip(amount: number): string {
  return `inset(0 ${((1 - amount) * 100).toFixed(2)}% 0 0)`;
}

/**
 * Armor bar split into plate segments, right of the wave number. Filled segments show a blue top edge,
 * empty ones dim gray; they drain right to left. Lost armor lingers as a faint trail before it catches up,
 * a segment flashes when its plate breaks and pops when a plate goes back on.
 * While a plate goes on, the segment being restored shows its progress.
 */
export class ArmorBar {
  private readonly segments: Segment[] = [];
  private armor = -1;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud-armor';
    for (let i = 0; i < config.armor.maxPlates; i++) {
      const segment = document.createElement('div');
      segment.className = 'hud-armor__segment';
      const trail = document.createElement('div');
      trail.className = 'hud-armor__trail';
      const fill = document.createElement('div');
      fill.className = 'hud-armor__fill';
      const plating = document.createElement('div');
      plating.className = 'hud-armor__plating';
      segment.append(trail, fill, plating);
      root.append(segment);
      this.segments.push({ root: segment, fill, trail, plating, amount: -1 });
    }
    parent.append(root);

    events.on('armorChanged', ({ armor }) => this.setArmor(armor));
    events.on('plateProgress', ({ progress }) => this.setPlating(progress));
  }

  private setArmor(armor: number): void {
    const first = this.armor < 0;
    this.armor = armor;
    const per = config.armor.armorPerPlate;
    this.segments.forEach((segment, i) => {
      const amount = Math.min(1, Math.max(0, (armor - i * per) / per));
      if (amount === segment.amount) return;
      const before = segment.amount;
      segment.amount = amount;
      // Losing armor: the fill drops at once and the trail follows after a beat. Gaining: both move together.
      segment.root.classList.toggle('is-draining', !first && amount < before);
      segment.fill.style.clipPath = clip(amount);
      segment.trail.style.clipPath = clip(amount);
      if (first) return;
      if (before > 0 && amount === 0) this.flash(segment);
      else if (amount > before) this.snap(segment);
    });
  }

  /** `progress` 0..1 through the plate going on; 0 hides the progress fill. */
  private setPlating(progress: number): void {
    // The plate fills the first segment that is not full.
    const restoring = progress > 0 ? Math.min(this.segments.length - 1, Math.floor(this.armor / config.armor.armorPerPlate)) : -1;
    this.segments.forEach((segment, i) => {
      const width = i === restoring ? progress : 0;
      segment.plating.style.transform = `scaleX(${width.toFixed(3)})`;
      segment.plating.style.opacity = width > 0 ? '1' : '0';
    });
  }

  /** The plate shattering: a white-hot edge that cools back to the empty gray. */
  private flash(segment: Segment): void {
    const lift = prefersReducedMotion() ? 'none' : 'translateY(calc(-1.5 * var(--rp)))';
    segment.root.animate(
      [
        { borderColor: '#ffffff', filter: 'drop-shadow(0 0 3px rgba(150, 205, 255, 0.9))', transform: lift },
        { borderColor: '#9fd0ff', offset: 0.3 },
        { borderColor: 'rgba(140, 140, 132, 0.7)', filter: 'none', transform: 'none' },
      ],
      { duration: BREAK_FLASH_TIME * 1000, easing: 'ease-out' },
    );
  }

  /** A plate seating: the segment kicks up and settles. */
  private snap(segment: Segment): void {
    if (prefersReducedMotion()) return;
    segment.root.animate(
      [{ transform: 'translateY(calc(-2 * var(--rp))) scaleY(1.25)' }, { transform: 'none' }],
      { duration: 280, easing: EASE_OUT },
    );
  }
}
