import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, type Scene } from 'three';
import type { DamageableRegistry } from '../combat/DamageableRegistry';
import type { DamageType } from '../combat/DamageType';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import { damageStateOf, DamageState } from '../destruction/DamageState';
import { RubbleField, type RubblePile } from '../destruction/RubbleField';
import { EdgeState, edgeDirBit, type BuildGrid, type Cell, type Edge } from '../world/BuildGrid';
import type { StructureType } from './Buildables';
import { MgNest } from './MgNest';
import type { Structure } from './Structure';
import { WallJoints } from './WallJoints';
import { WallRenderer } from './WallRenderer';
import { WallSegment } from './WallSegment';
import { WeaponCrate } from './WeaponCrate';

/** Yaw for a wall on an edge: x edges run along +x, z edges along +z. */
export function wallYaw(edge: Edge): number {
  return edge.axis === 'x' ? 0 : -Math.PI / 2;
}

/** How a standing wall's damage state reads on the grid. */
function edgeStateOf(state: DamageState): EdgeState {
  if (state === DamageState.DAMAGED) return EdgeState.DAMAGED;
  if (state === DamageState.BREACHED) return EdgeState.BREACHED;
  return EdgeState.INTACT;
}

/**
 * Owns every player-built structure and the rubble they leave: creates them on the grid (walls on edges,
 * the MG nest on cells), keeps wall joints and their drawing in step, maps colliders back to structures,
 * and is the single place structure HP changes. Hits are scaled by the structure damage multipliers and
 * move walls through their damage states (intact, damaged, breached); at 0 HP a structure collapses into
 * a rubble pile. Keeps the grid's movement state current and reports every change with `navChanged`.
 */
export class StructureManager {
  private readonly structures = new Map<number, Structure>();
  private readonly byCollider = new Map<number, Structure>();
  /** Joint colliders, mapped to the wall that takes their hits. */
  private readonly jointOwners = new Map<number, number>();
  private readonly renderer: WallRenderer;
  private readonly joints: WallJoints;
  private readonly rubble: RubbleField;
  /** The edge the build ghost is showing a wall on, if any. Built walls next to it shape their ends to meet it. */
  private preview: Edge | null = null;
  /** Walls changed since they were last drawn. Many can change in one blast; they are redrawn once, in `update`. */
  private dirty = false;
  private nextId = 1;

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly grid: BuildGrid,
    private readonly registry: DamageableRegistry,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.renderer = new WallRenderer(scene);
    this.rubble = new RubbleField(scene, world);
    this.joints = new WallJoints(world, grid, {
      attach: (collider, wallId) => {
        const wall = this.structures.get(wallId);
        if (!wall) return;
        this.jointOwners.set(collider.handle, wallId);
        this.registry.addHitbox(collider, wall, 'body');
      },
      detach: (collider) => {
        this.jointOwners.delete(collider.handle);
        this.registry.removeHitbox(collider);
      },
    });
  }

  get count(): number {
    return this.structures.size;
  }

  /** Rubble piles on the field. */
  get rubbleCount(): number {
    return this.rubble.count;
  }

  countOf(type: StructureType): number {
    let n = 0;
    for (const s of this.structures.values()) if (s.type === type) n++;
    return n;
  }

  /** The live structure with this id, if any. */
  byId(id: number): Structure | undefined {
    return this.structures.get(id);
  }

  /** The structure a collider belongs to, if any. A wall joint counts as the wall that takes its hits. */
  structureOf(collider: RAPIER.Collider): Structure | undefined {
    const owner = this.jointOwners.get(collider.handle);
    return owner !== undefined ? this.structures.get(owner) : this.byCollider.get(collider.handle);
  }

  /** True for wall segment and wall joint colliders. Walls never block other walls; the grid's edges decide that. */
  isWallCollider(collider: RAPIER.Collider): boolean {
    return this.jointOwners.has(collider.handle) || this.byCollider.get(collider.handle)?.type === 'wall';
  }

  /** The rubble pile a collider belongs to, if any. */
  rubbleOf(collider: RAPIER.Collider): RubblePile | undefined {
    return this.rubble.ofCollider(collider);
  }

  /** True for a wall's rubble pile. A new wall goes straight over these (and clears the one on its own edge). */
  isWallRubbleCollider(collider: RAPIER.Collider): boolean {
    return this.rubble.ofCollider(collider)?.kind === 'wall';
  }

  /** A structure's damage state. The MG nest has none: it stands intact until it collapses. */
  stateOf(structure: Structure): DamageState {
    if (structure instanceof WallSegment) return structure.damageState;
    return structure.isAlive ? DamageState.INTACT : DamageState.COLLAPSED;
  }

  /** The four cells of a 2 x 2 footprint around grid point `anchor`. Writes into `out` and returns it. */
  footprint(anchor: Cell, out: Cell[]): Cell[] {
    out.length = 0;
    for (const dj of [-1, 0]) for (const di of [-1, 0]) out.push({ i: anchor.i + di, j: anchor.j + dj });
    return out;
  }

  /**
   * The build ghost shows a wall on `edge` (or none, for `null`). Built walls meeting it are drawn with
   * the ends they will have once it is built, so they meet the preview flush and never overlap it.
   */
  previewWall(edge: Readonly<Edge> | null): void {
    const p = this.preview;
    if (edge === null ? p === null : p !== null && p.axis === edge.axis && p.i === edge.i && p.j === edge.j) return;
    this.preview = edge && { ...edge };
    this.dirty = true;
  }

  /** Redraw the walls if anything changed. Call once per rendered frame, before drawing. */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const walls: WallSegment[] = [];
    for (const s of this.structures.values()) if (s instanceof WallSegment) walls.push(s);
    const preview = this.preview;
    this.renderer.rebuild(walls, (i, j) => this.grid.wallMaskAt(i, j) | (preview ? edgeDirBit(preview, i, j) : 0));
  }

  /** Build a wall on `edge`, clearing any rubble there. The build tool has already checked the spot and taken the cash. */
  placeWall(edge: Edge, cost: number): Structure {
    const pile = this.rubble.atEdge(edge);
    if (pile) this.clearRubble(pile);
    const id = this.nextId++;
    const base = this.grid.edgeMidpoint(edge, new Vector3());
    const wall = new WallSegment(id, { ...edge }, base, wallYaw(edge), this.world, (s, a, t, f) => this.handleDamage(s, a, t, f));
    this.add(wall, cost);
    if (this.grid.occupyEdge(edge, id)) this.events.emit('navChanged', { edge: { ...edge }, blocked: true });
    this.wallsChanged(edge);
    return wall;
  }

  /** Build the MG nest around grid point `anchor`. The build tool has already checked the spot and taken the cash. */
  placeMgNest(anchor: Cell, yaw: number, cost: number): Structure {
    const id = this.nextId++;
    const cells = this.footprint(anchor, []);
    const base = new Vector3(this.grid.vertexX(anchor.i), 0, this.grid.vertexZ(anchor.j));
    const nest = new MgNest(id, cells, base, yaw, this.scene, this.world, (s, a, t, f) => this.handleDamage(s, a, t, f));
    this.add(nest, cost);
    this.grid.occupy(cells, id, true);
    this.events.emit('navCellsChanged', { cells: cells.map((c) => ({ ...c })), blocked: true });
    return nest;
  }

  /** Put the weapon crate on `cell`. The build tool has already checked the spot and taken the cash. */
  placeWeaponCrate(cell: Cell, yaw: number, cost: number): Structure {
    const id = this.nextId++;
    const base = new Vector3(this.grid.centerX(cell.i), 0, this.grid.centerZ(cell.j));
    const crate = new WeaponCrate(id, { ...cell }, base, yaw, this.scene, this.world);
    this.add(crate, cost);
    this.grid.occupy([cell], id, true);
    this.events.emit('navCellsChanged', { cells: [{ ...cell }], blocked: true });
    return crate;
  }

  /** The player took it down with the build tool. */
  remove(structure: Structure, refund: number): void {
    if (!this.structures.has(structure.id)) return;
    this.dispose(structure, EdgeState.OPEN);
    this.events.emit('structureRemoved', { id: structure.id, type: structure.type, position: structure.base.clone(), refund });
  }

  /** Clear a rubble pile (free, in the build phase, or under a new wall). Its edge or cells stay open. */
  clearRubble(pile: RubblePile): void {
    this.rubble.remove(pile);
    if (pile.edge && this.grid.edgeWall(pile.edge) === 0) this.grid.setEdgeState(pile.edge, EdgeState.OPEN);
    this.events.emit('rubbleCleared', { position: pile.base.clone() });
  }

  /**
   * Restore up to `amount` HP to a damaged structure, rolling its damage state back as it rises. Returns
   * the HP actually restored. Collapsed structures cannot be repaired.
   */
  repair(structure: Structure, amount: number): number {
    if (!structure.isAlive || !this.structures.has(structure.id) || structure.hp >= structure.maxHp) return 0;
    const restored = Math.min(amount, structure.maxHp - structure.hp);
    structure.hp += restored;
    this.updateState(structure);
    if (structure.hp >= structure.maxHp) {
      this.events.emit('structureRepaired', {
        id: structure.id,
        type: structure.type,
        position: structure.base.clone(),
        hp: structure.hp,
        maxHp: structure.maxHp,
      });
    }
    return restored;
  }

  private add(structure: Structure, cost: number): void {
    this.structures.set(structure.id, structure);
    this.register(structure.colliders, structure);
    this.events.emit('structurePlaced', { id: structure.id, type: structure.type, position: structure.base.clone(), cost });
  }

  private register(colliders: readonly RAPIER.Collider[], structure: Structure): void {
    for (const collider of colliders) {
      this.byCollider.set(collider.handle, structure);
      if (structure.damageable) this.registry.addHitbox(collider, structure, 'body');
    }
  }

  private unregister(colliders: readonly RAPIER.Collider[]): void {
    for (const collider of colliders) {
      this.byCollider.delete(collider.handle);
      this.registry.removeHitbox(collider);
    }
  }

  /** Every hit on every structure lands here. */
  private handleDamage(structure: Structure, amount: number, damageType: DamageType, from: Vector3): void {
    const taken = amount * config.destruction.damageMultipliers[damageType];
    if (taken <= 0) return;
    structure.hp = Math.max(0, structure.hp - taken);
    this.events.emit('segmentDamaged', {
      id: structure.id,
      type: structure.type,
      position: from.clone(),
      amount: taken,
      damageType,
      hp: structure.hp,
      maxHp: structure.maxHp,
      source: from.clone(),
    });
    if (structure.hp <= 0) this.collapse(structure, from);
    else this.updateState(structure);
  }

  /** Move a wall to the damage state its HP calls for: new look, new colliders if it opened or closed holes. */
  private updateState(structure: Structure): void {
    if (!(structure instanceof WallSegment)) return;
    const from = structure.damageState;
    const to = damageStateOf(structure.hp, structure.maxHp);
    if (to === from || to === DamageState.COLLAPSED) return;
    // Forget the old colliders before they are replaced: Rapier may hand their handles to the new ones.
    const old = [...structure.colliders];
    if (structure.setDamageState(to)) {
      this.unregister(old);
      this.register(structure.colliders, structure);
    }
    // Damaged and breached walls still block movement, so this never changes navigation.
    this.grid.setEdgeState(structure.edge, edgeStateOf(to));
    this.dirty = true;
    this.events.emit('segmentStateChanged', { id: structure.id, type: structure.type, position: structure.base.clone(), from, to });
  }

  /** Out of HP: the structure goes and a rubble pile takes its place. */
  private collapse(structure: Structure, source: Vector3): void {
    const from = this.stateOf(structure);
    if (structure instanceof WallSegment) structure.setDamageState(DamageState.COLLAPSED);
    this.dispose(structure, EdgeState.RUBBLE);

    if (this.rubble.count >= config.destruction.rubble.maxPiles) {
      const oldest = this.rubble.oldest;
      if (oldest) this.clearRubble(oldest);
    }
    if (structure instanceof WallSegment) this.rubble.addWall(structure.edge, structure.base, structure.yaw, structure.id);
    else this.rubble.addNest(structure.cells, structure.base, structure.yaw, structure.id);

    const position = structure.base.clone();
    this.events.emit('segmentStateChanged', { id: structure.id, type: structure.type, position, from, to: DamageState.COLLAPSED });
    this.events.emit('segmentDestroyed', { id: structure.id, type: structure.type, position, yaw: structure.yaw, source: source.clone() });
  }

  /** Take a structure off the field. A wall's edge is left `left`: open ground, or rubble after a collapse. */
  private dispose(structure: Structure, left: typeof EdgeState.OPEN | typeof EdgeState.RUBBLE): void {
    this.structures.delete(structure.id);
    this.unregister(structure.colliders);
    this.registry.remove(structure, structure.colliders);
    structure.dispose(this.world);
    if (structure instanceof WallSegment) {
      if (this.grid.releaseEdge(structure.edge, left)) this.events.emit('navChanged', { edge: { ...structure.edge }, blocked: false });
      this.wallsChanged(structure.edge);
    } else {
      this.grid.release(structure.cells);
      this.events.emit('navCellsChanged', { cells: structure.cells.map((c) => ({ ...c })), blocked: false });
    }
  }

  /** A wall appeared or went on `edge`: rebuild the joints at both its ends and redraw the walls. */
  private wallsChanged(edge: Edge): void {
    this.joints.refresh([{ i: edge.i, j: edge.j }, this.grid.edgeEnd(edge, { i: 0, j: 0 })]);
    this.dirty = true;
  }
}
