import type { Vector3 } from 'three';
import type { DamageSource } from '../combat/Damage';
import type { Damageable } from '../combat/Damageable';
import type { DamageType } from '../combat/DamageType';
import type { StructureType } from '../build/Buildables';
import type { DamageState } from '../destruction/DamageState';
import type { EnemyCallout, EnemyType } from '../enemies/EnemyType';
import type { Cell, Edge } from '../world/BuildGrid';
import type { SlotType, WeaponSounds } from '../player/weapons/defs/WeaponDef';
import type { Phase } from './GameState';
import type { BindingMap } from './Keybinds';

export interface PhaseChangedEvent {
  /** Previous phase, or null for the initial entry into BUILD. */
  from: Phase | null;
  to: Phase;
  wave: number;
}

export interface PlayerDamagedEvent {
  amount: number;
  type: DamageType;
  /**
   * Where the damage came from: the shooter's eye position for bullets, the blast center for grenades and satchels.
   * A copy, safe to keep.
   */
  position: Vector3;
  /** How much of `amount` the armor plates took, and how much went into health. */
  armorDamage: number;
  healthDamage: number;
  /** Armor and health after the hit. */
  armor: number;
  health: number;
  /** What fired the shot (an enemy), the same object for each of its hits; null for blasts and debug hits. */
  attacker: object | null;
}

/** The player's last armor plate broke: armor went from above 0 to 0. */
export interface ArmorBrokenEvent {
  /** Where the breaking hit came from (see `PlayerDamagedEvent.position`). A copy, safe to keep. */
  position: Vector3;
}

/** Where the player is looking from, sent once per rendered frame for HUD elements that point at places in the world. */
export interface PlayerViewEvent {
  /** Camera position. Only valid while the event dispatches; copy to keep. */
  position: Vector3;
  /** Camera heading in radians, as `FPSCamera.yaw`: 0 looks down -Z, positive turns left. */
  yaw: number;
}

/** One beat of the low-health heartbeat, while health is critical. */
export interface HeartbeatEvent {
  /** 0..1, how strong the critical effect is right now. */
  strength: number;
}

export interface ArmorChangedEvent {
  /** Armor points left, 0 to `maxPlates * armorPerPlate`. */
  armor: number;
  /** Spare plates carried. */
  spares: number;
}

export interface PlateAppliedEvent {
  /** Armor and spare plates after the plate went on. */
  armor: number;
  spares: number;
}

export interface PlateProgressEvent {
  /** 0..1 through the plate going on. 0 when plating stops or is cancelled. */
  progress: number;
}

export interface HealthChangedEvent {
  health: number;
  maxHealth: number;
}

export interface CashChangedEvent {
  /** Cash held after the change, in dollars. */
  cash: number;
}

export interface CashTransactionEvent extends CashChangedEvent {
  /** Dollars earned or spent. Always positive. */
  amount: number;
}

/** What cash was earned from. A kill's payment includes its headshot bonus. */
export type CashEarnReason = 'kill' | 'waveBonus' | 'refund' | 'debug';
/** What cash was spent on. */
export type CashSpendReason = 'wall' | 'mgNest' | 'weaponCrate' | 'consumablesCrate' | 'repair' | 'plate' | 'grenade' | 'weapon' | 'ammo';

export interface CashEarnedEvent extends CashTransactionEvent {
  reason: CashEarnReason;
}

export interface CashSpentEvent extends CashTransactionEvent {
  reason: CashSpendReason;
}

export interface CashInsufficientEvent {
  /** What the player tried to pay, and what they had. */
  cost: number;
  cash: number;
}

export interface PlatePurchasedEvent {
  /** Dollars paid for the plate. */
  cost: number;
}

export interface GrenadePurchasedEvent {
  /** Dollars paid for the grenade. */
  cost: number;
}

export interface PhaseTimerEvent {
  phase: Phase;
  /** Whole seconds left in the phase, rounded up. Emitted when the number changes. */
  seconds: number;
}

export interface StructureEvent {
  id: number;
  type: StructureType;
  /** Center of the structure on the ground. A copy, safe to keep. */
  position: Vector3;
}

export interface StructurePlacedEvent extends StructureEvent {
  cost: number;
}

export interface StructureRemovedEvent extends StructureEvent {
  refund: number;
}

export interface SegmentDamagedEvent extends StructureEvent {
  /** HP taken, after the structure damage multiplier for `damageType`. */
  amount: number;
  damageType: DamageType;
  hp: number;
  maxHp: number;
  /** Where the damage came from (the bullet's hit point or the blast center). A copy, safe to keep. */
  source: Vector3;
}

/** A structure moved between damage states: worse when hit, better when repaired. */
export interface SegmentStateChangedEvent extends StructureEvent {
  from: DamageState;
  to: DamageState;
}

/** A structure was destroyed (it collapsed into rubble). */
export interface SegmentDestroyedEvent extends StructureEvent {
  /** The structure's turn about +y, so effects can follow its length. */
  yaw: number;
  /** Where the killing damage came from, so debris flies away from it. A copy, safe to keep. */
  source: Vector3;
}

/** Whether movement can cross a grid edge changed (a wall placed, collapsed, rebuilt or removed). For M6 pathfinding. */
export interface NavChangedEvent {
  edge: Readonly<Edge>;
  blocked: boolean;
}

/** Whether these grid cells can be walked through changed (the MG nest placed, removed or collapsed). For M6 pathfinding. */
export interface NavCellsChangedEvent {
  cells: readonly Cell[];
  blocked: boolean;
}

export interface RubbleClearedEvent {
  /** Middle of the pile on the ground. A copy, safe to keep. */
  position: Vector3;
  /** Id of the structure that collapsed into this pile. */
  structureId: number;
}

/** Why a repair stopped. */
export type RepairStopReason = 'released' | 'lookedAway' | 'complete' | 'noCash' | 'destroyed';

export interface RepairStoppedEvent extends StructureEvent {
  reason: RepairStopReason;
}

/** A repair brought a structure back to full HP. */
export interface StructureRepairedEvent extends StructureEvent {
  hp: number;
  maxHp: number;
}

/** The "hold E to repair" prompt near the crosshair. */
export type RepairPromptEvent =
  | { mode: 'hidden' }
  /** Aiming at a damaged structure in reach. `cost` is the dollars to repair it fully; `error` is why it cannot be repaired now, or null. */
  | { mode: 'repair'; item: string; cost: number; repairing: boolean; error: string | null };

/** The damaged structure the player is aiming at or repairing, for its HP bar. Null when there is none. */
export interface StructureFocusEvent {
  target: {
    id: number;
    hp: number;
    maxHp: number;
    /** Where its HP bar floats. A copy, safe to keep. */
    anchor: Vector3;
  } | null;
}

export interface DebrisLandedEvent {
  /** Only valid while the event dispatches; copy to keep. */
  position: Vector3;
  /** Change in speed at the landing, in m/s. Louder for harder landings. */
  impactSpeed: number;
}

export interface CoreDamagedEvent {
  hp: number;
  maxHp: number;
}

export interface BuildToolChangedEvent {
  active: boolean;
}

/** What the build tool's text near the crosshair should say. */
export type BuildPromptEvent =
  | { mode: 'hidden' }
  /** Placing `item`; `error` says why it cannot be placed here, or null if it can. `rubble`: aiming at rubble F would clear. */
  | { mode: 'place'; item: string; cost: number; error: string | null; rubble: boolean }
  /** Aiming at a built structure that F would remove. */
  | { mode: 'remove'; item: string; refund: number }
  /** Aiming at rubble, which F clears for free. */
  | { mode: 'clearRubble' };

/** Which crate shop: the weapon crate or the consumables crate. */
export type ShopKind = 'weapons' | 'consumables';

/** The "press E" prompt while looking at a crate shop with its menu closed. */
export type ShopPromptEvent =
  | { mode: 'hidden' }
  /** Looking at a crate in reach: E opens its menu. `title` is the crate's name ("WEAPON CRATE"). */
  | { mode: 'open'; shop: ShopKind; title: string };

/** One row of a shop menu. The whole row is its buy button. */
export interface ShopItem {
  /** What a buy request names: a weapon def id, or a consumable id. */
  id: string;
  name: string;
  /** Silhouette key for the menu (a weapon def id, "armorPlate", "grenade"). */
  icon: string;
  /** What pressing the row does now, and its price in dollars. */
  action: 'buy' | 'refill';
  price: number;
  /** A short line under the name ("FULL AUTO", "OWNED", "CARRYING 3 / 5"). */
  detail: string;
  /** Why buying would fail right now ("NOT ENOUGH CASH", "AMMO FULL"), or null. */
  error: string | null;
  /** False when the player's cash does not cover `price`. */
  affordable: boolean;
}

export interface ShopSection {
  id: string;
  /** Tab label, e.g. "PISTOLS". A shop with one section shows no tabs. */
  name: string;
  items: ShopItem[];
}

/** A shop menu's full contents. Sent when it opens and again whenever a row changes (cash, loadout, ammo...). */
export interface ShopCatalogEvent {
  shop: ShopKind;
  title: string;
  sections: ShopSection[];
}

export interface ShopKindEvent {
  shop: ShopKind;
}

/** The menu asked to buy (or refill) one row. */
export interface ShopBuyRequestEvent extends ShopKindEvent {
  item: string;
}

/** A buy request went through. */
export interface ShopPurchaseEvent extends ShopBuyRequestEvent {
  cost: number;
}

export interface PlayerControlChangedEvent {
  /** True while the player has the mouse captured and is in control (alive, no debug camera). */
  active: boolean;
}

export interface PlayerDiedEvent {
  /** Type of the damage that dealt the killing blow. */
  type: DamageType;
}

/** Emitted by `applyDamage` for every hit that landed. */
export interface DamageDealtEvent {
  target: Damageable;
  amount: number;
  type: DamageType;
  /** Where the damage came from. A copy, safe to keep. */
  position: Vector3;
  source: DamageSource;
  headshot: boolean;
  /** True if this hit killed the target. */
  killed: boolean;
  /** Which player dealt it (see net/PlayerId.ts), or null when the source is not a player. */
  player: string | null;
  /** True when a multiplayer client sent the hit on to the host instead of applying it; `killed` is then a guess. */
  routed: boolean;
}

export interface WeaponEvent {
  /** The weapon's def id. */
  weapon: string;
  /** The weapon's sound ids. */
  sounds: Readonly<WeaponSounds>;
}

export interface WeaponFiredEvent extends WeaponEvent {
  /** World position of the muzzle. Only valid while the event dispatches; copy to keep. */
  muzzle: Vector3;
  /** Where the bullet stopped, or null if it hit nothing in range. Same lifetime as `muzzle`. */
  end: Vector3 | null;
  /** This shot's recoil, in degrees: the climb, and sideways (positive left). */
  kickUp: number;
  kickSide: number;
}

/** A weapon is being drawn into the player's hands (after a switch, a purchase, or putting the build tool away). */
export interface WeaponEquippedEvent extends WeaponEvent {
  displayName: string;
  kind: SlotType;
  /** Slot index: 0 and 1 the guns, 2 the melee weapon. */
  slot: number;
}

/** The player paid for a weapon at the weapon crate; the loadout places it (or refills it if already carried). */
export interface WeaponPurchasedEvent {
  weapon: string;
  displayName: string;
  cost: number;
  refill: boolean;
}

/** What the player carries, after any change. */
export interface LoadoutChangedEvent {
  /** Weapon def id per slot (gun 1, gun 2, melee), null when empty. */
  slots: readonly (string | null)[];
  /** The slot the player has selected. */
  current: number;
}

export interface MeleeSwungEvent extends WeaponEvent {
  attack: 'slash' | 'stab';
}

export interface MeleeHitEvent extends MeleeSwungEvent {
  /** Where the blade struck, and the surface normal. Only valid while the event dispatches; copy to keep. */
  point: Vector3;
  normal: Vector3;
  surface: ImpactSurface;
}

export interface AmmoChangedEvent {
  weapon: string;
  /** Name shown on the HUD, e.g. "M4". */
  displayName: string;
  magazine: number;
  magazineSize: number;
  reserve: number;
}

export interface AdsChangedEvent {
  /** True when the player starts aiming down sights, false when the aim drops (released, sprint, reload, throw...). */
  aiming: boolean;
}

export interface AdsProgressEvent {
  /** 0 at the hip, 1 fully aimed. Sent whenever it changes during a transition. */
  amount: number;
  /** Current horizontal field of view, in degrees at 4:3. */
  fov: number;
}

export interface WeaponSpreadChangedEvent {
  /** Inaccuracy as a cone half-angle, in radians. */
  spread: number;
}

export interface GrenadesChangedEvent {
  count: number;
  max: number;
}

/** What a bullet struck, which decides the impact effect. */
export type ImpactSurface = 'dirt' | 'hard' | 'target' | 'plaster' | 'brick' | 'sand' | 'flesh';

export interface BulletImpactEvent {
  /** Hit point and surface normal. Only valid while the event dispatches; copy to keep. */
  point: Vector3;
  normal: Vector3;
  surface: ImpactSurface;
}

export interface GrenadeBouncedEvent {
  /** Only valid while the event dispatches; copy to keep. */
  position: Vector3;
  /** Change in speed at the bounce, in m/s. Louder for harder bounces. */
  impactSpeed: number;
}

/** What blew up, so each kind can have its own sound. */
export type ExplosionKind = 'frag' | 'satchel';

export interface ExplosionEvent {
  /** Blast center. Only valid while the event dispatches; copy to keep. */
  position: Vector3;
  radius: number;
  damage: number;
  kind: ExplosionKind;
  /** Surface just below the blast for a scorch mark, or null if the blast was too high. Same lifetime as `position`. */
  groundPoint: Vector3 | null;
  groundNormal: Vector3;
}

export interface EnemyEvent {
  /** Pool slot of the enemy. Reused once a body has sunk away. */
  id: number;
  type: EnemyType;
  /** Feet position. A copy, safe to keep. */
  position: Vector3;
}

export interface EnemyDamagedEvent extends EnemyEvent {
  amount: number;
  hp: number;
  maxHp: number;
  source: DamageSource;
  headshot: boolean;
}

export interface EnemyKilledEvent extends EnemyEvent {
  /** Who dealt the killing blow. Only 'player' kills pay cash. */
  source: DamageSource;
  headshot: boolean;
  /** Which player got the kill (see net/PlayerId.ts); only that player is paid. Null when no player did. */
  killer: string | null;
}

export interface EnemyFiredEvent {
  type: EnemyType;
  /** Muzzle and where the bullet stopped. Only valid while the event dispatches; copy to keep. */
  muzzle: Vector3;
  end: Vector3;
}

export interface WorldSoundEvent {
  /** Only valid while the event dispatches; copy to keep. */
  position: Vector3;
}

export interface EnemyCalloutEvent extends WorldSoundEvent {
  line: EnemyCallout;
}

export interface SatchelArmedEvent extends WorldSoundEvent {
  /** Which way the bag faces, in radians. */
  yaw: number;
  /** Seconds to the blast. */
  fuse: number;
  /** True when a dying sapper dropped it rather than planting it. */
  dropped: boolean;
}

export interface WavePlannedEvent {
  wave: number;
  /** Indexes into the map's spawn points that this wave's squads will come from. */
  spawnPoints: readonly number[];
}

export interface WaveStartedEvent {
  wave: number;
  /** Points the wave director spends on this wave. */
  budget: number;
}

export interface SquadSpawnedEvent {
  wave: number;
  /** Index into the map's spawn points. */
  spawnPoint: number;
  riflemen: number;
  sappers: number;
}

export interface EnemiesRemainingEvent {
  /** Enemies alive plus those the wave director has not sent yet. */
  count: number;
}

export interface WaveClearedEvent {
  wave: number;
}

/** The numbers for one wave, shown on the aftermath summary. Sent as the aftermath starts. */
export interface WaveSummaryEvent {
  wave: number;
  /** Enemies the player killed, and how many of those kills were headshots. */
  kills: number;
  headshots: number;
  /** Dollars earned from the start of the fight, the wave-clear bonus included. */
  cashEarned: number;
  wallsLost: number;
  coreHp: number;
  coreMaxHp: number;
}

export type GameResult = 'won' | 'lost';
/** Why the game ended: every wave survived, the core fell, the player died, or the debug loss key. */
export type GameOverReason = 'held' | 'coreDestroyed' | 'playerDied' | 'forced';

export interface GameOverEvent {
  result: GameResult;
  reason: GameOverReason;
  /** The wave being played when the game ended. */
  wave: number;
}

/** Totals for the whole game, for the win and lose screens. */
export interface MatchSummaryEvent extends GameOverEvent {
  kills: number;
  headshots: number;
  cashEarned: number;
  wavesSurvived: number;
}

/** The "press E" prompt for mounting the MG. */
export interface MountPromptEvent {
  shown: boolean;
}

export interface MgMountedEvent {
  /** Structure id of the nest. */
  nestId: number;
  /** Name for the HUD's weapon slot while mounted. */
  displayName: string;
}

/** Why the player came off the MG. */
export type MgDismountReason = 'player' | 'destroyed' | 'died' | 'gameOver';

export interface MgDismountedEvent {
  nestId: number;
  reason: MgDismountReason;
}

export interface MgFiredEvent {
  /** The barrel tip and where the bullet stopped. Only valid while the event dispatches; copy to keep. */
  muzzle: Vector3;
  end: Vector3;
  /** This round is a tracer. */
  tracer: boolean;
}

export interface MgHeatChangedEvent {
  /** 0 cold, 1 overheated. */
  heat: number;
  /** Locked while it cools after reaching full heat. */
  overheated: boolean;
}

/** Another player fired (a gun or the MG), as seen on this machine. */
export interface AllyFiredEvent {
  /** Weapon def id, or 'mg'. */
  weapon: string;
  /** Sound id for the shot, played where it was fired, or null. */
  sound: string | null;
  /** Muzzle, and where the bullet stopped (null if it hit nothing). Only valid while the event dispatches. */
  muzzle: Vector3;
  end: Vector3 | null;
}

/** The player on this machine threw a grenade (multiplayer shows it on the others' screens). */
export interface GrenadeThrownEvent {
  /** Only valid while the event dispatches; copy to keep. */
  position: Vector3;
  velocity: Vector3;
}

/** Multiplayer: how many players have pressed the start key to begin the wave (or skip the summary). */
export interface ReadyChangedEvent {
  ready: number;
  total: number;
  /** The player on this machine is one of them. */
  self: boolean;
}

export interface SessionPlayer {
  id: string;
  name: string;
}

/** The game began. Sent once, before the first phase. */
export interface SessionStartedEvent {
  multiplayer: boolean;
  players: readonly SessionPlayer[];
  localId: string;
}

/** Multiplayer: the player on this machine is down until the next build phase, or back up. */
export interface PlayerDownedEvent {
  down: boolean;
}

/** One teammate's name tag on screen. */
export interface AllyTag {
  id: string;
  name: string;
  /** Screen position in CSS pixels, and whether it is in front of the camera at all. */
  x: number;
  y: number;
  visible: boolean;
  down: boolean;
}

/** Where every teammate's name tag goes this frame. The array and its items are reused; copy to keep. */
export interface AllyTagsEvent {
  tags: readonly AllyTag[];
}

/** Multiplayer: the link to the host (or a teammate's link) changed. */
export interface PeerEvent {
  id: string;
  name: string;
}

export interface ConnectionLostEvent {
  reason: string;
}

export interface KeybindsChangedEvent {
  /** Every action's primary and alternate key ('' when unbound). A snapshot, safe to keep. */
  binds: BindingMap;
}

export interface UiScaleChangedEvent {
  /** The UI size picked, 1 to 5 (1x to 5x). */
  level: number;
  /** Multiplier on the reference HUD size (1 at the standard size). */
  scale: number;
}

export interface PauseChangedEvent {
  paused: boolean;
}

/** Map of every game event name to its payload type. */
export interface GameEvents {
  phaseChanged: PhaseChangedEvent;
  playerDamaged: PlayerDamagedEvent;
  armorBroken: ArmorBrokenEvent;
  playerView: PlayerViewEvent;
  heartbeat: HeartbeatEvent;
  playerDied: PlayerDiedEvent;
  armorChanged: ArmorChangedEvent;
  plateApplied: PlateAppliedEvent;
  plateProgress: PlateProgressEvent;
  healthChanged: HealthChangedEvent;
  playerControlChanged: PlayerControlChangedEvent;
  cashChanged: CashChangedEvent;
  cashEarned: CashEarnedEvent;
  cashSpent: CashSpentEvent;
  cashInsufficient: CashInsufficientEvent;
  platePurchased: PlatePurchasedEvent;
  grenadePurchased: GrenadePurchasedEvent;
  phaseTimer: PhaseTimerEvent;
  structurePlaced: StructurePlacedEvent;
  structureRemoved: StructureRemovedEvent;
  segmentDamaged: SegmentDamagedEvent;
  segmentStateChanged: SegmentStateChangedEvent;
  segmentDestroyed: SegmentDestroyedEvent;
  navChanged: NavChangedEvent;
  navCellsChanged: NavCellsChangedEvent;
  rubbleCleared: RubbleClearedEvent;
  repairStarted: StructureEvent;
  repairStopped: RepairStoppedEvent;
  structureRepaired: StructureRepairedEvent;
  repairPromptChanged: RepairPromptEvent;
  structureFocusChanged: StructureFocusEvent;
  debrisLanded: DebrisLandedEvent;
  coreDamaged: CoreDamagedEvent;
  coreDestroyed: Record<string, never>;
  buildToolChanged: BuildToolChangedEvent;
  buildPromptChanged: BuildPromptEvent;
  shopPromptChanged: ShopPromptEvent;
  /** A crate shop's menu opened (the mouse is freed for it), with its contents. */
  shopOpened: ShopCatalogEvent;
  /** The open menu's contents changed. */
  shopChanged: ShopCatalogEvent;
  shopClosed: ShopKindEvent;
  /** From the shop menu: buy a row, close the menu. */
  shopBuyRequested: ShopBuyRequestEvent;
  shopCloseRequested: ShopKindEvent;
  shopPurchased: ShopPurchaseEvent;
  /** The player tried something the current prompt said they cannot do (place, buy). */
  actionDenied: Record<string, never>;
  damageDealt: DamageDealtEvent;
  weaponFired: WeaponFiredEvent;
  weaponReloadStarted: WeaponEvent;
  /** A reload stopped before it finished (the weapon was switched or put away, or refilled). */
  weaponReloadCancelled: WeaponEvent;
  weaponDryFired: WeaponEvent;
  /** The trigger was let go after firing, or the shot just fired emptied the magazine. */
  weaponBurstEnded: WeaponEvent;
  weaponEquipped: WeaponEquippedEvent;
  weaponPurchased: WeaponPurchasedEvent;
  loadoutChanged: LoadoutChangedEvent;
  /** A knife attack started. */
  meleeSwung: MeleeSwungEvent;
  /** A knife attack struck something (its damage goes through `applyDamage` as usual). */
  meleeHit: MeleeHitEvent;
  ammoChanged: AmmoChangedEvent;
  weaponSpreadChanged: WeaponSpreadChangedEvent;
  adsChanged: AdsChangedEvent;
  adsProgress: AdsProgressEvent;
  grenadesChanged: GrenadesChangedEvent;
  bulletImpact: BulletImpactEvent;
  grenadeBounced: GrenadeBouncedEvent;
  explosion: ExplosionEvent;
  enemySpawned: EnemyEvent;
  enemyDamaged: EnemyDamagedEvent;
  enemyKilled: EnemyKilledEvent;
  enemyFired: EnemyFiredEvent;
  enemyFootstep: WorldSoundEvent;
  enemyCallout: EnemyCalloutEvent;
  satchelArmed: SatchelArmedEvent;
  satchelBeep: WorldSoundEvent;
  wavePlanned: WavePlannedEvent;
  waveStarted: WaveStartedEvent;
  squadSpawned: SquadSpawnedEvent;
  enemiesRemaining: EnemiesRemainingEvent;
  waveCleared: WaveClearedEvent;
  waveSummary: WaveSummaryEvent;
  gameOver: GameOverEvent;
  matchSummary: MatchSummaryEvent;
  mountPromptChanged: MountPromptEvent;
  mgMounted: MgMountedEvent;
  mgDismounted: MgDismountedEvent;
  mgFired: MgFiredEvent;
  /** The trigger was let go after firing, or the gun overheated mid-burst. */
  mgBurstEnded: Record<string, never>;
  mgOverheated: Record<string, never>;
  mgHeatChanged: MgHeatChangedEvent;
  allyFired: AllyFiredEvent;
  grenadeThrown: GrenadeThrownEvent;
  readyChanged: ReadyChangedEvent;
  sessionStarted: SessionStartedEvent;
  playerDowned: PlayerDownedEvent;
  allyTags: AllyTagsEvent;
  /** A teammate left the game. */
  peerLeft: PeerEvent;
  /** A multiplayer client lost its host: the game cannot go on. */
  connectionLost: ConnectionLostEvent;
  keybindsChanged: KeybindsChangedEvent;
  uiScaleChanged: UiScaleChangedEvent;
  /** The game stopped or went on: the pause menu opened or closed (also before the first click into the game). */
  pauseChanged: PauseChangedEvent;
}

type Handler<T> = (payload: T) => void;

export class EventBus<Events extends object = GameEvents> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();
  /**
   * Each event's handlers as an array, rebuilt only when they change. Dispatch walks this snapshot, so handlers
   * may unsubscribe (or subscribe) while an event is dispatching, and emitting allocates nothing.
   */
  private readonly snapshots = new Map<keyof Events, Handler<never>[]>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    this.snapshots.delete(type);
    return () => this.off(type, handler);
  }

  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void {
    if (this.handlers.get(type)?.delete(handler as Handler<never>)) this.snapshots.delete(type);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    let list = this.snapshots.get(type);
    if (!list) {
      const set = this.handlers.get(type);
      if (!set || set.size === 0) return;
      list = [...set];
      this.snapshots.set(type, list);
    }
    for (let i = 0; i < list.length; i++) (list[i] as Handler<Events[K]>)(payload);
  }
}
