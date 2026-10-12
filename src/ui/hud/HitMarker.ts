import type { EventBus, GameEvents } from '../../core/EventBus';
import './Crosshair.css';

/** Seconds the marker stays visible after a hit, and after a kill. */
const HIT_TIME = 0.12;
const KILL_TIME = 0.3;
const HIT_COLOR = '#ffffff';
const KILL_COLOR = '#ff4a3a';
/** Distance of each tick from center and its length, in CSS pixels. */
const OFFSET = 5;
const LENGTH = 5;

/** Small X of four diagonal ticks around the crosshair when the player's shot lands. Red on a kill. */
export class HitMarker {
  private readonly element = document.createElement('div');
  private readonly ticks: HTMLDivElement[] = [];
  private timer = 0;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.element.className = 'hud-hitmarker';
    this.element.style.display = 'none';
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const tick = document.createElement('div');
      tick.className = 'hud-hitmarker__tick';
      const angle = Math.atan2(sy, sx);
      const distance = OFFSET + LENGTH / 2;
      tick.style.width = `${LENGTH}px`;
      tick.style.height = '2px';
      tick.style.transform =
        `translate(${Math.cos(angle) * distance - LENGTH / 2}px, ${Math.sin(angle) * distance - 1}px) rotate(${angle}rad)`;
      this.ticks.push(tick);
      this.element.append(tick);
    }
    parent.append(this.element);

    events.on('damageDealt', ({ source, target, killed }) => {
      // Only things worth shooting get a marker; hitting your own walls or core does not.
      if (source === 'player' && target.kind === 'enemy') this.show(killed);
    });
  }

  update(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) this.element.style.display = 'none';
  }

  private show(killed: boolean): void {
    this.timer = killed ? KILL_TIME : HIT_TIME;
    for (const tick of this.ticks) tick.style.background = killed ? KILL_COLOR : HIT_COLOR;
    this.element.style.display = 'block';
  }
}
