import type { EventBus, GameEvents } from '../../core/EventBus';
import { Phase } from '../../core/GameState';
import { setFixedDigits } from './digits';
import { pop } from './motion';
import './PhaseBanner.css';

/** The countdown turns red and ticks over the last seconds of the build phase. */
const WARNING_SECONDS = 10;

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Top-center line. Build phase: "BUILD PHASE  0:42  -  PRESS ENTER TO START".
 * Fight: "ENEMIES LEFT  12" (alive plus still to come). Hidden in other phases.
 */
export class PhaseBanner {
  private readonly root = document.createElement('div');
  private readonly title = document.createElement('span');
  private readonly value = document.createElement('span');
  private readonly hint = document.createElement('span');
  private phase: Phase | null = null;
  private timeText = '';
  private remaining = 0;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.root.className = 'hud-phase';
    this.title.className = 'hud-phase__title';
    this.value.className = 'hud-phase__timer';
    this.hint.className = 'hud-phase__hint';
    this.hint.textContent = '-  Press Enter to start';
    this.root.append(this.title, this.value, this.hint);
    parent.append(this.root);

    events.on('phaseChanged', ({ to }) => {
      this.phase = to;
      this.root.classList.toggle('is-shown', to === Phase.BUILD || to === Phase.FIGHT);
      this.render();
    });
    events.on('phaseTimer', ({ phase, seconds }) => {
      if (phase !== Phase.BUILD) return;
      this.timeText = formatTime(seconds);
      const warning = seconds <= WARNING_SECONDS;
      this.value.classList.toggle('is-warning', warning);
      this.render();
      if (warning && seconds > 0) pop(this.value, 1.18, 300);
    });
    events.on('enemiesRemaining', ({ count }) => {
      const fewer = count < this.remaining;
      this.remaining = count;
      if (this.phase !== Phase.FIGHT) return;
      this.render();
      if (fewer) pop(this.value, 1.12, 240);
    });
  }

  private render(): void {
    // Hidden phases keep the last text while the banner fades out.
    if (this.phase !== Phase.BUILD && this.phase !== Phase.FIGHT) return;
    const fight = this.phase === Phase.FIGHT;
    this.title.textContent = fight ? 'Enemies Left' : 'Build Phase';
    this.hint.hidden = fight;
    if (fight) this.value.classList.remove('is-warning');
    setFixedDigits(this.value, fight ? String(this.remaining) : this.timeText);
  }
}
