import type { AllyTag, EventBus, GameEvents } from '../../core/EventBus';
import './Squad.css';

/** Multiplayer: each teammate's callsign floating over their head (and "DOWN" while they are down). */
export class AllyTags {
  private readonly root = document.createElement('div');
  private readonly elements = new Map<string, { root: HTMLDivElement; name: HTMLSpanElement; status: HTMLSpanElement; key: string }>();

  constructor(events: EventBus<GameEvents>, parent: HTMLElement) {
    this.root.className = 'hud-tags';
    parent.append(this.root);
    events.on('allyTags', ({ tags }) => this.place(tags));
    events.on('peerLeft', ({ id }) => {
      this.elements.get(id)?.root.remove();
      this.elements.delete(id);
    });
  }

  private place(tags: readonly AllyTag[]): void {
    for (const tag of tags) {
      let el = this.elements.get(tag.id);
      if (!el) {
        const root = document.createElement('div');
        root.className = 'hud-tag';
        const name = document.createElement('span');
        name.className = 'hud-tag__name';
        const status = document.createElement('span');
        status.className = 'hud-tag__status';
        status.textContent = 'Down';
        root.append(name, status);
        this.root.append(root);
        el = { root, name, status, key: '' };
        this.elements.set(tag.id, el);
      }
      const key = `${tag.name}:${tag.down}:${tag.visible}`;
      if (key !== el.key) {
        el.key = key;
        el.name.textContent = tag.name;
        el.root.classList.toggle('is-down', tag.down);
        el.root.hidden = !tag.visible;
      }
      if (tag.visible) el.root.style.transform = `translate(${tag.x.toFixed(1)}px, ${tag.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
