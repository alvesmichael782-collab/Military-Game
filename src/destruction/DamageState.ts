import { config } from '../core/config';

/** How broken a structure is. Walls show all four; the MG nest is only ever intact or collapsed. */
export const DamageState = {
  INTACT: 'intact',
  DAMAGED: 'damaged',
  BREACHED: 'breached',
  COLLAPSED: 'collapsed',
} as const;
export type DamageState = (typeof DamageState)[keyof typeof DamageState];

/** Damage looks per state (crack and hole layouts). A wall picks one from its id. */
export const DAMAGE_VARIANTS = 3;

/** The damage state for `hp` out of `maxHp`, by the thresholds in config. */
export function damageStateOf(hp: number, maxHp: number): DamageState {
  if (hp <= 0) return DamageState.COLLAPSED;
  const t = config.destruction.thresholds;
  const fraction = hp / maxHp;
  if (fraction <= t.breached) return DamageState.BREACHED;
  if (fraction <= t.damaged) return DamageState.DAMAGED;
  return DamageState.INTACT;
}

/** Which of the `DAMAGE_VARIANTS` looks a structure uses in `state`: fixed per id, and different per state. */
export function damageVariantOf(id: number, state: DamageState): number {
  let h = Math.imul(id + 1, 0x9e3779b1) ^ (state === DamageState.BREACHED ? 0x5bd1e995 : 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) % DAMAGE_VARIANTS;
}
