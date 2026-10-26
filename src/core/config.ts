// All tunable gameplay numbers live here.

export const config = {
  map: {
    /** Side length of the square play area, in meters. */
    size: 200,
    /** Height of the invisible wall that keeps bodies inside the play area. */
    boundaryHeight: 6,
    /** Enemy spawn points (x, z) in meters. The map center is reserved for the outpost. */
    spawnPoints: [
      { x: 0, z: -88 },
      { x: 88, z: 0 },
    ],
    /** Outpost core position (x, z). */
    corePosition: { x: 0, z: 0 },
  },
  render: {
    /** Cap on device pixel ratio. 1 keeps fill cost low on Retina screens and suits the retro look. */
    maxPixelRatio: 1,
  },
  /**
   * Retro render filter: the 3D scene (world and weapon) is drawn at a lower resolution and blown up with nearest
   * filtering, with slight color quantization. The HTML HUD is never affected. F6 toggles it.
   */
  retro: {
    /** On at start. */
    enabled: true,
    /** Internal resolution as a fraction of the screen's, per axis. */
    renderScale: 0.5,
    /** Bits kept per color channel (8 is none). 5-6 gives subtle banding. */
    colorBits: 6,
  },
  /**
   * Default controls, each as [primary, alternate] ('' for none). The player rebinds them in the pause menu
   * (saved in the browser, see `core/Keybinds.ts`). A key is a `KeyboardEvent.code` ("KeyQ"), with left and right
   * modifiers merged ("Shift", "Control", "Alt"), or a mouse button ("Mouse0" left, "Mouse1" middle, "Mouse2" right).
   * Read through `Input.isActionDown` / `wasActionPressed`.
   */
  keybinds: {
    moveForward: ['KeyW', ''],
    moveBack: ['KeyS', ''],
    moveLeft: ['KeyA', ''],
    moveRight: ['KeyD', ''],
    sprint: ['Shift', ''],
    crouch: ['Control', 'KeyC'],
    jump: ['Space', ''],
    fire: ['Mouse0', ''],
    /** Aim down sights. */
    aim: ['KeyQ', ''],
    reload: ['KeyR', ''],
    grenade: ['KeyG', ''],
    /** Hold to apply armor plates. */
    applyPlate: ['KeyV', ''],
    /** Weapon slots: gun 1, gun 2, melee. */
    slot1: ['Digit1', ''],
    slot2: ['Digit2', ''],
    slot3: ['Digit3', ''],
    /** Buy at the crates, hold to repair, mount the MG. */
    interact: ['KeyE', ''],
    /** Start the wave early in the build phase, skip the wave summary, restart after the game ends. */
    startWave: ['Enter', ''],
    buildMode: ['KeyB', ''],
    place: ['Mouse0', ''],
    rotate: ['KeyR', ''],
    /** Remove a structure, clear rubble. */
    remove: ['KeyF', ''],
    /** Cycle the build tool's items: previous, next. */
    cyclePrev: ['ArrowLeft', ''],
    cycleNext: ['ArrowRight', ''],
  },
  ui: {
    /** The UI size choices 1x to 5x in the pause menu, as multipliers of the reference HUD size. 3x is the standard size. */
    scales: [0.6, 0.8, 1, 1.2, 1.4],
    /** The choice used until the player picks one (1-based, so 3 is 3x). */
    defaultScale: 3,
  },
  /** Aim down sights, for every weapon. Per-weapon values (pose, zoom, multipliers) live in each weapon's `ads`. */
  ads: {
    /** false: hold the aim key to aim. true: press once to aim, press again to stop. */
    toggle: false,
    /** Extra look sensitivity multiplier while fully aimed, on top of the automatic scaling by zoom. */
    sensitivityMultiplier: 1,
    /** Head bob size while fully aimed, as a fraction of the normal bob. */
    headBobScale: 0.25,
    /** Seconds a grenade throw drops the aim for; it comes back after if the aim key is still held. */
    throwDropTime: 0.45,
  },
  phases: {
    /** Seconds per phase. Enter ends BUILD early and skips the rest of AFTERMATH. A full-timer run is about 25-30 min. */
    buildDuration: 75,
    /**
     * FIGHT has no timer: it ends once the wave director has sent the whole wave and every enemy is dead.
     * This safety timeout ends it anyway, so a stuck enemy can never softlock the game (leftover enemies are removed).
     */
    fightTimeout: 600,
    aftermathDuration: 15,
  },
  waves: {
    total: 10,
    /** Points the wave director spends on each wave: the wave number times this. */
    budgetPerWave: 10,
    /** Points each enemy costs. */
    costs: {
      rifleman: 2,
      sapper: 5,
      grenadier: 4,
      mortar: 8,
    },
    /** First wave each enemy type can appear in. */
    unlockWave: {
      rifleman: 1,
      sapper: 3,
      grenadier: 4,
      mortar: 6,
    },
    /** Sappers take at most this fraction of a wave's budget (a random share up to it); riflemen fill the rest. */
    maxSapperShare: 0.25,
    /** Grenadiers take at most this fraction of a wave's budget (a random share up to it). */
    maxGrenadierShare: 0.25,
    /**
     * Mortar teams take at most this fraction of a wave's budget (at least one team once unlocked, budget allowing).
     * They come in on their own, not in squads, and never more than `mortar.maxAlive` at once.
     */
    maxMortarShare: 0.25,
    /** Seconds from the start of the fight to the first mortar team, and between teams after that (random in the range). */
    mortarDelayMin: 8,
    mortarDelayMax: 16,
    /**
     * Enemies per squad. The range slides up with the waves: wave 1 sends squads of 3-4, the last wave 4-5.
     * A wave's last squad is whatever is left of its budget.
     */
    squadSizeMin: 3,
    squadSizeMax: 5,
    /** Seconds between squads, picked at random in this range. The first squad comes at once. */
    squadIntervalMin: 6,
    squadIntervalMax: 10,
    /** Most enemies alive at once. Squads wait while at the cap and come in as soon as there is room. */
    maxAlive: 20,
    /**
     * How many of the spawn points each wave uses, by wave (first entry is wave 1). Which ones is picked at
     * random when the build phase before the wave starts, and shown by smoke over those spawn markers.
     */
    spawnPointsPerWave: [1, 1, 2, 1, 2, 2, 2, 2, 2, 2],
  },
  physics: {
    /** Fixed physics step, in seconds. */
    step: 1 / 60,
    /** Cap on fixed steps per frame so a long stall cannot spiral. */
    maxStepsPerFrame: 5,
    gravity: -9.81,
  },
  player: {
    /** Where the player spawns, relative to the outpost core (x, z), in meters. */
    spawnOffset: { x: 0, z: 4 },
    /** Capsule dimensions, in meters. */
    radius: 0.4,
    standHeight: 1.8,
    crouchHeight: 1.1,
    /** Camera height above the feet, in meters. */
    standEyeHeight: 1.65,
    crouchEyeHeight: 1.0,
    /** Top speeds, in m/s. Sprint applies only while moving forward. */
    walkSpeed: 6,
    sprintSpeed: 9,
    crouchSpeed: 3,
    /** How fast ground speed ramps toward the target, in m/s^2. High = snappy. */
    groundAcceleration: 70,
    groundDeceleration: 60,
    /** Light air control, in m/s^2. */
    airAcceleration: 12,
    /** Jump apex height, in meters. */
    jumpHeight: 1.2,
    /** Player-only gravity, in m/s^2. Stronger than real life so jumps are not floaty. */
    gravity: 22,
    /** A jump pressed this many seconds before landing still fires on touchdown. */
    jumpBufferTime: 0.1,
    /** Tallest ledge the player walks up without jumping, in meters. */
    stepHeight: 0.35,
    /** Steepest slope the player can walk up, in degrees. */
    maxSlopeDegrees: 45,
    /** Distance the player sticks to the ground when walking down slopes or off small steps. */
    snapToGround: 0.3,
    /** Meters per footstep for each stance. Footsteps and head bob both follow this rhythm. */
    stride: {
      walk: 2,
      sprint: 2.5,
      crouch: 1.25,
    },
  },
  playerHealth: {
    /** Health never regenerates during a fight; it refills to full at the start of each build phase. */
    maxHealth: 100,
  },
  armor: {
    /** Plate segments in the armor bar. Damage drains armor before health; armor never regenerates. */
    maxPlates: 3,
    armorPerPlate: 50,
    /** Spare plates carried at the start, and the most the player can carry. */
    startingSpares: 3,
    maxSpares: 5,
    /** Seconds to apply one plate while holding V. The gun or knife in hand cannot be used meanwhile. */
    applyTime: 1,
  },
  camera: {
    /** Horizontal field of view in degrees, measured at 4:3. Wider screens see more at the sides. */
    fov: 90,
    /** Radians of look rotation per pixel of mouse movement. */
    mouseSensitivity: 0.0015,
    /** Vertical look limit, in degrees above and below the horizon. */
    pitchLimitDegrees: 89,
    /** How quickly the camera moves to the crouch or stand eye height (higher = faster). */
    crouchTransitionSpeed: 12,
    /** One dip per footstep (see `player.stride`), one side-to-side sway per two. */
    headBob: {
      enabled: true,
      /** Vertical bob size, in meters. */
      walkAmplitude: 0.035,
      sprintAmplitude: 0.06,
    },
  },
  /**
   * Shared weapon settings. Each weapon's own stats (damage, fire rate, recoil, ADS, reload, price...) live in its
   * def file in src/player/weapons/defs/.
   */
  weapons: {
    /** The only weapon the player spawns with (a def id). */
    startingWeapon: 'pistol',
    viewModel: {
      /** Side-to-side and vertical sway while moving, in meters. */
      bobAmplitude: 0.012,
      /** How far the weapon drags behind mouse movement, in radians per pixel, and the cap. */
      lookSway: 0.0006,
      maxLookSway: 0.06,
      /** Seconds the muzzle flash stays on screen. */
      muzzleFlashTime: 0.05,
      /** Seconds after the last shot (or knife attack) before a sprinting player lowers the weapon back to the carry pose. */
      sprintCarryDelay: 0.25,
      /** How quickly the weapon snaps up from the sprint carry to fire, and settles back into it (higher = faster). */
      sprintRaiseSpeed: 22,
      sprintLowerSpeed: 8,
    },
  },
  /** The MG nest's machine gun, fired by mounting it (see `player/MgMount.ts`). */
  mg: {
    /** Name shown on the HUD in place of the weapon's while mounted. */
    displayName: 'MG',
    /** The player can mount from behind the gun, within this distance of its grips, in meters. */
    mountRange: 1.5,
    /** Looking within this angle of the gun counts as looking at it, in degrees. */
    mountLookAngle: 35,
    /** Mounted, the player's body stands this far behind the tripod hub, in meters, inside the sandbags. */
    mountBack: 1,
    /**
     * The camera sits `cameraUp` above and `cameraBack` behind the tripod hub (when level), in meters, and rides with
     * the gun as it turns. The hub is 0.96 m up, so 0.55 puts the eye at 1.51 m, looking down the receiver at the
     * barrel. Standing eye height (1.65 m) would be 0.69, but then most of the gun sits below the bottom of the screen.
     */
    cameraUp: 0.55,
    cameraBack: 0.7,
    /** Turn limits from the nest's facing, in degrees. Positive pitch is up. */
    yawLimit: 60,
    pitchMin: -15,
    pitchMax: 20,
    roundsPerMinute: 750,
    /** Damage per bullet. Headshots multiply it. */
    damage: 25,
    headshotMultiplier: 2,
    range: 300,
    /** Inaccuracy as the half-angle of a cone, in degrees. */
    spread: 0.6,
    /** Every this many rounds is a tracer. */
    tracerEvery: 3,
    /**
     * Heat added per shot (0..1, so 0.03 is 34 shots, 2.7 s of fire) and lost per second once not firing for
     * `coolDelay` seconds. Sustained fire with pauses averages about 4.4 rounds a second, so the gun needs help.
     */
    heatPerShot: 0.03,
    coolRate: 0.2,
    coolDelay: 0.2,
    /** At full heat the gun locks for this many seconds while it cools. */
    overheatLockTime: 3,
    /** Camera shake per shot: trauma added (0..1), up to `shakeMax` from firing alone. */
    shakeTrauma: 0.2,
    shakeMax: 0.35,
    /** Size of the star-shaped muzzle flash on the barrel, in meters. */
    muzzleFlashSize: 0.55,
    /** Sound bank ids (see core/audio/sounds.ts). */
    sounds: {
      fire: 'weapon.mg.fire',
      fireTail: 'weapon.mg.fireTail',
      overheat: 'weapon.mg.overheat',
      mount: 'weapon.mg.mount',
    },
  },
  grenade: {
    /** Grenades carried at the start, and the most the player can carry (more are bought at the consumables crate). */
    count: 4,
    maxCount: 4,
    /** Seconds from the throw to the explosion. */
    fuse: 3,
    /** Seconds between throws. */
    cooldown: 0.7,
    /** Launch speed, in m/s, and how far above the crosshair the throw starts, in degrees. */
    throwSpeed: 16,
    throwUpAngle: 8,
    /** Fraction of the player's velocity added to the throw. */
    inheritVelocity: 0.35,
    /** Explosion radius, in meters. Full damage inside `fullDamageRadius`, falling to zero at `radius`. */
    radius: 6,
    fullDamageRadius: 1,
    damage: 120,
    /** Impulse given to dynamic bodies at the center of the blast, in N*s per kg. Falls off with distance. */
    impulse: 8,
    /** Collision sphere radius, in meters. */
    bodyRadius: 0.07,
    restitution: 0.45,
    friction: 0.8,
    linearDamping: 0.15,
    angularDamping: 1.5,
    /** Grenades that can be in the air at once (pool size), the player's, teammates' and grenadiers' together. */
    maxActive: 14,
    /** Change in velocity, in m/s, that counts as a bounce for the bounce sound. */
    bounceThreshold: 2.5,
  },
  explosion: {
    /** Screen shake reaches zero at this distance from the player, in meters. */
    shakeRadius: 30,
    /** Peak point-light intensity and range, in meters, and how long the flash lasts, in seconds. */
    lightIntensity: 600,
    lightRange: 28,
    lightDuration: 0.3,
    /** Scorch mark diameter, in meters. Only placed when the blast is this close to the ground. */
    scorchSize: 3.2,
    scorchMaxHeight: 1.5,
  },
  effects: {
    /** Pool sizes. The oldest decal is replaced once a pool is full. */
    maxBulletHoles: 50,
    maxScorchMarks: 12,
    maxSmokeParticles: 400,
    maxGlowParticles: 400,
    /** Bullet hole diameter, in meters. */
    bulletHoleSize: 0.12,
    /** Muzzle point-light intensity and range, in meters. */
    muzzleLightIntensity: 25,
    muzzleLightRange: 9,
  },
  screenShake: {
    /** Strongest shake, in degrees, at full trauma. */
    maxPitch: 3.5,
    maxYaw: 3,
    maxRoll: 4,
    /** Trauma lost per second (trauma runs from 0 to 1). */
    decay: 1.4,
    /** Shake speed, in oscillations per second. */
    frequency: 18,
  },
  economy: {
    /** Cash the player starts the game with, in dollars. */
    startingCash: 1500,
    /** Prices, in dollars. */
    prices: {
      wall: 125,
      mgNest: 750,
      /** Consumables crate items. */
      armorPlate: 300,
      grenade: 200,
      /** The crate structures. Weapon prices live in each weapon's def. */
      weaponCrate: 100,
      consumablesCrate: 100,
    },
    /** Fraction of the price refunded when the player removes a structure they built. */
    refundFraction: 0.5,
    /** Cash for each enemy the player kills, plus a bonus when the killing hit was a headshot. Satchel and other non-player kills pay nothing. */
    killRewards: {
      rifleman: 100,
      sapper: 200,
      grenadier: 150,
      mortar: 300,
      headshotBonus: 50,
    },
    /** Paid when a wave is cleared: `base` plus `perWave` times the wave number ($325 for wave 3). */
    waveClearBonus: {
      base: 250,
      perWave: 25,
    },
  },
  build: {
    /** Side of one grid cell, in meters. Walls take one cell, the MG nest a 2 x 2 block. */
    cellSize: 2,
    /** Cells whose centers are farther than this from the outpost core cannot be built on, in meters. */
    buildRadius: 25,
    /** How far away the player can place or remove structures, in meters. */
    reach: 8,
    /** Most MG nests allowed at once. */
    maxMgNests: 1,
    /** Most weapon crates allowed at once. */
    maxWeaponCrates: 1,
    /** Most consumables crates allowed at once. */
    maxConsumablesCrates: 1,
    /** Most wall segments alive at once (instanced mesh capacity). */
    maxWalls: 400,
  },
  structures: {
    wall: {
      /**
       * Cross-section in meters. Each wall runs along one grid edge (one cell long). The upright sits
       * on a lip at each side of its base; lips stay under the player's step height so they can be stepped over.
       */
      height: 2.5,
      thickness: 0.4,
      lipWidth: 0.2,
      lipHeight: 0.25,
      /** Size of the 45 degree bevel on each lip's outer top edge. */
      lipBevel: 0.06,
      /**
       * Height of the lip as the player's feet feel it. Low enough that the capsule rides up over it like a
       * gentle slope from any angle; bullets and grenades still hit the full `lipHeight`.
       */
      playerStepHeight: 0.1,
      /** One grenade at point blank leaves it damaged, two breach it, three bring it down. */
      hp: 300,
    },
    mgNest: {
      hp: 600,
    },
    core: {
      hp: 1000,
    },
  },
  destruction: {
    /**
     * Damage states by HP fraction: at or below `damaged` the plaster cracks and chips to the brick,
     * at or below `breached` holes go through, and at 0 the wall collapses into rubble.
     * Repairs roll the states back with the same thresholds.
     */
    thresholds: {
      damaged: 0.66,
      breached: 0.33,
    },
    /**
     * Structure damage per damage type, times the hit's damage. Bullets barely scratch (a rifle needs 100 rounds
     * for a wall); explosions hit in full; a knife next to nothing (about 110 slashes for a wall). The outpost core
     * takes damage as it comes, without these.
     */
    damageMultipliers: {
      ballistic: 0.12,
      explosive: 1,
      melee: 0.05,
    },
    /** Breached walls' bullet colliders leave this fraction of each hole's width and height open (the ragged rim stays solid). */
    holeColliderScale: 0.8,
    debris: {
      /** Chunks thrown by each collapse. */
      minChunks: 6,
      maxChunks: 12,
      /** Most chunks alive at once (pool size). The oldest is reused once all are out. */
      maxActive: 60,
      /** Seconds a chunk lies before fading, and how long the fade takes. */
      lifetime: 4,
      fadeTime: 0.6,
      /** Launch speed away from the damage source, in m/s, plus an upward kick. */
      minSpeed: 2.5,
      maxSpeed: 6,
      upSpeed: 3,
      /** Most spin, in radians per second, about each axis. */
      maxSpin: 12,
      /** A landing this hard (change in speed, in m/s) clinks, at most once per `soundGap` seconds across all chunks. */
      soundSpeed: 2.5,
      soundGap: 0.07,
    },
    rubble: {
      /** Wall rubble pile: length along the wall, width across, and peak height, in meters. */
      length: 2.3,
      width: 1.5,
      height: 0.5,
      /** The MG nest's sandbag pile: square side and peak height. */
      nestSize: 3.6,
      nestHeight: 0.42,
      /** Most rubble piles on the field. The oldest is cleared to make room. */
      maxPiles: 600,
    },
    /** Camera shake from a collapse: full `trauma` (0..1) next to it, none beyond `shakeRadius` meters. */
    collapseShakeRadius: 8,
    collapseShakeTrauma: 0.45,
  },
  repair: {
    /** Aim at a damaged structure this close and hold E to repair it, in meters. */
    range: 2.5,
    /** HP restored per second. */
    rate: 80,
    /**
     * Dollars per HP restored. A wall (300 HP) repaired from 1 HP costs about $63, half its price;
     * the MG nest (600 HP) about $360, about half of its $750.
     */
    cashPerHp: {
      wall: 0.21,
      mgNest: 0.6,
      /** Never damaged, so never repaired. */
      weaponCrate: 0,
      consumablesCrate: 0,
    },
    /** Repairs are paid up front in steps of this many dollars, so cash ticks down instead of flickering every frame. */
    chargeStep: 5,
    /** A damaged structure's HP bar shows while aiming at it within this distance, in meters. */
    hpBarRange: 12,
  },
  /**
   * The weapon crate: a temporary buildable shop (1 x 1 cell, not damageable). Look at it within `useRange` and press E
   * to open its menu, in any phase: weapons by section, bought (or refilled when already carried) with a click.
   */
  weaponCrate: {
    useRange: 2.5,
  },
  /** The consumables crate: the same kind of shop for armor plates and frag grenades. */
  consumablesCrate: {
    useRange: 2.5,
  },
  hud: {
    /** How quickly the crosshair follows the weapon's spread (higher = faster). */
    crosshairSpeed: 14,
    /** The magazine count turns red at or below this fraction of a full magazine. */
    lowAmmoFraction: 0.25,
    /** Cash popups that can be on screen at once (pool size). */
    maxCashPopups: 10,
    /** Seconds a "+$100" popup stays: about 2 s fully visible, then it drifts up and fades over the last second. */
    cashPopupLifetime: 3,
  },
  /**
   * Feedback for damage the player takes: direction wedges on a ring around the crosshair, a camera jolt, the
   * screen shatter when the last armor plate breaks, and blood, blur and a heartbeat at low health.
   */
  damageFeedback: {
    indicators: {
      /** Radius of the invisible ring the wedges sit on, as a fraction of the screen height. */
      ringRadius: 0.18,
      /**
       * Each indicator is a flat bar curving along the ring, drawn as a low-res sprite: the arc it spans, in degrees,
       * its thickness in the middle as a fraction of the ring radius (weakest and strongest hit), and the fraction of
       * that thickness left at its ends.
       */
      arcDegrees: 52,
      minThickness: 0.12,
      maxThickness: 0.21,
      endThickness: 0.35,
      /** Sprite resolution: one sprite pixel is this fraction of the screen height (1/240 is about 4.5 px at 1080p). */
      pixelSize: 1 / 240,
      /** The fade runs in this many hard steps, like an old sprite's alpha. */
      fadeSteps: 6,
      /** Opacity of the weakest and strongest hit. */
      minOpacity: 0.35,
      maxOpacity: 0.75,
      /** A hit this big (after any earlier hits on the same wedge add up) shows at full strength. */
      fullStrengthDamage: 40,
      /** A repeat hit from the same attacker adds this fraction of its own strength to the wedge's. */
      repeatGain: 0.6,
      /** Seconds a wedge stays at full opacity, then takes to fade out. */
      holdTime: 0.5,
      fadeTime: 1.5,
      /** Wedges on screen at once (pool size). The faintest is reused when all are taken. */
      maxWedges: 8,
      /** Hit on armor, hit on health. Flat colors, no outline, no glow. */
      armorColor: '#3d7fe0',
      healthColor: '#cc1f1a',
    },
    jolt: {
      /** Degrees of kick per point of damage, and the most one hit gives (bullets, then blasts). */
      degreesPerDamage: 0.1,
      maxDegrees: 1.5,
      explosiveDegreesPerDamage: 0.06,
      explosiveMaxDegrees: 4,
      /** Share of the kick that goes into pitch, yaw and roll. */
      pitch: 0.8,
      yaw: 0.7,
      roll: 1.2,
      /** Spring stiffness of the recovery: the kick peaks after 1/speed seconds and is gone by about 5/speed. */
      recoverSpeed: 24,
      /** Jolt scale while aiming down sights and while mounted on the MG. */
      adsScale: 0.4,
      mountedScale: 0.35,
    },
    shatter: {
      /** Seconds the cracks stay fully visible, then take to fade out, and the length of the blue-white flash. */
      holdTime: 0.4,
      fadeTime: 1,
      flashTime: 0.18,
      flashOpacity: 0.55,
      /** Crack layouts generated at startup; one is picked at random each time. */
      layouts: 4,
      /** The impact point sits this far in from the screen edge on the hit's side, as a fraction of the screen. */
      edgeInset: 0.12,
      crackColor: '#f4fbff',
      shardTint: '#9fd2ff',
    },
    lowHealth: {
      /** Health fractions: blood and blur start below `wounded` and get clearly worse below `critical`. */
      wounded: 0.5,
      critical: 0.25,
      /** Effect strength just under `wounded` (it grows to 1 at `critical`), and the critical effect's just under `critical`. */
      woundedOnset: 0.45,
      criticalOnset: 0.4,
      /** How quickly the shown effect follows health (higher = faster), so it fades in and out instead of jumping. */
      easeSpeed: 3,
      /** Heartbeats per second while critical, and how much a beat swells the effect. */
      pulseRate: 1,
      pulseAmount: 0.35,
      /** Edge blur on the 3D scene, in low-resolution pixels: wounded, then critical on top. */
      blurWounded: 1.6,
      blurCritical: 3.2,
      /** Clear radius in the middle of the screen (fraction of the half height): wounded and critical. */
      clearRadiusWounded: 0.55,
      clearRadiusCritical: 0.3,
      /** Color lost when fully critical, 0..1. */
      desaturation: 0.55,
      /** Peak vignette opacity, wounded and critical. */
      vignetteWounded: 0.45,
      vignetteCritical: 0.8,
    },
  },
  enemies: {
    /** Pool size: the most enemies alive (or lying dead) at once. Nothing is created or destroyed during play. */
    maxActive: 40,
    /** Movement capsule, in meters. Every enemy type shares one body size. */
    radius: 0.35,
    height: 1.8,
    /** Where enemies look from, in meters above their feet. */
    eyeHeight: 1.62,
    /** Tallest ledge they walk up without help (wall lip proxies and rubble), and the steepest slope, in degrees. */
    stepHeight: 0.35,
    maxSlopeDegrees: 50,
    gravity: 22,
    /** How fast they reach their running speed and turn to face where they go or aim, in m/s^2 and rad/s. */
    acceleration: 18,
    turnSpeed: 7,
    /** Seconds between AI decisions per enemy (staggered across the pool). */
    thinkInterval: 0.1,
    /** Line-of-sight raycasts allowed per rendered frame across all enemies. Checks over budget wait for the next frame. */
    losBudgetPerFrame: 14,
    /** Enemies keep apart by steering, not by pushing: they slide away from each other inside this distance, in meters. */
    separationRadius: 1.1,
    separationStrength: 3.5,
    /** A path waypoint counts as reached this close, in meters. */
    waypointReach: 0.7,
    /** Moving less than `stuckDistance` meters in `stuckTime` seconds while trying to walk asks for a new path. */
    stuckTime: 1.5,
    stuckDistance: 0.5,
    /** Seconds the body takes to topple, lies before sinking, and takes to sink into the ground; and how far it sinks, in meters. */
    fallTime: 0.7,
    corpseTime: 8,
    sinkTime: 1.5,
    sinkDepth: 1.2,
    /** Footsteps are only played within this distance of the player, in meters, and meters per step at run speed. */
    footstepRange: 30,
    stride: 1.7,
    /** Each callout line plays at most once per this many seconds, from any enemy. */
    calloutGap: 6,
  },
  rifleman: {
    hp: 100,
    /** Advance speed, in m/s. */
    speed: 3.6,
    /** How often it checks whether it can see the player's head, in seconds, and how far it can see, in meters. */
    perceptionInterval: 0.2,
    sightRange: 60,
    /** Seconds from first seeing the player to the first shot. */
    reactionTime: 0.5,
    /** Seconds without sight of the player before it gives up and advances again. */
    loseSightTime: 2.5,
    /** On spotting the player it looks for cover (rubble, rocks, walls) within this many meters before it stops to shoot. */
    coverSearchRadius: 4,
    /** Rounds per burst (inclusive range), seconds between rounds, and pause between bursts. */
    burstMin: 3,
    burstMax: 5,
    fireInterval: 0.11,
    burstPauseMin: 0.8,
    burstPauseMax: 1.5,
    /** Damage per hit. Goes through the player's armor plates first. 3 riflemen at 25 m strip 3 full plates in about 5 s. */
    damage: 10,
    /** Bullet range, in meters. */
    range: 120,
    /** Spread as a cone half-angle in degrees: starts wide and tightens to `aimed` over `tightenTime` seconds of aiming at one target. */
    spread: {
      initial: 4.5,
      aimed: 1.1,
      tightenTime: 3,
      /** Added per 10 m to the target. */
      perTenMeters: 0.2,
      /** Added when the player moves at walk speed (scales with speed). */
      targetMoving: 1.6,
    },
    /** With no player in sight it stops to shoot the wall in its way from this close, in meters (ballistic damage to walls is weak). */
    wallShootRange: 12,
    /** With a clear line to the core it stops to shoot it from this close, in meters. */
    coreShootRange: 18,
  },
  sapper: {
    /** Less HP than a rifleman (2 rifle body shots), and faster. */
    hp: 50,
    speed: 6.4,
    /** Seconds crouched planting a charge (vulnerable throughout), and how far it runs back afterwards, in meters. */
    plantTime: 1.5,
    retreatDistance: 8,
    /** Charges carried. Out of charges, it keeps advancing toward the core and loiters there. */
    satchels: 3,
  },
  /**
   * Grenadier: a rifleman (same rifle, bursts, cover and perception, see `rifleman`) with a bandolier of frag grenades.
   * It lobs them at players who hide behind walls. Its grenades are ordinary frags (`grenade.damage`, `grenade.radius`).
   */
  grenadier: {
    hp: 100,
    speed: 3.4,
    /** Rifle spread, times the rifleman's. */
    spreadMultiplier: 1.3,
    /** Seconds between checks for someone to throw at. */
    checkInterval: 0.4,
    /** A player this far away, in meters, can be thrown at, when out of its sight or standing near walls. */
    throwMinRange: 12,
    throwMaxRange: 35,
    /** A player this close to a standing wall, in meters, counts as near walls (a grenade over the top flushes them out). */
    nearWallDistance: 3,
    /** Co-op: players within this distance of each other count as one group, and it aims at the middle of the biggest. */
    groupRadius: 5,
    /** Seconds of the overhand wind-up before the grenade leaves the hand (the players' warning), and of the follow-through after. */
    windupTime: 0.6,
    followThroughTime: 0.35,
    /** Seconds between throws, random in the range, and grenades carried per life. */
    cooldownMin: 6,
    cooldownMax: 9,
    grenades: 4,
    /** The throw lands this far from where it aims, in meters, at random: `base` plus `perTenMeters` per 10 m of range. */
    inaccuracy: { base: 0.8, perTenMeters: 0.7 },
    /** Seconds in the air: `base` plus `perMeter` per meter of range (a high lob that clears walls). */
    flightTime: { base: 1, perMeter: 0.04 },
    /** Seconds from the planned landing to the blast (its fuse is cut to land and go off soon after). */
    fuseAfterLanding: 0.6,
  },
  /**
   * Mortar team: one soldier with a mortar. It walks to a firing spot outside the build radius, sets up and shells the
   * inside of the base. Never breaches walls or plants charges.
   */
  mortar: {
    hp: 120,
    speed: 3.2,
    /** Most mortar teams alive at once, and the pool size (the dead lie for a while). */
    maxAlive: 2,
    poolSize: 6,
    /** The firing spot is this far from the core, in meters, within `sideAngle` degrees either side of the line to its spawn point. */
    minRange: 45,
    maxRange: 70,
    sideAngle: 40,
    /** Spots tried when choosing where to fire from; ones with blocked cells (rocks, props, ruins) within `coverRadius` meters win. */
    spotCandidates: 40,
    coverRadius: 4,
    /** Two mortar teams keep their firing spots at least this far apart, in meters. */
    spotSpacing: 12,
    /** Seconds to put the mortar down and kneel, then seconds between shells (random in the range). */
    setupTime: 3,
    fireIntervalMin: 6,
    fireIntervalMax: 8,
    /**
     * Shells walk in: the first one at a new target lands within `firstShotError` meters of it, each next one closer,
     * down to `minError` after `walkInShots` shots. A new target every `shotsPerTargetMin`-`shotsPerTargetMax` shells.
     */
    firstShotError: 6,
    minError: 2.5,
    walkInShots: 3,
    shotsPerTargetMin: 3,
    shotsPerTargetMax: 4,
    /**
     * How often each kind of target is picked (relative weights; kinds with nothing to aim at are skipped): a player
     * inside the build radius, the MG nest or a crate, the core, or any random point inside the build radius.
     */
    targetWeights: { player: 5, gear: 3, core: 2, random: 1 },
    shell: {
      /** Blast damage and radius, in meters, full damage inside `fullDamageRadius`. */
      damage: 80,
      radius: 5,
      fullDamageRadius: 1.2,
      /** Seconds in the air: `base` plus `perMeter` per meter from the mortar to the impact. */
      flightTime: { base: 3, perMeter: 0.015 },
      /** The incoming whistle starts at the impact point this many seconds before the shell lands. */
      whistleLead: 1.2,
      /** A dark streak shows the shell falling for its last this many seconds. */
      streakTime: 0.3,
      /** How high the shell's arc peaks, in meters (decides the angle of the falling streak). */
      apexHeight: 60,
      /** Shells in the air at once (pool size). */
      maxActive: 8,
    },
    /** A player this close, in meters, makes it stop shelling and fight with its pistol until they are `defendExitRange` away. */
    defendRange: 12,
    defendExitRange: 16,
    /** The pistol: weak hitscan. */
    pistol: {
      damage: 6,
      range: 60,
      /** Seconds between shots, random in the range, and from spotting the player to the first shot. */
      fireIntervalMin: 0.45,
      fireIntervalMax: 0.8,
      reactionTime: 0.4,
      /** Spread as a cone half-angle, in degrees, plus `targetMoving` when the player moves at walk speed. */
      spread: 3,
      targetMoving: 1.5,
    },
  },
  satchel: {
    /**
     * Blast damage and radius, and the radius of full damage, in meters. One charge breaches an intact wall
     * (300 HP) and leaves it at 30 HP, so a little more fire brings it down.
     */
    damage: 270,
    radius: 4,
    fullDamageRadius: 1,
    /** Seconds from planting to the blast, and from a dead sapper dropping it to the blast. */
    fuse: 3,
    droppedFuse: 2,
    /** Pool size. */
    maxActive: 16,
    /** Seconds between beeps at the start of the fuse and in its last second. */
    beepInterval: 0.5,
    beepIntervalFinal: 0.15,
  },
  pathfinding: {
    /** Path searches allowed per rendered frame. The rest wait in a queue. */
    budgetPerFrame: 4,
    /**
     * Searches also stop for the frame once they have taken this many milliseconds (at least one always runs).
     * A route through a walled-in outpost takes 1-3 ms; open ground far less.
     */
    budgetMsPerFrame: 3,
    /** After the walls change, enemies re-plan once things settle for this many seconds. */
    repathDebounce: 0.2,
    /** A search gives up after visiting this many cells. */
    maxVisited: 10000,
    /**
     * Walls never fully block planning: crossing a standing wall costs as much as walking `wallCrossBase` meters
     * plus `wallCrossPerHp` per HP it has left, so enemies breach the weakest wall. Breached walls are cheapest.
     */
    wallCrossBase: 30,
    wallCrossPerHp: 0.15,
    /** Walls farther from the core cost up to this fraction more (at the edge of the build radius), so breaches favor walls near the core. */
    wallCoreDistanceCost: 0.5,
    /** Enemies head for any open cell whose center is this close to the core, in meters. */
    coreGoalRadius: 3.3,
  },
  audio: {
    /** Volumes, 0..1. Every sound plays on one bus (see core/audio/sounds.ts); master scales them all. */
    buses: {
      master: 0.8,
      weapons: 1,
      footsteps: 0.8,
      effects: 1,
      ui: 1,
      music: 0.6,
    },
  },
  footsteps: {
    /** Played on surfaces that have no footstep sounds yet. */
    defaultSurface: 'gravel',
    /** Step volume for each stance, times the surface's sound volume. */
    volume: {
      walk: 1,
      sprint: 1.35,
      crouch: 0.4,
    },
    /** A landing thuds only after falling at least this fast, in m/s (a 1.2 m jump lands at about 7). */
    landingMinSpeed: 4.5,
    /** Landing step volume and pitch, times a normal step's. Volume grows with fall speed up to `landingMaxVolume`. */
    landingVolume: 1.4,
    landingMaxVolume: 1.8,
    landingPitch: 0.86,
  },
  multiplayer: {
    /** Players in one lobby, the host included. */
    maxPlayers: 4,
    /** Each player's position and view go out this many times a second. */
    playerSendRate: 20,
    /** The host sends every soldier's position and pose this many times a second. */
    enemySendRate: 15,
    /** Others are drawn this far in the past, in seconds, so there are always two updates to blend between. */
    interpolationDelay: 0.12,
    /** Each player past the first adds this share of a wave's budget (1 player: x1, 2: x1.5, 4: x2.5). */
    extraPlayerBudget: 0.5,
    /** Teammates spawn this far apart, in meters, side by side across the spawn point. */
    spawnSpacing: 1.5,
    /** Teammates' uniform color, a blue-gray that reads apart from the enemy's tan and olive. */
    allyUniform: 0x56606e,
    /** Lobby codes: this many characters from `codeAlphabet` (no 0/O, 1/I/L). */
    codeLength: 5,
    codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
    /** Prefix for the host's id on the PeerJS broker, so lobby codes do not collide with other apps. */
    peerPrefix: 'last-stand-fortress-',
    /** Give up on reaching the broker or a lobby after this many seconds. */
    connectTimeout: 15,
    /**
     * How players find a route to each other. STUN servers only tell each machine its public address, which is
     * enough for most home networks. Players behind strict networks (some mobile, school or office networks, VPNs)
     * also need a TURN relay: add one here, e.g. a free metered.ca account gives
     * `{ urls: ['turn:<host>:80', 'turns:<host>:443?transport=tcp'], username: '<user>', credential: '<key>' }`.
     * (PeerJS's own TURN servers, its default, no longer exist.)
     */
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ] as RTCIceServer[],
    /** Longest callsign, in characters. */
    maxNameLength: 16,
  },
  debug: {
    /**
     * Debug tools: the test keys (F1, F3, F4, F6, F8, J, K, Shift+K, L, M, N, U (refill every gun), 5-9, 0), the debug overlay and enemy
     * view, the playtest log (console wave summaries, and F8 saves the run as JSON) and the console logging.
     * Turn off for release.
     */
    enabled: true,
    /** Damage dealt by the K test key (Shift+K: the same hit from a random direction, `testHitDistance` meters away). */
    testDamage: 25,
    testHitDistance: 12,
    /** Cash earned by the M test key, in dollars. */
    testCash: 50,
    /** The J test key takes this fraction of the aimed-at structure's max HP. */
    structureDamageFraction: 0.25,
    /** How far the J key and the overlay's aimed-at readout look, in meters. */
    aimRange: 80,
  },
} as const;
