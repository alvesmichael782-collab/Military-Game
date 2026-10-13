/*
 * Weapon definitions: everything that makes one weapon different from another, as data. A new weapon is one
 * file in this folder exporting a `WeaponDef` (picked up automatically by `defs/index.ts`) plus its converted
 * model and texture (`npm run convert:weapons`, see scripts/convert-weapons/). Distances are meters, angles
 * degrees, times seconds, unless a field says otherwise.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where a weapon goes: one of the two gun slots, or the melee slot. */
export type SlotType = 'gun' | 'melee';
export type FireMode = 'semi' | 'auto' | 'burst';

/**
 * A weapon's sounds, as sound bank ids (see core/audio/sounds.ts). Ids read `weapon.<id>.<action>`, so real
 * recordings plug in by giving the bank entry its own files.
 */
export interface WeaponSounds {
  readonly fire?: string;
  /** The burst's last shot and its echo, played when the trigger is let go. */
  readonly fireTail?: string;
  readonly reload?: string;
  /** Trigger pulled on an empty magazine. Without it the shared `weapon.dryFire` click plays. */
  readonly dryFire?: string;
  /** Weapon drawn. */
  readonly equip?: string;
  /** Melee: the swing, the thrust, and the blade striking a body or something hard. */
  readonly slash?: string;
  readonly stab?: string;
  readonly hitBody?: string;
  readonly hitHard?: string;
}

/** The converted model (src/assets/models/weapons/<model>.glb) and how the view model holds it. */
export interface WeaponModel {
  /** File name without extension, in src/assets/models/weapons/ and src/assets/textures/weapons/. */
  readonly model: string;
  /** Resting position and rotation (radians) in front of the camera at the hip. */
  readonly position: Vec3;
  readonly rotation: Vec3;
  /** Size of the floating copy above the weapon crate, as a multiple of the real size. */
  readonly displayScale: number;
  /** Seconds to put the weapon away and to bring it out (a switch is one plus the other, about 0.4-0.6 s). */
  readonly holsterTime: number;
  readonly drawTime: number;
  /** How the weapon is carried while sprinting: extra drop (m) and tilt (radians) at full sprint. */
  readonly sprintDrop: number;
  readonly sprintPitch: number;
  readonly sprintYaw: number;
  /** Idle breathing sway, in meters, and its speed (cycles per second). */
  readonly idleSway: number;
  readonly idleRate: number;
}

/**
 * Where the gloved hands go, in the model's frame (barrel along -Z, centered on its bounding box). Each hand is a
 * fist at `grip` with its forearm running back toward `elbow` (an offset from the hand). `roll` turns the hand about
 * its forearm, in radians.
 */
export interface HandPlacement {
  readonly grip: Vec3;
  readonly elbow: Vec3;
  readonly roll?: number;
}

export interface WeaponHands {
  readonly right: HandPlacement;
  /** Without it the left arm stays out of view. */
  readonly left?: HandPlacement;
}

/** Counter-Strike-style recoil pattern. Angles in degrees. The first shot always goes where you aim. */
export interface RecoilPattern {
  /** Upward kick per shot while the climb lasts. */
  readonly kickUp: number;
  /** Shots that climb at the full rate before the climb flattens out. */
  readonly climbShots: number;
  /** Upward kick per shot once the climb has flattened. */
  readonly plateauKickUp: number;
  /** Highest the view climbs above where you aimed. */
  readonly maxPitch: number;
  /** Horizontal drift begins on this shot (0 = first shot), swings `driftAmplitude` either side, `driftSwingShots` shots per swing. */
  readonly driftStartShot: number;
  readonly driftAmplitude: number;
  readonly driftSwingShots: number;
  /** Random sideways kick per shot, either way, on top of the pattern (0 for none). */
  readonly jitter: number;
  /** Seconds after the trigger is let go before the view settles, and how quickly it settles (higher = faster). */
  readonly recoverDelay: number;
  readonly recoverSpeed: number;
  /** Seconds without firing before the pattern restarts from the first shot. */
  readonly patternResetTime: number;
  /** Scales the whole pattern crouched, and sprinting or airborne (standing and walking use 1). */
  readonly crouchingScale: number;
  readonly mobileScale: number;
}

/** Inaccuracy as the half-angle of a cone, in degrees, at the hip. Aiming down sights multiplies it by `ads.spreadMultiplier`. */
export interface SpreadStats {
  readonly standing: number;
  readonly crouching: number;
  /** Added at walk speed; scales with speed, so sprinting adds more. */
  readonly moving: number;
  readonly airborne: number;
  /** Added per shot during sustained fire, up to `maxBloom`, recovering at `bloomRecovery` degrees per second. */
  readonly bloomPerShot: number;
  readonly maxBloom: number;
  readonly bloomRecovery: number;
}

/** How the view model reacts to each shot. */
export interface ViewKick {
  /** Push back (m) and tip up (degrees) for a shot with the pattern's full `kickUp`; smaller kicks scale down. */
  readonly back: number;
  readonly pitch: number;
  /** How quickly the kick settles (higher = faster). */
  readonly recovery: number;
  /** Random roll per shot, in radians at full kick. */
  readonly roll: number;
}

export interface AdsStats {
  /**
   * The two sight points in the model's frame: the rear sight (notch or aperture) and the front post tip. The
   * aimed pose lines them up on the screen center with the rear sight `eyeRelief` meters in front of the eye.
   */
  readonly rearSight: Vec3;
  readonly frontSight: Vec3;
  readonly eyeRelief: number;
  /** Horizontal field of view when fully aimed, in degrees at 4:3 (hip is `config.camera.fov`). */
  readonly fov: number;
  /** Seconds from the hip to fully aimed, and back. */
  readonly transitionTime: number;
  /** Multipliers when fully aimed, blended in over the transition. */
  readonly spreadMultiplier: number;
  readonly recoilMultiplier: number;
  readonly moveSpeedMultiplier: number;
  /** View model mouse sway and walking bob. */
  readonly swayMultiplier: number;
  readonly bobMultiplier: number;
}

/**
 * Magazine reload, timed to the reload sound. The gun tilts toward the player, the magazine slides out of the
 * well and drops, the left hand brings a fresh one up and seats it (`seatTime`, when the ammo goes in), and the
 * gun turns back. Reloading from empty adds a chamber step after seating (`chamber`), which makes the reload
 * `emptyExtra` seconds longer.
 */
export interface MagazineReload {
  readonly kind: 'magazine';
  readonly time: number;
  /** The gun tilts and rolls toward the player and dips, from the start until `tiltEnd`. */
  readonly tiltEnd: number;
  readonly tiltPitch: number;
  readonly tiltYaw: number;
  readonly tiltRoll: number;
  readonly tiltDip: number;
  /** The magazine is released (falls at `dropSpeed` m/s plus `dropGravity` m/s^2) and is hidden once it has fallen `dropDistance`. */
  readonly releaseTime: number;
  readonly dropSpeed: number;
  readonly dropGravity: number;
  readonly dropDistance: number;
  /** A fresh magazine rises from `newMagDepth` below the well to `insertDepth` below it, tipped by `newMagTilt`. */
  readonly newMagStart: number;
  readonly newMagEnd: number;
  readonly newMagDepth: number;
  readonly insertDepth: number;
  readonly newMagTilt: number;
  /** Slides into the well from `insertTime`, seats at `seatTime` (the ammo goes in then). */
  readonly insertTime: number;
  readonly seatTime: number;
  readonly seatBump: number;
  readonly seatJoltLift: number;
  readonly seatJoltPitch: number;
  readonly seatJoltTime: number;
  /** Back to the normal pose, overshooting by `settleOvershoot` (0 for none) before it settles. */
  readonly returnStart: number;
  readonly returnEnd: number;
  readonly settleOvershoot: number;
  /** The left hand leaves its grip at `handReachStart`, holds the magazine from release to `handReturnStart`, and is back by `handReturnEnd`. */
  readonly handReachStart: number;
  readonly handReturnStart: number;
  readonly handReturnEnd: number;
  /** The left hand around the magazine: offset from the magazine's top center (its pivot), and its elbow. */
  readonly handOnMagazine: Vec3;
  readonly handOnMagazineElbow: Vec3;
  /**
   * Unit vector out of the well in the model's frame (the magazine leaves along it). For guns whose magazine is not
   * a separate mesh, `magazineWell` is where the hand meets the magazine's base instead.
   */
  readonly magazineAxis: Vec3;
  readonly magazineWell?: Vec3;
  /** Extra seconds for the chamber step when the gun was empty, starting at `returnStart`. */
  readonly emptyExtra: number;
  readonly chamber: ChamberStep;
}

/**
 * How an emptied gun chambers its first round after a fresh magazine. `slideRelease`: the thumb drops the locked
 * slide (a press, then the gun snaps as it slams home). `rack`: the left hand goes to `point` (model frame), pulls
 * `pull` meters back toward the shooter and lets go (a charging handle or cocking knob).
 */
export type ChamberStep =
  | { readonly kind: 'slideRelease' }
  | { readonly kind: 'rack'; readonly point: Vec3; readonly elbow: Vec3; readonly pull: number };

/**
 * Revolver reload with a fixed cylinder: the gun tips muzzle up to drop the empties, then muzzle down while the left
 * hand pushes fresh rounds in at `loadPoint`, a push per `loadPushes`, and the gun flicks back up. The ammo goes in
 * at `seatTime`.
 */
export interface RevolverReload {
  readonly kind: 'revolver';
  readonly time: number;
  /** Muzzle up (degrees) to shake the empties out, reached at `ejectEnd`, with a shake. */
  readonly ejectEnd: number;
  readonly ejectPitch: number;
  readonly ejectRoll: number;
  /** Muzzle down and turned toward the player for loading, from `ejectHold` to `loadTiltEnd`. */
  readonly ejectHold: number;
  readonly loadTiltEnd: number;
  readonly loadPitch: number;
  readonly loadYaw: number;
  readonly loadRoll: number;
  readonly loadLift: number;
  /** The left hand pushes rounds in at `loadPoint` (model frame) between `loadStart` and `seatTime`. */
  readonly loadStart: number;
  readonly loadPushes: number;
  readonly loadPoint: Vec3;
  readonly loadElbow: Vec3;
  readonly seatTime: number;
  /** The gun flicks closed and turns back between `returnStart` and `returnEnd`. */
  readonly returnStart: number;
  readonly returnEnd: number;
  readonly settleOvershoot: number;
}

export type ReloadAnimation = MagazineReload | RevolverReload;

interface DefBase {
  /** Internal id: the loadout, events, sounds and HUD use it. */
  readonly id: string;
  /** Name on the HUD and in the weapon crate prompt. */
  readonly displayName: string;
  readonly slot: SlotType;
  /** Weapon crate price, in dollars. */
  readonly price: number;
  /** Top speed multiplier while this weapon is in hand. */
  readonly moveSpeedMultiplier: number;
  readonly view: WeaponModel;
  readonly hands: WeaponHands;
  readonly sounds: WeaponSounds;
}

export interface GunDef extends DefBase {
  readonly slot: 'gun';
  /** What buying it again (owned) costs: a full magazine and reserve. */
  readonly refillPrice: number;
  readonly fireMode: FireMode;
  /** Top rate of fire. Semi-auto guns fire once per trigger pull, never faster than this. */
  readonly roundsPerMinute: number;
  /** Burst fire only: rounds per pull. */
  readonly burstCount?: number;
  readonly damage: number;
  readonly headshotMultiplier: number;
  readonly range: number;
  readonly magazineSize: number;
  /** Rounds carried beyond the magazine at the start (and after a refill). */
  readonly reserveAmmo: number;
  readonly reload: ReloadAnimation;
  readonly spread: SpreadStats;
  readonly recoil: RecoilPattern;
  readonly kick: ViewKick;
  readonly ads: AdsStats;
  /** Size of the star-shaped muzzle flash, in meters. */
  readonly muzzleFlashSize: number;
  /** A slide the model has as its own part ("slide"): moves back on each shot and locks back on an empty magazine. */
  readonly slide?: SlideMotion;
}

/**
 * How far the slide travels back toward the shooter (meters, along +Z) and how long one shot's cycle takes at most;
 * it is never longer than 60% of the time between shots. It stays locked back while the magazine is empty, until a
 * reload's chamber step releases it.
 */
export interface SlideMotion {
  readonly travel: number;
  readonly cycleTime: number;
}

/** Slash (tap) and stab (hold) timing. Hits land at `hitTime` into the attack. */
export interface MeleeAttack {
  readonly damage: number;
  readonly duration: number;
  readonly hitTime: number;
  /** Half the width of the swept arc, in degrees, checked with a fan of rays. */
  readonly arc: number;
}

export interface MeleeDef extends DefBase {
  readonly slot: 'melee';
  readonly range: number;
  readonly headshotMultiplier: number;
  /** Hold the attack button this long and the slash becomes a stab. */
  readonly stabHoldTime: number;
  readonly slash: MeleeAttack;
  readonly stab: MeleeAttack;
}

export type WeaponDef = GunDef | MeleeDef;

/** Seconds between shots at the gun's top rate of fire. */
export function fireInterval(def: GunDef): number {
  return 60 / def.roundsPerMinute;
}
