import type { RubblePile } from '../destruction/RubbleField';
import type { Cell, Edge } from '../world/BuildGrid';
import type { ShopCrateType } from './ShopCrate';
import type { Structure } from './Structure';

/**
 * What the build tool asks for. In single player (and on a multiplayer host) the StructureManager does it
 * at once; a multiplayer client sends each request to the host, which builds it for everyone.
 * The build tool has already checked the spot and taken the cash.
 */
export interface StructureCommands {
  placeWall(edge: Edge, cost: number): void;
  placeMgNest(anchor: Cell, yaw: number, cost: number): void;
  placeShopCrate(type: ShopCrateType, cell: Cell, yaw: number, cost: number): void;
  /** Take it down. Its builder gets `refund`. */
  remove(structure: Structure, refund: number): void;
  clearRubble(pile: RubblePile): void;
}
