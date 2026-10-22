/**
 * Rapier collision layers. Colliders left on the default groups belong to every layer
 * and collide with everything, which is what plain world geometry wants.
 */
export const Layer = {
  WORLD: 1 << 0,
  PLAYER: 1 << 1,
  GRENADE: 1 << 2,
  /** Enemy hitboxes (head and body). Bullets hit them; nothing physical touches them. */
  TARGET: 1 << 3,
  /** Invisible map-edge walls above the berms. They stop bodies but not bullets. */
  BOUNDARY: 1 << 4,
  /** Walker-only colliders (player and enemies): low slabs over wall lips (`Groups.playerStep`) and breached-wall blockers (`Groups.movementBlocker`). */
  PLAYER_STEP: 1 << 5,
  /** Loose debris chunks. They land on the world and each other, and nothing else feels them. */
  DEBRIS: 1 << 6,
  /** Enemy movement capsules. They walk on the world like the player does, but pass through each other. */
  ENEMY: 1 << 7,
} as const;

/** Bodies that walk with a character controller: they share the wall lip step proxies and the breach blockers. */
const WALKERS = Layer.PLAYER | Layer.ENEMY;

const ALL = 0xffff;

/** Pack Rapier interaction groups: upper 16 bits are membership, lower 16 bits are what it interacts with. */
export function interactionGroups(membership: number, filter: number = ALL): number {
  return (((membership & ALL) << 16) | (filter & ALL)) >>> 0;
}

export const Groups = {
  /** The player never touches grenades, so a throw can never hit the thrower. */
  player: interactionGroups(Layer.PLAYER, ALL & ~Layer.GRENADE),
  grenade: interactionGroups(Layer.GRENADE, ALL & ~Layer.PLAYER),
  /**
   * A teammate's body in multiplayer: on the player layer, so enemies see, shoot and bump into it and players
   * cannot walk through each other, while the players' own bullets pass through it (no friendly fire).
   */
  ally: interactionGroups(Layer.PLAYER, ALL & ~Layer.GRENADE),
  /**
   * Enemy movement capsule: stands on the world, steps on the wall lip proxies, bumps the player and the
   * map edge. Enemies pass through each other (they steer apart instead), and ignore grenades and debris.
   */
  enemy: interactionGroups(Layer.ENEMY, Layer.WORLD | Layer.PLAYER | Layer.PLAYER_STEP | Layer.BOUNDARY),
  /** Enemy head and body hitboxes: only ray queries find them; no body ever collides with them. */
  enemyHitbox: interactionGroups(Layer.TARGET, Layer.TARGET),
  boundary: interactionGroups(Layer.BOUNDARY),
  /**
   * Wall lips at full height: world geometry for bullets, grenades and debris, but walkers (the player and
   * enemies) ignore them and walk on their low step proxies instead, so a capsule rides over a lip like a gentle slope.
   */
  wallLip: interactionGroups(Layer.WORLD, ALL & ~WALKERS),
  /** The walker-only step proxy over a wall lip. */
  playerStep: interactionGroups(Layer.PLAYER_STEP, WALKERS),
  /** Stops walkers going through a breached wall's holes; bullets, grenades and debris pass. */
  movementBlocker: interactionGroups(Layer.PLAYER_STEP, WALKERS),
  /** Debris chunks: rest on world geometry and on each other; the player, grenades and bullets ignore them. */
  debris: interactionGroups(Layer.DEBRIS, Layer.WORLD | Layer.DEBRIS),
  /** Bullet ray query: hits world geometry and targets, passes through the player, grenades and boundary. */
  bullet: interactionGroups(ALL, Layer.WORLD | Layer.TARGET),
  /** Query for static world geometry only (ground, rocks, structures). */
  groundQuery: interactionGroups(ALL, Layer.WORLD),
  /** Enemy sight and bullet rays: world geometry and the player. They pass through other enemies and through breach holes. */
  enemySight: interactionGroups(ALL, Layer.WORLD | Layer.PLAYER),
} as const;
