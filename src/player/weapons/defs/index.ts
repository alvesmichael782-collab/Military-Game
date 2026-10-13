import type { GunDef, MeleeDef, WeaponDef } from './WeaponDef';

/** Every def file in this folder, found at build time, so a new weapon needs no registration. */
const modules = import.meta.glob<Record<string, unknown>>(['./*.ts', '!./index.ts', '!./WeaponDef.ts'], { eager: true });

function isWeaponDef(value: unknown): value is WeaponDef {
  return typeof value === 'object' && value !== null && 'id' in value && 'slot' in value && 'view' in value;
}

/** All weapons, cheapest first: the order the weapon crate cycles through them. */
export const WEAPON_DEFS: readonly WeaponDef[] = Object.values(modules)
  .flatMap((module) => Object.values(module).filter(isWeaponDef))
  .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));

export function weaponDef(id: string): WeaponDef {
  const def = WEAPON_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`No weapon def "${id}" in src/player/weapons/defs/`);
  return def;
}

export function isGunDef(def: WeaponDef): def is GunDef {
  return def.slot === 'gun';
}

export function isMeleeDef(def: WeaponDef): def is MeleeDef {
  return def.slot === 'melee';
}
