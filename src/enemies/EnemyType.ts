/** Every kind of enemy in the MVP. */
export type EnemyType = 'rifleman' | 'sapper' | 'grenadier' | 'mortar';

/** Every enemy type, in pool order (see EnemyManager). */
export const ENEMY_TYPES: readonly EnemyType[] = ['rifleman', 'sapper', 'grenadier', 'mortar'];

/** Voice lines enemies call out. */
export type EnemyCallout = 'contact' | 'breach' | 'chargeSet' | 'grenade' | 'mortarSetup';
