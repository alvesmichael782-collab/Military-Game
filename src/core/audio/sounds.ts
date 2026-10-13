import type { config } from '../config';

/** Mixer groups. Each has a volume in `config.audio.buses`, on top of the master volume. */
export type Bus = Exclude<keyof typeof config.audio.buses, 'master'>;

export interface SoundDef {
  /**
   * The variant files, as a path under src/assets/sounds without the extension. `*` matches any run of
   * characters within a file name and `?` matches one, so `footsteps/gravel/step_*` takes every step clip.
   * Any of .mp3, .ogg, .wav and .m4a works; files with the same name and different formats are one variant.
   */
  readonly files: string;
  readonly bus: Bus;
  /** Volume before the bus and master volumes, 0..1. */
  readonly volume: number;
  /** Random change in pitch per play, as a fraction either way (0.03 = up to 3% higher or lower). */
  readonly pitchJitter: number;
  /** Random change in volume per play, as a fraction either way. */
  readonly volumeJitter: number;
  /** Most copies playing at once. Starting another stops the oldest. */
  readonly maxInstances: number;
  /**
   * '2d' plays flat (the player's own sounds) unless the play gives a position, as an enemy's copy of the
   * same gun would. '3d' always plays at a position in the world.
   */
  readonly spatial: '2d' | '3d';
  /** For positioned plays: distance in meters within which the sound plays at full volume. */
  readonly refDistance?: number;
  /** Plays over and over until stopped. */
  readonly loop?: boolean;
  /** Playback rate (pitch) before jitter, e.g. 0.8 to play a file lower. Defaults to 1. */
  readonly rate?: number;
}

interface GunSoundOptions {
  /** Pitch the borrowed recordings are played at (1 = as recorded). */
  readonly rate: number;
  /** Reload pitch, if different (the reload animation's key times are timed to it). */
  readonly reloadRate?: number;
  readonly volume?: number;
  /** Folder under weapons/ with this gun's own fire_??, fire_tail and reload files, once it has them. */
  readonly own?: string;
}

/**
 * Fire, fire tail, reload and equip entries for one of the player's guns, as `weapon.<id>.<action>`. Until the gun
 * has its own recordings it borrows the M4A1's at `rate`; once they exist in src/assets/sounds/weapons/<folder>/,
 * pass `own: '<folder>'` (and rate 1). Equip sounds always come from the gun's own folder (silent until added).
 */
function gunSounds(id: string, { rate, reloadRate = rate, volume = 0.7, own }: GunSoundOptions): Record<string, SoundDef> {
  const folder = own ?? 'm4a1';
  const pitch = own ? 1 : rate;
  const reload = own ? 1 : reloadRate;
  return {
    [`weapon.${id}.fire`]: { files: `weapons/${folder}/fire_??`, bus: 'weapons', volume, rate: pitch, pitchJitter: 0.03, volumeJitter: 0.06, maxInstances: 6, spatial: '2d', refDistance: 8 },
    [`weapon.${id}.fireTail`]: { files: `weapons/${folder}/fire_tail`, bus: 'weapons', volume, rate: pitch, pitchJitter: 0.02, volumeJitter: 0.04, maxInstances: 2, spatial: '2d', refDistance: 8 },
    [`weapon.${id}.reload`]: { files: `weapons/${folder}/reload`, bus: 'weapons', volume: 0.8, rate: reload, pitchJitter: 0, volumeJitter: 0, maxInstances: 1, spatial: '2d', refDistance: 3 },
    [`weapon.${id}.equip`]: { files: `weapons/${own ?? id}/equip*`, bus: 'weapons', volume: 0.6, pitchJitter: 0.04, volumeJitter: 0, maxInstances: 1, spatial: '2d' },
  };
}

/**
 * Every sound the game can play, by id. Ids read `<kind>.<thing>.<action>`, so new content plugs in by
 * adding a folder of files and an entry here: a gun adds `weapon.<gun>.*` entries, a surface adds
 * `footstep.<surface>`. Entries whose files do not exist yet stay silent (with one warning).
 */
export const SOUNDS: Readonly<Record<string, SoundDef>> = {
  // The player's guns. Each has its own ids; they borrow the M4A1 recordings at their own pitch until they get
  // their own files (see `gunSounds`).
  ...gunSounds('m4', { rate: 1, own: 'm4a1' }),
  ...gunSounds('pistol', { rate: 1.3, volume: 0.6, reloadRate: 1.2 }),
  ...gunSounds('sg09', { rate: 1.18, volume: 0.65, reloadRate: 1.2 }),
  ...gunSounds('revolver', { rate: 0.8, volume: 0.8, reloadRate: 0.9 }),
  ...gunSounds('uzi', { rate: 1.4, volume: 0.6, reloadRate: 1.1 }),
  // The knife. No files yet: src/assets/sounds/weapons/knife/.
  'weapon.knife.slash': { files: 'weapons/knife/slash*', bus: 'weapons', volume: 0.7, pitchJitter: 0.08, volumeJitter: 0.1, maxInstances: 2, spatial: '2d' },
  'weapon.knife.stab': { files: 'weapons/knife/stab*', bus: 'weapons', volume: 0.75, pitchJitter: 0.06, volumeJitter: 0.1, maxInstances: 2, spatial: '2d' },
  'weapon.knife.hitBody': { files: 'weapons/knife/hit_body*', bus: 'weapons', volume: 0.8, pitchJitter: 0.08, volumeJitter: 0.1, maxInstances: 2, spatial: '2d' },
  'weapon.knife.hitHard': { files: 'weapons/knife/hit_hard*', bus: 'weapons', volume: 0.7, pitchJitter: 0.1, volumeJitter: 0.1, maxInstances: 2, spatial: '2d' },
  'weapon.knife.equip': { files: 'weapons/knife/equip*', bus: 'weapons', volume: 0.6, pitchJitter: 0.04, volumeJitter: 0, maxInstances: 1, spatial: '2d' },
  // MG nest gun. Borrows the M4A1 shots, played lower, until it has its own recordings; the rest are hooks.
  'weapon.mg.fire': {
    files: 'weapons/m4a1/fire_??',
    bus: 'weapons',
    volume: 0.8,
    rate: 0.78,
    pitchJitter: 0.03,
    volumeJitter: 0.06,
    maxInstances: 8,
    spatial: '2d',
    refDistance: 10,
  },
  'weapon.mg.fireTail': {
    files: 'weapons/mg/fire_tail',
    bus: 'weapons',
    volume: 0.8,
    pitchJitter: 0.02,
    volumeJitter: 0.04,
    maxInstances: 2,
    spatial: '2d',
    refDistance: 10,
  },
  'weapon.mg.overheat': {
    files: 'weapons/mg/overheat',
    bus: 'weapons',
    volume: 0.8,
    pitchJitter: 0,
    volumeJitter: 0,
    maxInstances: 1,
    spatial: '2d',
  },
  'weapon.mg.mount': {
    files: 'weapons/mg/mount',
    bus: 'weapons',
    volume: 0.8,
    pitchJitter: 0.03,
    volumeJitter: 0,
    maxInstances: 1,
    spatial: '2d',
  },
  // Any gun without its own dry-fire click. No file yet.
  'weapon.dryFire': {
    files: 'weapons/dry_fire',
    bus: 'weapons',
    volume: 0.7,
    pitchJitter: 0.04,
    volumeJitter: 0,
    maxInstances: 2,
    spatial: '2d',
  },

  // Enemy rifle: the M4A1 recordings for now (played at a lower pitch), under its own id so it can get its own files.
  'weapon.enemyRifle.fire': {
    files: 'weapons/m4a1/fire_??',
    bus: 'weapons',
    volume: 0.6,
    pitchJitter: 0.04,
    volumeJitter: 0.1,
    maxInstances: 8,
    spatial: '3d',
    refDistance: 8,
  },

  // Footsteps, one entry per surface (see world/Surfaces.ts).
  'footstep.gravel': {
    files: 'footsteps/gravel/step_*',
    bus: 'footsteps',
    volume: 0.55,
    pitchJitter: 0.06,
    volumeJitter: 0.12,
    maxInstances: 4,
    spatial: '2d',
    refDistance: 4,
  },

  // Grenades and explosions. No files yet.
  'grenade.bounce': {
    files: 'effects/grenade_bounce*',
    bus: 'effects',
    volume: 0.6,
    pitchJitter: 0.06,
    volumeJitter: 0.1,
    maxInstances: 4,
    spatial: '3d',
    refDistance: 3,
  },
  'explosion.frag': {
    files: 'effects/explosion*',
    bus: 'effects',
    volume: 1,
    pitchJitter: 0.05,
    volumeJitter: 0.05,
    maxInstances: 4,
    spatial: '3d',
    refDistance: 12,
  },

  // Destruction: crack, rumble, debris. No files yet.
  /** A bullet hitting a wall. */
  'destruction.wall.hit': {
    files: 'destruction/wall_hit*',
    bus: 'effects',
    volume: 0.6,
    pitchJitter: 0.08,
    volumeJitter: 0.12,
    maxInstances: 5,
    spatial: '3d',
    refDistance: 4,
  },
  /** A wall cracking into its damaged or breached state. */
  'destruction.wall.crack': {
    files: 'destruction/wall_crack*',
    bus: 'effects',
    volume: 0.85,
    pitchJitter: 0.06,
    volumeJitter: 0.08,
    maxInstances: 4,
    spatial: '3d',
    refDistance: 8,
  },
  /** A wall or the MG nest coming down. */
  'destruction.wall.collapse': {
    files: 'destruction/wall_collapse*',
    bus: 'effects',
    volume: 1,
    pitchJitter: 0.05,
    volumeJitter: 0.06,
    maxInstances: 4,
    spatial: '3d',
    refDistance: 10,
  },
  /** Debris chunks landing. Rate-limited by the debris system. */
  'destruction.debris': {
    files: 'destruction/debris*',
    bus: 'effects',
    volume: 0.45,
    pitchJitter: 0.12,
    volumeJitter: 0.2,
    maxInstances: 6,
    spatial: '3d',
    refDistance: 4,
  },
  // Enemies. No files yet.
  'enemy.footstep': {
    files: 'enemies/footstep*',
    bus: 'footsteps',
    volume: 0.5,
    pitchJitter: 0.08,
    volumeJitter: 0.15,
    maxInstances: 6,
    spatial: '3d',
    refDistance: 3,
  },
  'enemy.hurt': {
    files: 'enemies/hurt*',
    bus: 'effects',
    volume: 0.8,
    pitchJitter: 0.06,
    volumeJitter: 0.1,
    maxInstances: 3,
    spatial: '3d',
    refDistance: 5,
  },
  'enemy.death': {
    files: 'enemies/death*',
    bus: 'effects',
    volume: 0.9,
    pitchJitter: 0.05,
    volumeJitter: 0.08,
    maxInstances: 3,
    spatial: '3d',
    refDistance: 6,
  },
  /** A rifleman spots the player. */
  'vo.enemy.contact': {
    files: 'vo/enemy_contact*',
    bus: 'effects',
    volume: 1,
    pitchJitter: 0.03,
    volumeJitter: 0.05,
    maxInstances: 2,
    spatial: '3d',
    refDistance: 10,
  },
  /** A sapper heads for a wall. */
  'vo.enemy.breach': {
    files: 'vo/enemy_breach*',
    bus: 'effects',
    volume: 1,
    pitchJitter: 0.03,
    volumeJitter: 0.05,
    maxInstances: 2,
    spatial: '3d',
    refDistance: 10,
  },
  /** A sapper has planted a charge. */
  'vo.enemy.chargeSet': {
    files: 'vo/enemy_charge_set*',
    bus: 'effects',
    volume: 1,
    pitchJitter: 0.03,
    volumeJitter: 0.05,
    maxInstances: 2,
    spatial: '3d',
    refDistance: 10,
  },
  'satchel.beep': {
    files: 'effects/satchel_beep*',
    bus: 'effects',
    volume: 0.6,
    pitchJitter: 0,
    volumeJitter: 0,
    maxInstances: 4,
    spatial: '3d',
    refDistance: 4,
  },
  /** Falls back to 'explosion.frag' until it has files. */
  'satchel.explode': {
    files: 'effects/satchel_explode*',
    bus: 'effects',
    volume: 1,
    pitchJitter: 0.05,
    volumeJitter: 0.05,
    maxInstances: 3,
    spatial: '3d',
    refDistance: 14,
  },

  /** Hammering and scraping while the player repairs a structure. */
  'repair.loop': {
    files: 'repair/repair_loop*',
    bus: 'effects',
    volume: 0.7,
    pitchJitter: 0,
    volumeJitter: 0,
    maxInstances: 1,
    spatial: '3d',
    refDistance: 3,
    loop: true,
  },
};
