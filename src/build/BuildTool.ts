import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, type Scene } from 'three';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { BuildPromptEvent, EventBus, GameEvents } from '../core/EventBus';
import { Phase } from '../core/GameState';
import type { Input } from '../core/Input';
import type { RubblePile } from '../destruction/RubbleField';
import type { Purse } from '../economy/Purse';
import { aimBasis, type AimState } from '../player/Aim';
import { edgeDirBit, type BuildGrid, type Cell, type Edge } from '../world/BuildGrid';
import { BUILDABLES, refundOf, type Buildable } from './Buildables';
import { BuildGhost } from './BuildGhost';
import { NEST, NEST_WALL_HEIGHT } from './MgNestModel';
import type { Structure } from './Structure';
import { StructureHighlight } from './StructureHighlight';
import { wallYaw, type StructureManager } from './StructureManager';
import { wallEnds, type WallEnd } from './WallRenderer';
import { JOINT_RADIUS } from './WallGeometry';
import { SHOP_CRATE_SIZES, type ShopCrateType } from './ShopCrate';
import type { StructureCommands } from './StructureCommands';
import { localPlayerId } from '../net/PlayerId';

export const BuildError = {
  OUTSIDE: 'OUTSIDE BUILD AREA',
  OCCUPIED: 'SPACE OCCUPIED',
  PLAYER: 'YOU ARE IN THE WAY',
  CASH: 'NOT ENOUGH CASH',
  LIMIT: 'MG NEST LIMIT REACHED',
  CRATE_LIMIT: 'CRATE LIMIT REACHED',
  REACH: 'OUT OF REACH',
} as const;

const QUARTER_TURN = Math.PI / 2;
/** Overlap test boxes start this far above the ground so the ground itself never counts. */
const GROUND_CLEARANCE = 0.04;
/** Overlap test boxes are this much smaller than the real thing on every side, so merely touching never counts. */
const SHRINK = 0.03;

/**
 * First-person build tool, BUILD phase only. B takes it out or puts it away; while out the weapon is put away.
 * The left and right arrows pick what to build, R turns it, left click places it for its price, and F removes the structure
 * under the crosshair for a partial refund, or clears the rubble under it for free.
 *
 * Walls go on grid edges: by default the wall runs across the player's view, and the ghost snaps to the
 * nearest edge running that way. Whether a wall may go somewhere is decided by the grid's edges, so walls
 * touching walls are always fine; the physics check only looks for everything else (the player, props,
 * targets, grenades, the core, the crate, the MG nest). Wall rubble never blocks a wall: building on a
 * rubble edge clears that pile, and neighbouring piles simply lie against the new wall's foot.
 */
export class BuildTool {
  private active = false;
  private phase: Phase = Phase.BUILD;
  private cash = 0;
  private selected = 0;
  private rotation = 0;

  private wantToggle = false;
  private wantPlace = false;
  private wantRemove = false;
  private turns = 0;
  private scroll = 0;

  private readonly ghost: BuildGhost;
  private readonly highlight: StructureHighlight;
  private target: Structure | null = null;
  private promptKey = '';

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly ground = new Vector3();
  private readonly base = new Vector3();
  private readonly edge: Edge = { axis: 'x', i: 0, j: 0 };
  private readonly vertex: Cell = { i: 0, j: 0 };
  private readonly cell: Cell = { i: 0, j: 0 };
  private readonly cells: Cell[] = [];
  private readonly ends: [WallEnd, WallEnd] = [
    { x: 0, z: 0, dir: 0, shape: 0 },
    { x: 0, z: 0, dir: 0, shape: 0 },
  ];
  /** The walls at a grid point once the previewed wall is built too. */
  private readonly maskWithPreview = (i: number, j: number): number => this.grid.wallMaskAt(i, j) | edgeDirBit(this.edge, i, j);
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  private readonly wallBox: RAPIER.Cuboid;
  private readonly nestBox: RAPIER.Cuboid;
  private readonly crateBoxes: Record<ShopCrateType, RAPIER.Cuboid>;

  constructor(
    scene: Scene,
    private readonly world: RAPIER.World,
    private readonly grid: BuildGrid,
    private readonly structures: StructureManager,
    private readonly purse: Purse,
    private readonly events: EventBus<GameEvents>,
    private readonly playerCollider: number,
    /** Where placements and removals go: the structures themselves, or (multiplayer client) the host. */
    private commands: StructureCommands = structures,
  ) {
    this.ghost = new BuildGhost(scene, (shown) => structures.previewWall(shown ? this.edge : null));
    this.highlight = new StructureHighlight(scene);
    const w = config.structures.wall;
    this.wallBox = new RAPIER.Cuboid(config.build.cellSize / 2 - SHRINK, w.height / 2 - GROUND_CLEARANCE, JOINT_RADIUS - SHRINK);
    // The nest checks its whole square, so the player cannot build it around themselves either.
    const outer = NEST.ring + NEST.bagDepth / 2 - SHRINK;
    this.nestBox = new RAPIER.Cuboid(outer, NEST_WALL_HEIGHT / 2, outer);
    const crateBox = (type: ShopCrateType): RAPIER.Cuboid => {
      const c = SHOP_CRATE_SIZES[type];
      return new RAPIER.Cuboid(c.x / 2 - SHRINK, c.y / 2 - GROUND_CLEARANCE, c.z / 2 - SHRINK);
    };
    this.crateBoxes = { weaponCrate: crateBox('weaponCrate'), consumablesCrate: crateBox('consumablesCrate') };

    events.on('phaseChanged', ({ to }) => {
      this.phase = to;
      if (to !== Phase.BUILD) this.setActive(false);
    });
    events.on('cashChanged', ({ cash }) => {
      this.cash = cash;
    });
  }

  /** Multiplayer: send placements and removals here instead (to the host, from a client). */
  setCommands(commands: StructureCommands): void {
    this.commands = commands;
  }

  /** True while the tool is out. The rifle and grenades are unavailable meanwhile. */
  get isActive(): boolean {
    return this.active;
  }

  /** Call once per rendered frame, before `input.endFrame()`. */
  handleInput(input: Input, enabled: boolean): void {
    if (!enabled) return;
    if (input.wasActionPressed('buildMode')) this.wantToggle = true;
    if (!this.active) return;
    if (input.wasActionPressed('place')) this.wantPlace = true;
    if (input.wasActionPressed('remove')) this.wantRemove = true;
    if (input.wasActionPressed('rotate')) this.turns++;
    this.scroll += input.cycleSteps;
  }

  /** Aim, preview, and carry out this frame's requests. Call after the camera has moved. */
  update(aim: AimState): void {
    if (this.wantToggle) this.setActive(!this.active && this.phase === Phase.BUILD);
    this.wantToggle = false;
    if (!this.active) {
      this.clearRequests();
      return;
    }

    const count = BUILDABLES.length;
    this.selected = (((this.selected + this.scroll) % count) + count) % count;
    this.rotation = (this.rotation + this.turns) % 4;
    const buildable = BUILDABLES[this.selected];

    aimBasis(aim.yaw, aim.pitch, this.forward, this.right, this.up);
    const hit = this.castFrom(aim.eye, config.build.reach);
    const aimed = hit ? (this.structures.structureOf(hit.collider) ?? null) : null;
    const rubble = hit && !aimed ? this.structures.rubbleOf(hit.collider) : undefined;
    this.setTarget(aimed);

    if (rubble && buildable.type !== 'wall') {
      // Wall rubble does not stop a wall going up over it, so only the nest and the crate need it cleared first.
      this.ghost.hide();
      this.setPrompt({ mode: 'clearRubble' });
      if (this.wantRemove) this.clearRubble(rubble);
    } else if (rubble && this.wantRemove) {
      this.clearRubble(rubble);
    } else if (aimed) {
      this.ghost.hide();
      // Removing refunds whoever built it, so another player's structure gives you nothing back.
      this.setPrompt({ mode: 'remove', item: nameOf(aimed), refund: aimed.owner === localPlayerId() ? refundOf(aimed.type) : 0 });
      if (this.wantRemove) this.remove(aimed);
    } else {
      // The player's facing, snapped to a quarter turn, plus their R turns.
      const facing = Math.round(aim.yaw / QUARTER_TURN) + this.rotation;
      const error = this.groundPoint(aim.eye) ? this.preview(buildable, facing) : BuildError.REACH;
      if (error === BuildError.REACH) this.ghost.hide();
      this.setPrompt({ mode: 'place', item: buildable.name, cost: buildable.cost, error, rubble: rubble !== undefined });
      if (this.wantPlace) this.place(buildable, facing, error);
    }
    this.clearRequests();
  }

  private setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) {
      this.ghost.hide();
      this.setTarget(null);
      this.setPrompt({ mode: 'hidden' });
    }
    this.events.emit('buildToolChanged', { active });
  }

  private preview(buildable: Buildable, facing: number): string | null {
    if (buildable.type === 'wall') return this.previewWall(facing);
    if (buildable.type === 'mgNest') return this.previewNest(facing);
    return this.previewCrate(buildable.type, facing);
  }

  // ---- Walls ----

  /** Snap a wall to the edge nearest the ground point, running across the view (or turned by R). */
  private previewWall(facing: number): string | null {
    // Looking along z (facing even), "across the view" is along x.
    const axis = (((facing % 2) + 2) % 2 === 0 ? 'x' : 'z') as Edge['axis'];
    this.grid.edgeNear(this.ground.x, this.ground.z, axis, this.edge);
    this.grid.edgeMidpoint(this.edge, this.base);
    const yaw = wallYaw(this.edge);

    // Its ends, shaped for how it will join the walls already there once it is placed.
    wallEnds(this.edge, this.base, this.maskWithPreview, this.ends);

    const error = this.checkWall(yaw);
    this.ghost.showWall(this.base, yaw, this.ends, error === null);
    return error;
  }

  private checkWall(yaw: number): string | null {
    const buildable = BUILDABLES[this.selected];
    if (this.structures.countOf('wall') >= buildable.limit) return BuildError.LIMIT;
    if (!this.grid.isEdgeInBuildRadius(this.edge)) return BuildError.OUTSIDE;
    if (!this.grid.isEdgeFree(this.edge)) return BuildError.OCCUPIED;
    const overlap = this.overlap(this.wallBox, yaw, true);
    if (overlap) return overlap;
    if (this.cash < buildable.cost) return BuildError.CASH;
    return null;
  }

  // ---- MG nest ----

  /** Snap the nest to the grid point nearest the ground point; it covers the 2 x 2 cells around it. */
  private previewNest(facing: number): string | null {
    this.grid.vertexNear(this.ground.x, this.ground.z, this.vertex);
    this.structures.footprint(this.vertex, this.cells);
    this.base.set(this.grid.vertexX(this.vertex.i), 0, this.grid.vertexZ(this.vertex.j));
    const yaw = facing * QUARTER_TURN;
    const error = this.checkNest(yaw);
    this.ghost.showNest(this.base, yaw, error === null);
    return error;
  }

  private checkNest(yaw: number): string | null {
    const buildable = BUILDABLES[this.selected];
    if (this.structures.countOf('mgNest') >= buildable.limit) return BuildError.LIMIT;
    if (this.cells.some(({ i, j }) => !this.grid.isInBuildRadius(i, j))) return BuildError.OUTSIDE;
    if (this.cells.some(({ i, j }) => !this.grid.isFree(i, j))) return BuildError.OCCUPIED;
    // No walls on the four edges inside the footprint (the ones meeting at its center point).
    if (this.grid.wallMaskAt(this.vertex.i, this.vertex.j) !== 0) return BuildError.OCCUPIED;
    // Walls do count here: the sandbags must not overlap any.
    const overlap = this.overlap(this.nestBox, yaw, false);
    if (overlap) return overlap;
    if (this.cash < buildable.cost) return BuildError.CASH;
    return null;
  }

  // ---- Shop crates ----

  /** Snap the crate to the center of the cell under the ground point. */
  private previewCrate(type: ShopCrateType, facing: number): string | null {
    const onMap = this.grid.cellAt(this.ground.x, this.ground.z, this.cell);
    this.base.set(this.grid.centerX(this.cell.i), 0, this.grid.centerZ(this.cell.j));
    const yaw = facing * QUARTER_TURN;
    const error = onMap ? this.checkCrate(type, yaw) : BuildError.OUTSIDE;
    this.ghost.showCrate(type, this.base, yaw, error === null);
    return error;
  }

  private checkCrate(type: ShopCrateType, yaw: number): string | null {
    const buildable = BUILDABLES[this.selected];
    if (this.structures.countOf(type) >= buildable.limit) return BuildError.CRATE_LIMIT;
    if (!this.grid.isInBuildRadius(this.cell.i, this.cell.j)) return BuildError.OUTSIDE;
    if (!this.grid.isFree(this.cell.i, this.cell.j)) return BuildError.OCCUPIED;
    const overlap = this.overlap(this.crateBoxes[type], yaw, false);
    if (overlap) return overlap;
    if (this.cash < buildable.cost) return BuildError.CASH;
    return null;
  }

  // ---- Shared ----

  /** Anything solid inside `box` standing at `this.base`. Walls are skipped when `ignoreWalls`. */
  private overlap(box: RAPIER.Cuboid, yaw: number, ignoreWalls: boolean): string | null {
    const half = yaw / 2;
    const rotation = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
    const center = { x: this.base.x, y: box.halfExtents.y + GROUND_CLEARANCE, z: this.base.z };
    let result: string | null = null;
    this.world.intersectionsWithShape(
      center,
      rotation,
      box,
      (collider) => {
        if (collider.handle === this.playerCollider) {
          result = BuildError.PLAYER;
          return false;
        }
        result = BuildError.OCCUPIED;
        return true;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      ignoreWalls ? (collider) => !this.structures.isWallCollider(collider) && !this.structures.isWallRubbleCollider(collider) : undefined,
    );
    return result;
  }

  /** Where the crosshair meets the ground within reach, into `this.ground`. False if it does not. */
  private groundPoint(eye: Vector3): boolean {
    const reach = config.build.reach;
    const hit = this.castFrom(eye, reach);
    if (hit) {
      this.ground.copy(eye).addScaledVector(this.forward, hit.timeOfImpact).setY(0);
      return true;
    }
    // Nothing solid in reach: try the ground plane itself (rays can skim past it at shallow angles).
    if (this.forward.y >= -1e-3) return false;
    const t = -eye.y / this.forward.y;
    if (t > reach) return false;
    this.ground.copy(eye).addScaledVector(this.forward, t).setY(0);
    return true;
  }

  private castFrom(eye: Vector3, reach: number): RAPIER.RayColliderHit | null {
    this.ray.origin = { x: eye.x, y: eye.y, z: eye.z };
    this.ray.dir = { x: this.forward.x, y: this.forward.y, z: this.forward.z };
    // The bullet filter sees world geometry and targets, and passes through the player and boundary walls.
    return this.world.castRay(this.ray, reach, true, undefined, Groups.bullet);
  }

  private place(buildable: Buildable, facing: number, error: string | null): void {
    if (error === BuildError.CASH) {
      // The wallet refuses and reports it, so the HUD flashes the cash counter.
      this.purse.spend(buildable.cost, buildable.type);
      return;
    }
    if (error !== null) {
      this.events.emit('actionDenied', {});
      return;
    }
    if (!this.purse.spend(buildable.cost, buildable.type)) return;
    if (buildable.type === 'wall') this.commands.placeWall({ ...this.edge }, buildable.cost);
    else if (buildable.type === 'mgNest') this.commands.placeMgNest({ ...this.vertex }, facing * QUARTER_TURN, buildable.cost);
    else this.commands.placeShopCrate(buildable.type, { ...this.cell }, facing * QUARTER_TURN, buildable.cost);
  }

  private clearRubble(pile: RubblePile): void {
    this.commands.clearRubble(pile);
    this.ghost.hide();
  }

  /** Take it down. The refund goes to whoever built it (in multiplayer that may be another player). */
  private remove(structure: Structure): void {
    const refund = refundOf(structure.type);
    const mine = structure.owner === localPlayerId();
    this.setTarget(null);
    this.commands.remove(structure, refund);
    if (mine) this.purse.earn(refund, 'refund');
  }

  private setTarget(structure: Structure | null): void {
    if (structure === this.target) return;
    if (structure) this.highlight.show(structure);
    else this.highlight.hide();
    this.target = structure;
  }

  /** Emit the prompt only when what it says changes. */
  private setPrompt(prompt: BuildPromptEvent): void {
    const key = JSON.stringify(prompt);
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.events.emit('buildPromptChanged', prompt);
  }

  private clearRequests(): void {
    this.wantPlace = false;
    this.wantRemove = false;
    this.turns = 0;
    this.scroll = 0;
  }
}

function nameOf(structure: Structure): string {
  return BUILDABLES.find((b) => b.type === structure.type)?.name ?? '';
}
