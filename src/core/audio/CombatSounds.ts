import type { EventBus, GameEvents } from '../EventBus';
import type { SoundBank, SoundHandle } from './SoundBank';

/** Played when a gun has no dry-fire sound of its own. */
const DEFAULT_DRY_FIRE = 'weapon.dryFire';
/** Crossfade between the last shot's clip and the fire tail, in milliseconds. */
const TAIL_CROSSFADE_MS = 10;
/** Fade for a reload sound cut off when the reload is cancelled, in milliseconds. */
const RELOAD_STOP_FADE_MS = 40;

/**
 * Plays the player's weapon, grenade and explosion sounds from combat events. Weapon events carry the
 * weapon's sound ids, so any gun plays its own set with no changes here. The player's gun plays flat (2D).
 */
export function connectCombatSounds(events: EventBus<GameEvents>, sounds: SoundBank): void {
  let lastShot: SoundHandle = 0;
  let lastShotAt = 0;
  let reload: SoundHandle = 0;

  events.on('weaponFired', ({ sounds: set }) => {
    lastShot = sounds.play(set.fire);
    lastShotAt = performance.now();
  });
  // The tail opens with a recording of the burst's last shot. Start it where the last shot is now, and
  // crossfade out that shot's own clip, so the echo follows the shot instead of adding another one.
  events.on('weaponBurstEnded', ({ sounds: set }) => {
    const offset = (performance.now() - lastShotAt) / 1000;
    sounds.stop(lastShot, TAIL_CROSSFADE_MS);
    lastShot = 0;
    sounds.play(set.fireTail, offset > 0.005 ? { offset, fadeIn: TAIL_CROSSFADE_MS } : undefined);
  });
  events.on('weaponReloadStarted', ({ sounds: set }) => {
    reload = sounds.play(set.reload);
  });
  events.on('weaponReloadCancelled', () => {
    sounds.stop(reload, RELOAD_STOP_FADE_MS);
    reload = 0;
  });
  events.on('weaponDryFired', ({ sounds: set }) => {
    sounds.play(set.dryFire ?? DEFAULT_DRY_FIRE);
  });
  events.on('weaponEquipped', ({ sounds: set }) => {
    if (set.equip) sounds.play(set.equip);
  });
  events.on('grenadeBounced', ({ position }) => sounds.play('grenade.bounce', { position }));
  events.on('explosion', ({ position, kind }) => {
    // Satchels fall back to the frag blast until they have their own recording.
    const id = kind === 'satchel' && sounds.has('satchel.explode') ? 'satchel.explode' : 'explosion.frag';
    sounds.play(id, { position });
  });
}
