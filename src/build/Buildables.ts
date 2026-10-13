import { config } from '../core/config';

export type StructureType = 'wall' | 'mgNest' | 'weaponCrate';

/** Something the build tool can place. */
export interface Buildable {
  readonly type: StructureType;
  /** Name shown near the crosshair. */
  readonly name: string;
  readonly cost: number;
  /** Most that may exist at once. */
  readonly limit: number;
}

/** Everything placeable, in cycling order. */
export const BUILDABLES: readonly Buildable[] = [
  /** Stands on a grid edge. */
  { type: 'wall', name: 'WALL', cost: config.economy.prices.wall, limit: config.build.maxWalls },
  /** Covers the 2 x 2 cells around a grid point. */
  { type: 'mgNest', name: 'MG NEST', cost: config.economy.prices.mgNest, limit: config.build.maxMgNests },
  /** Covers one cell. A temporary shop for weapons (see economy/WeaponShop.ts). */
  { type: 'weaponCrate', name: 'WEAPON CRATE', cost: config.economy.prices.weaponCrate, limit: config.build.maxWeaponCrates },
];

export function buildableOf(type: StructureType): Buildable {
  const found = BUILDABLES.find((b) => b.type === type);
  if (!found) throw new Error(`Unknown structure type ${type}`);
  return found;
}

/** What removing a structure of this type gives back. */
export function refundOf(type: StructureType): number {
  return Math.floor(buildableOf(type).cost * config.economy.refundFraction);
}
