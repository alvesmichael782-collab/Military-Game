import { config } from '../config';
import type { EventBus, GameEvents } from '../EventBus';
import type { SoundBank, SoundHandle } from './SoundBank';

/** Crossfade between the last shot and the fire tail, in milliseconds (as for the rifle). */
const TAIL_CROSSFADE_MS = 10;

/**
 * The mounted MG's sounds: each round, the burst's tail, the overheat lock and mounting or dismounting.
 * Played flat (2D), like the player's own rifle. Ids without files stay silent.
 */
export function connectMgSounds(events: EventBus<GameEvents>, sounds: SoundBank): void {
  const ids = config.mg.sounds;
  let lastShot: SoundHandle = 0;
  let lastShotAt = 0;
  events.on('mgFired', () => {
    lastShot = sounds.play(ids.fire);
    lastShotAt = performance.now();
  });
  events.on('mgBurstEnded', () => {
    // Without a tail recording the last shot rings out on its own instead of being cut for a silent tail.
    if (!sounds.has(ids.fireTail)) return;
    const offset = (performance.now() - lastShotAt) / 1000;
    sounds.stop(lastShot, TAIL_CROSSFADE_MS);
    lastShot = 0;
    sounds.play(ids.fireTail, offset > 0.005 ? { offset, fadeIn: TAIL_CROSSFADE_MS } : undefined);
  });
  events.on('mgOverheated', () => sounds.play(ids.overheat));
  events.on('mgMounted', () => sounds.play(ids.mount));
  events.on('mgDismounted', ({ reason }) => {
    if (reason === 'player') sounds.play(ids.mount);
  });
}
