import { config } from './config';
import type { EventBus, GameEvents, GameOverReason } from './EventBus';

export const Phase = {
  BUILD: 'BUILD',
  FIGHT: 'FIGHT',
  AFTERMATH: 'AFTERMATH',
  WON: 'WON',
  LOST: 'LOST',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

function durationOf(phase: Phase): number {
  switch (phase) {
    case Phase.BUILD:
      return config.phases.buildDuration;
    case Phase.FIGHT:
      // Only a safety net: the fight ends when the wave is cleared.
      return config.phases.fightTimeout;
    case Phase.AFTERMATH:
      return config.phases.aftermathDuration;
    case Phase.WON:
    case Phase.LOST:
      return 0;
  }
}

/**
 * Phase state machine: BUILD -> FIGHT -> AFTERMATH -> BUILD (next wave),
 * ending in WON after the final wave's AFTERMATH, or LOST at any time.
 * FIGHT ends when the wave director reports `waveCleared` (or after a long safety timeout).
 */
export class GameState {
  private _phase: Phase = Phase.BUILD;
  private _wave = 1;
  private _timeRemaining = durationOf(Phase.BUILD);
  private started = false;
  /** Last whole-second countdown announced, so `phaseTimer` fires once per second. */
  private announcedSeconds = -1;
  /** The wave was cleared; the fight ends on the next update, after every `waveCleared` listener has run. */
  private clearPending = false;

  constructor(private readonly events: EventBus<GameEvents>) {
    events.on('playerDied', () => this.lose('playerDied'));
    events.on('coreDestroyed', () => this.lose('coreDestroyed'));
    events.on('waveCleared', ({ wave }) => {
      if (this._phase === Phase.FIGHT && wave === this._wave) this.clearPending = true;
    });
  }

  get phase(): Phase {
    return this._phase;
  }

  get wave(): number {
    return this._wave;
  }

  /** Seconds left in the current phase (in FIGHT, until the safety timeout). Always 0 once the game is over. */
  get timeRemaining(): number {
    return this._timeRemaining;
  }

  get isOver(): boolean {
    return this._phase === Phase.WON || this._phase === Phase.LOST;
  }

  /** Enter the first BUILD phase and announce it. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.events.emit('phaseChanged', { from: null, to: this._phase, wave: this._wave });
    this.announceTimer();
  }

  /** Advance phase timers. Call from the fixed-step update. */
  update(dt: number): void {
    if (!this.started || this.isOver) return;
    if (this.clearPending) {
      this.clearPending = false;
      if (this._phase === Phase.FIGHT) this.advance();
      return;
    }
    this._timeRemaining -= dt;
    // Loop so leftover time carries into the next phase instead of being dropped.
    while (this._timeRemaining <= 0 && !this.isOver) {
      const overflow = this._timeRemaining;
      this.advance();
      if (!this.isOver) this._timeRemaining += overflow;
    }
    this.announceTimer();
  }

  /** The player is ready: end the build phase now and start the wave. */
  startWaveEarly(): void {
    if (this.started && this._phase === Phase.BUILD) this.advance();
  }

  /** The player is done reading the wave summary: go straight to the next build phase. */
  skipAftermath(): void {
    if (this.started && this._phase === Phase.AFTERMATH) this.advance();
  }

  /** Debug: end the current phase now. */
  skipPhase(): void {
    if (!this.started || this.isOver) return;
    this.advance();
  }

  /** End the game as a loss immediately (player died, core destroyed, or the debug key). */
  lose(reason: GameOverReason = 'forced'): void {
    if (!this.started || this.isOver) return;
    this.transition(Phase.LOST);
    this.events.emit('gameOver', { result: 'lost', reason, wave: this._wave });
  }

  private advance(): void {
    switch (this._phase) {
      case Phase.BUILD:
        this.transition(Phase.FIGHT);
        break;
      case Phase.FIGHT:
        this.clearPending = false;
        this.transition(Phase.AFTERMATH);
        break;
      case Phase.AFTERMATH:
        if (this._wave >= config.waves.total) {
          this.transition(Phase.WON);
          this.events.emit('gameOver', { result: 'won', reason: 'held', wave: this._wave });
        } else {
          this._wave += 1;
          this.transition(Phase.BUILD);
        }
        break;
      case Phase.WON:
      case Phase.LOST:
        break;
    }
  }

  private transition(to: Phase): void {
    const from = this._phase;
    this._phase = to;
    this._timeRemaining = durationOf(to);
    this.events.emit('phaseChanged', { from, to, wave: this._wave });
    this.announcedSeconds = -1;
    this.announceTimer();
  }

  private announceTimer(): void {
    const seconds = Math.max(0, Math.ceil(this._timeRemaining));
    if (seconds === this.announcedSeconds) return;
    this.announcedSeconds = seconds;
    this.events.emit('phaseTimer', { phase: this._phase, seconds });
  }
}
