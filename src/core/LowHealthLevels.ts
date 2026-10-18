import { MathUtils } from 'three';
import { config } from './config';
import type { EventBus, GameEvents } from './EventBus';

/** Seconds into a beat of the second ("dub") thump, and the width of each thump. */
const DUB_TIME = 0.2;
const THUMP_WIDTH = 0.07;

function thump(t: number, center: number): number {
  const x = (t - center) / THUMP_WIDTH;
  return Math.exp(-x * x);
}

/**
 * How strong the low-health effects are right now, from `healthChanged` alone. `wounded` grows from below
 * `config.damageFeedback.lowHealth.wounded` health to 1 at `critical`; `critical` grows below that. Both ease toward
 * their targets, so the effects fade in and out (also when health refills at the start of a build phase), and a
 * heartbeat `pulse` beats while critical. The HUD's blood overlay and the retro filter's blur each own one, fed the
 * same frame times, so they stay in step without reading each other.
 */
export class LowHealthLevels {
  wounded = 0;
  critical = 0;
  /** 0..1 heartbeat swell, already scaled by `critical`. */
  pulse = 0;

  private woundedTarget = 0;
  private criticalTarget = 0;
  private beat = 0;

  /** `onBeat` is called at each heartbeat while critical. */
  constructor(events: EventBus<GameEvents>, private readonly onBeat?: (strength: number) => void) {
    events.on('healthChanged', ({ health, maxHealth }) => this.setHealth(health / maxHealth));
  }

  /** Any effect showing at all. */
  get active(): boolean {
    return this.wounded > 0.001 || this.critical > 0.001;
  }

  private setHealth(fraction: number): void {
    const l = config.damageFeedback.lowHealth;
    this.woundedTarget = fraction < l.wounded
      ? MathUtils.lerp(l.woundedOnset, 1, MathUtils.clamp((l.wounded - fraction) / (l.wounded - l.critical), 0, 1))
      : 0;
    this.criticalTarget = fraction < l.critical
      ? MathUtils.lerp(l.criticalOnset, 1, MathUtils.clamp((l.critical - fraction) / l.critical, 0, 1))
      : 0;
  }

  /** Call once per rendered frame. */
  update(dt: number): void {
    const l = config.damageFeedback.lowHealth;
    const k = 1 - Math.exp(-l.easeSpeed * dt);
    this.wounded += (this.woundedTarget - this.wounded) * k;
    this.critical += (this.criticalTarget - this.critical) * k;
    if (this.wounded < 0.001 && this.woundedTarget === 0) this.wounded = 0;
    if (this.critical < 0.001 && this.criticalTarget === 0) this.critical = 0;

    if (this.critical <= 0) {
      this.beat = 0;
      this.pulse = 0;
      return;
    }
    // Lub-dub: a strong thump at the start of each beat and a softer one just after.
    const before = this.beat;
    this.beat = (this.beat + dt * l.pulseRate) % 1;
    if (this.beat < before || (before === 0 && dt > 0)) this.onBeat?.(this.critical);
    const t = this.beat / l.pulseRate;
    this.pulse = Math.max(thump(t, 0.05), 0.6 * thump(t, 0.05 + DUB_TIME)) * this.critical;
  }
}
