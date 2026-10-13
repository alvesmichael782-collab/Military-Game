import type { Vector3 } from 'three';
import type { DamageSource } from '../combat/Damage';
import type { Damageable } from '../combat/Damageable';
import type { DamageType } from '../combat/DamageType';
import type { StructureType } from '../build/Buildables';
import type { DamageState } from '../destruction/DamageState';
import type { EnemyCallout, EnemyType } from '../enemies/EnemyType';
import type { Cell, Edge } from '../world/BuildGrid';
import type { WeaponSoundSet } from '../player/weapons/Weapon';
import type { Phase } from './GameState';

export interface PhaseChangedEvent {
  /** Previous phase, or null for the initial entry into BUILD. */
  from: Phase | null;
  to: Phase;
  wave: number;
}

export interface PlayerDamagedEvent {
  amount: number;
  type: DamageType;
  /** Where the damage came from. A copy, safe to keep. */
  position: Vector3;
  armorDamage: number;
  healthDamage: number;
  /** Armor and health after the hit. */
  armor: number;
  health: number;
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
export type CashSpendReason = 'wall' | 'mgNest' | 'repair' | 'plate';

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

/** The "press E" prompt for whatever usable thing the player is looking at. */
export type InteractPromptEvent =
  | { mode: 'hidden' }
  /** Looking at the armor crate. `error` is why buying would fail right now, or null. */
  | { mode: 'armorCrate'; cost: number; error: string | null };

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
}

export interface WeaponEvent {
  weapon: string;
  /** The weapon's sound ids. */
  sounds: Readonly<WeaponSoundSet>;
}

export interface WeaponFiredEvent extends WeaponEvent {
  /** World position of the muzzle. Only valid while the event dispatches; copy to keep. */
  muzzle: Vector3;
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

/** Map of every game event name to its payload type. */
export interface GameEvents {
  phaseChanged: PhaseChangedEvent;
  playerDamaged: PlayerDamagedEvent;
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
  interactPromptChanged: InteractPromptEvent;
  /** The player tried something the current prompt said they cannot do (place, buy). */
  actionDenied: Record<string, never>;
  damageDealt: DamageDealtEvent;
  weaponFired: WeaponFiredEvent;
  weaponReloadStarted: WeaponEvent;
  /** A reload stopped before it finished (the build tool came out, or a debug refill). */
  weaponReloadCancelled: WeaponEvent;
  weaponDryFired: WeaponEvent;
  /** The trigger was let go after firing, or the shot just fired emptied the magazine. */
  weaponBurstEnded: WeaponEvent;
  /** The weapon came back out, e.g. when the build tool is put away. */
  weaponEquipped: WeaponEvent;
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
