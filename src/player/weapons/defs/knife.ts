import type { MeleeDef } from './WeaponDef';

/**
 * Butterfly knife. Tap the attack button to slash (alternating right-to-left and left-to-right), hold it to stab.
 * A slash kills a sapper and takes a rifleman to half; a stab kills either. Walls barely notice it
 * (`config.destruction.damageMultipliers.melee`).
 */
export const knife: MeleeDef = {
  id: 'knife',
  displayName: 'KNIFE',
  slot: 'melee',
  category: 'melee',
  price: 150,
  moveSpeedMultiplier: 1.1,
  range: 2,
  headshotMultiplier: 1,
  stabHoldTime: 0.15,
  slash: { damage: 55, duration: 0.5, hitTime: 0.14, arc: 30 },
  stab: { damage: 110, duration: 0.8, hitTime: 0.22, arc: 8 },
  view: {
    model: 'knife',
    // Low on the right, blade forward and up toward the crosshair.
    position: { x: 0.14, y: -0.13, z: -0.37 },
    rotation: { x: 0.3, y: 0.3, z: -0.45 },
    holsterTime: 0.14,
    drawTime: 0.28,
    sprintDrop: 0.02,
    sprintPitch: -0.2,
    sprintYaw: 0.1,
    idleSway: 0.0025,
    idleRate: 0.4,
  },
  hands: {
    right: { grip: { x: 0, y: 0, z: 0.075 }, elbow: { x: 0.1, y: -0.14, z: 0.27 }, roll: 1.4 },
  },
  sounds: {
    slash: 'weapon.knife.slash',
    stab: 'weapon.knife.stab',
    hitBody: 'weapon.knife.hitBody',
    hitHard: 'weapon.knife.hitHard',
    equip: 'weapon.knife.equip',
  },
};
