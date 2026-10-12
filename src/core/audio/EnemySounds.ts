import { config } from '../config';
import type { EnemyCallout } from '../../enemies/EnemyType';
import type { EventBus, GameEvents } from '../EventBus';
import type { SoundBank } from './SoundBank';

/** Enemy rifles reuse the player's rifle recordings, played a little lower so they read as a different gun. */
const ENEMY_RIFLE_RATE = 0.9;

const CALLOUTS: Record<EnemyCallout, string> = {
  contact: 'vo.enemy.contact',
  breach: 'vo.enemy.breach',
  chargeSet: 'vo.enemy.chargeSet',
};

/**
 * Plays enemy sounds from events, all positioned in the world: rifle fire, footsteps, pain and death,
 * voice callouts (each line at most once per `config.enemies.calloutGap` seconds, from any enemy), and
 * satchel beeps. Entries without files stay silent until their recordings are added.
 */
export function connectEnemySounds(events: EventBus<GameEvents>, sounds: SoundBank): void {
  const lastCallout = new Map<EnemyCallout, number>();

  events.on('enemyFired', ({ muzzle }) => sounds.play('weapon.enemyRifle.fire', { position: muzzle, rate: ENEMY_RIFLE_RATE }));
  events.on('enemyFootstep', ({ position }) => sounds.play('enemy.footstep', { position }));
  events.on('enemyDamaged', ({ position }) => sounds.play('enemy.hurt', { position: { x: position.x, y: position.y + 1.5, z: position.z } }));
  events.on('enemyKilled', ({ position }) => sounds.play('enemy.death', { position: { x: position.x, y: position.y + 1.2, z: position.z } }));
  events.on('enemyCallout', ({ line, position }) => {
    const now = performance.now() / 1000;
    const last = lastCallout.get(line) ?? -Infinity;
    if (now - last < config.enemies.calloutGap) return;
    lastCallout.set(line, now);
    sounds.play(CALLOUTS[line], { position });
  });
  events.on('satchelBeep', ({ position }) => sounds.play('satchel.beep', { position }));
}
