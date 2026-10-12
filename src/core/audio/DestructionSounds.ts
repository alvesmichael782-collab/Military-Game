import { DamageState } from '../../destruction/DamageState';
import type { EventBus, GameEvents } from '../EventBus';
import type { SoundBank, SoundHandle } from './SoundBank';

/** How broken each state is, so the crack plays only when a wall gets worse, never when a repair rolls it back. */
const WORSE: Record<DamageState, number> = {
  [DamageState.INTACT]: 0,
  [DamageState.DAMAGED]: 1,
  [DamageState.BREACHED]: 2,
  [DamageState.COLLAPSED]: 3,
};
/** Fade for the repair loop when the repair stops, in milliseconds. */
const REPAIR_STOP_FADE_MS = 120;

/**
 * Plays destruction and repair sounds from events, all positioned in the world: bullet hits on walls,
 * the crack when a wall breaks into a worse state, the collapse, debris landing, and the repair loop.
 */
export function connectDestructionSounds(events: EventBus<GameEvents>, sounds: SoundBank): void {
  let repair: SoundHandle = 0;

  events.on('segmentDamaged', ({ type, damageType, source }) => {
    // Explosions are heard through their own blast; bullets knock on the wall.
    if (type === 'wall' && damageType === 'ballistic') sounds.play('destruction.wall.hit', { position: source });
  });
  events.on('segmentStateChanged', ({ from, to, position }) => {
    if (to === DamageState.COLLAPSED) sounds.play('destruction.wall.collapse', { position });
    else if (WORSE[to] > WORSE[from]) sounds.play('destruction.wall.crack', { position: { x: position.x, y: 1.25, z: position.z } });
  });
  events.on('debrisLanded', ({ position }) => sounds.play('destruction.debris', { position }));
  events.on('repairStarted', ({ position }) => {
    sounds.stop(repair);
    repair = sounds.play('repair.loop', { position: { x: position.x, y: 1, z: position.z } });
  });
  events.on('repairStopped', () => {
    sounds.stop(repair, REPAIR_STOP_FADE_MS);
    repair = 0;
  });
}
