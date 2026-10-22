import { Vector3 } from 'three';
import { buildableOf, refundOf, type StructureType } from '../build/Buildables';
import { MgNest } from '../build/MgNest';
import { ShopCrate } from '../build/ShopCrate';
import type { Structure } from '../build/Structure';
import type { StructureCommands } from '../build/StructureCommands';
import type { StructureManager } from '../build/StructureManager';
import { WallSegment } from '../build/WallSegment';
import type { EventBus, GameEvents } from '../core/EventBus';
import { Phase, type GameState } from '../core/GameState';
import type { RubblePile } from '../destruction/RubbleField';
import type { CashWallet } from '../economy/CashWallet';
import type { RepairTargets } from '../player/RepairTool';
import type { BuildGrid, Cell, Edge } from '../world/BuildGrid';
import type { NetSession } from './NetSession';
import { localPlayerId } from './PlayerId';
import type { GameMessage } from './protocol';
import { v3 } from './protocol';

type StructureMessage = Extract<GameMessage, { t: 'build' | 'placed' | 'remove' | 'removed' | 'clear' | 'cleared' | 'repair' | 'hp' | 'cash' }>;

const from = new Vector3();

/**
 * Keeps everyone's structures the same. The host's StructureManager is the real one: clients send what their
 * player builds, removes, clears and repairs as requests, and the host builds it (under the host's ids) and
 * tells everyone, along with every change in HP. HP changes travel as differences, so a client's own repair,
 * applied at once on its machine, never fights the host's numbers.
 *
 * Cash stays with each player: a builder pays on their own machine; a refused build is refunded to them,
 * and taking something down refunds whoever built it.
 */
export class StructureSync {
  /** What this machine's build tool should use. */
  readonly commands: StructureCommands;
  /** What this machine's repair tool should use. */
  readonly repairTargets: RepairTargets;

  constructor(
    private readonly session: NetSession,
    events: EventBus<GameEvents>,
    private readonly structures: StructureManager,
    private readonly grid: BuildGrid,
    private readonly wallet: CashWallet,
    private readonly state: GameState,
  ) {
    const host = session.isHost;
    this.commands = host ? this.hostCommands() : this.clientCommands();
    this.repairTargets = {
      structureOf: (collider) => structures.structureOf(collider),
      repair: (structure, amount) => {
        const restored = structures.repair(structure, amount);
        if (restored > 0) {
          if (host) this.sendHp(structure, restored, null);
          else session.send({ t: 'repair', id: structure.id, a: restored });
        }
        return restored;
      },
    };
    if (!host) return;

    events.on('structurePlaced', ({ id, cost }) => {
      const structure = structures.byId(id);
      if (structure) session.send(placedMessage(structure, cost));
    });
    events.on('structureRemoved', ({ id }) => session.send({ t: 'removed', id }));
    events.on('rubbleCleared', ({ structureId }) => session.send({ t: 'cleared', sid: structureId }));
    events.on('segmentDamaged', ({ id, amount, hp, damageType, source }) => {
      session.send({ t: 'hp', id, d: -amount, hp, ty: damageType, p: v3(source) });
    });
  }

  /** Handle a structure message. Returns false if it was not one. */
  handle(message: GameMessage, sender: string): boolean {
    if (!isStructureMessage(message)) return false;
    if (this.session.isHost) this.handleRequest(message, sender);
    else this.handleUpdate(message);
    return true;
  }

  // ---- Host ----

  private hostCommands(): StructureCommands {
    const s = this.structures;
    return {
      placeWall: (edge, cost) => s.placeWall(edge, cost),
      placeMgNest: (anchor, yaw, cost) => s.placeMgNest(anchor, yaw, cost),
      placeShopCrate: (type, cell, yaw, cost) => s.placeShopCrate(type, cell, yaw, cost),
      remove: (structure, refund) => this.removeFor(structure, refund, localPlayerId()),
      clearRubble: (pile) => s.clearRubble(pile),
    };
  }

  private handleRequest(message: StructureMessage, sender: string): void {
    const s = this.structures;
    switch (message.t) {
      case 'build':
        if (!this.tryBuild(message, sender)) this.pay(sender, message.c);
        break;
      case 'remove': {
        const structure = s.byId(message.id);
        if (structure) this.removeFor(structure, refundOf(structure.type), sender);
        break;
      }
      case 'clear': {
        const pile = s.rubbleOfStructure(message.sid);
        if (pile) s.clearRubble(pile);
        break;
      }
      case 'repair': {
        const structure = s.byId(message.id);
        if (!structure) break;
        const restored = s.repair(structure, message.a);
        if (restored > 0) this.sendHp(structure, restored, sender);
        break;
      }
      default:
        break;
    }
  }

  /** Build what a client asked for, if it still fits (another player may have just built there). */
  private tryBuild(message: Extract<GameMessage, { t: 'build' }>, owner: string): boolean {
    const s = this.structures;
    const g = this.grid;
    if (this.state.phase !== Phase.BUILD) return false;
    const buildable = buildableOf(message.k);
    if (s.countOf(message.k) >= buildable.limit) return false;
    if (message.k === 'wall') {
      const edge = message.e;
      if (!edge || !g.isEdgeInBuildRadius(edge) || !g.isEdgeFree(edge)) return false;
      s.placeWall(edge, message.c, { owner });
      return true;
    }
    const cell = message.cell;
    if (!cell) return false;
    if (message.k === 'mgNest') {
      const cells = s.footprint(cell, []);
      if (cells.some(({ i, j }) => !g.isInBuildRadius(i, j) || !g.isFree(i, j)) || g.wallMaskAt(cell.i, cell.j) !== 0) return false;
      s.placeMgNest(cell, message.y, message.c, { owner });
      return true;
    }
    if (!g.isInBuildRadius(cell.i, cell.j) || !g.isFree(cell.i, cell.j)) return false;
    s.placeShopCrate(message.k, cell, message.y, message.c, { owner });
    return true;
  }

  /** Take a structure down for `remover`. Its builder gets the refund (the remover's machine pays itself if it is theirs). */
  private removeFor(structure: Structure, refund: number, remover: string): void {
    this.structures.remove(structure, refund);
    if (structure.owner !== remover) this.pay(structure.owner, refund);
  }

  /** Cash for `player`: here if it is the host's player, else sent to their machine. */
  private pay(player: string, amount: number): void {
    if (amount <= 0) return;
    if (player === localPlayerId()) this.wallet.earn(amount, 'refund');
    else this.session.sendTo(player, { t: 'cash', a: amount });
  }

  /** Tell the clients (but `except`, who already has it) that a structure gained `delta` HP. */
  private sendHp(structure: Structure, delta: number, except: string | null): void {
    const message: GameMessage = { t: 'hp', id: structure.id, d: delta, hp: structure.hp, ty: 'ballistic', p: v3(structure.base) };
    if (except) this.session.sendExcept(except, message);
    else this.session.send(message);
  }

  // ---- Client ----

  private clientCommands(): StructureCommands {
    const send = (message: GameMessage): void => this.session.send(message);
    return {
      placeWall: (edge: Edge, cost: number) => send({ t: 'build', k: 'wall', e: { ...edge }, y: 0, c: cost }),
      placeMgNest: (anchor: Cell, yaw: number, cost: number) => send({ t: 'build', k: 'mgNest', cell: { ...anchor }, y: yaw, c: cost }),
      placeShopCrate: (type, cell, yaw, cost) => send({ t: 'build', k: type, cell: { ...cell }, y: yaw, c: cost }),
      remove: (structure: Structure) => send({ t: 'remove', id: structure.id }),
      clearRubble: (pile: RubblePile) => send({ t: 'clear', sid: pile.structureId }),
    };
  }

  private handleUpdate(message: StructureMessage): void {
    const s = this.structures;
    switch (message.t) {
      case 'placed': {
        const origin = { id: message.id, owner: message.o };
        if (message.k === 'wall' && message.e) s.placeWall(message.e, message.c, origin);
        else if (message.k === 'mgNest' && message.cell) s.placeMgNest(message.cell, message.y, message.c, origin);
        else if ((message.k === 'weaponCrate' || message.k === 'consumablesCrate') && message.cell) {
          s.placeShopCrate(message.k, message.cell, message.y, message.c, origin);
        }
        break;
      }
      case 'removed': {
        const structure = s.byId(message.id);
        if (structure) s.remove(structure, refundOf(structure.type));
        break;
      }
      case 'cleared': {
        const pile = s.rubbleOfStructure(message.sid);
        if (pile) s.clearRubble(pile);
        break;
      }
      case 'hp': {
        const structure = s.byId(message.id);
        if (!structure) break;
        // The host's collapse is final; otherwise apply the change to what is here.
        const hp = message.hp <= 0 ? 0 : Math.min(structure.maxHp, Math.max(1, structure.hp + message.d));
        from.set(message.p[0], message.p[1], message.p[2]);
        s.syncHp(structure, hp, message.ty, from);
        break;
      }
      case 'cash':
        this.wallet.earn(message.a, 'refund');
        break;
      default:
        break;
    }
  }
}

function isStructureMessage(message: GameMessage): message is StructureMessage {
  switch (message.t) {
    case 'build':
    case 'placed':
    case 'remove':
    case 'removed':
    case 'clear':
    case 'cleared':
    case 'repair':
    case 'hp':
    case 'cash':
      return true;
    default:
      return false;
  }
}

/** How to build `structure` again on another machine. */
function placedMessage(structure: Structure, cost: number): GameMessage {
  const base = { id: structure.id, o: structure.owner, c: cost, y: structure.yaw };
  const type: StructureType = structure.type;
  if (structure instanceof WallSegment) return { t: 'placed', k: type, e: { ...structure.edge }, ...base };
  // The nest's footprint is the four cells around its center point; the last is the one past the point.
  if (structure instanceof MgNest) return { t: 'placed', k: type, cell: { ...structure.cells[3] }, ...base };
  if (structure instanceof ShopCrate) return { t: 'placed', k: type, cell: { ...structure.cells[0] }, ...base };
  return { t: 'placed', k: type, cell: { ...structure.cells[0] }, ...base };
}
