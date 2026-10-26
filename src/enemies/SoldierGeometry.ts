import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Low-poly soldiers for the enemy faction, after the soldiers in FPS-Model.jpg and FPS-Model(2).jpeg: a helmet
 * with a cloth cover, a scrim band and a chinstrap; web gear with ammo pouches, a canteen and a small pack; sleeves
 * rolled above the elbow over bare forearms; dark gloves; trousers bloused into tall boots; and a fictional rifle
 * with a sling. No flags or insignia.
 *
 * Every part is built around its joint (limbs hang down -Y from it) and faces +Z. Colors are baked into vertex
 * colors, darkened toward each part's lower end as fake ambient occlusion. Cloth that belongs to the uniform is
 * painted in neutral shades and flagged in the `uniformMask` attribute: the renderer tints only those vertices
 * with each soldier's instance color, so one set of meshes draws both uniform variants.
 */

/** Uniform colors, applied per soldier through the instance color. */
export const UNIFORM_COLORS = {
  tan: 0x9a845e,
  olive: 0x5f6444,
  /** Sappers: a darker gray-brown, to set them further apart from the riflemen. */
  sapper: 0x6c665a,
} as const;

/** Name of the per-vertex attribute marking uniform cloth (1) against everything else (0). */
export const UNIFORM_MASK = 'uniformMask';

// Neutral shades for uniform cloth (multiplied by the uniform color): shirt, trousers, the helmet cover, pocket flaps.
const SHIRT = 0xffffff;
const TROUSERS = 0xe4e0d8;
const COVER = 0xd8d2c4;
const FLAP = 0xbcb6aa;
const ROLL = 0xf2eee6;
// Fixed colors for the kit and the soldier.
const WEB = 0x4c4d30;
const WEB_DARK = 0x393a22;
const SCRIM = 0x3a3a26;
const SKIN = 0xae8058;
const SKIN_DARK = 0x7c573a;
const SHADOW = 0x261c15;
const GLOVE = 0x24211e;
const BOOT = 0x2a2119;
const SOLE = 0x18130f;
const METAL = 0x262725;
const WOOD = 0x5e3e22;
const SLING = 0x4a432c;
const CANVAS = 0x76663f;
const STRAP = 0xa48d5e;
const RED = 0xd41e12;
// Grenadier and mortar kit.
const BANDOLIER = 0xd6b676;
const BANDOLIER_DARK = 0x9c8350;
const FRAG = 0x47562a;
const FRAG_CAP = 0x8a8d80;
const TUBE = 0x3b4130;
const TUBE_DARK = 0x2a2e22;
const PLATE = 0x45463f;
const CRATE = 0x6a5232;
const CRATE_DARK = 0x4a3820;
const SHELL = 0x56603c;

/** Joint layout shared by the rig and the geometry, in meters. Feet at y = 0, front is +Z, the soldier's right is -X. */
export const SOLDIER = {
  hipHeight: 0.95,
  /** Waist pivot above the hips. */
  waist: 0.08,
  /** Neck pivot above the waist. */
  neck: 0.5,
  shoulderX: 0.2,
  shoulderY: 0.44,
  upperArm: 0.3,
  /** Elbow to the middle of the glove. */
  forearm: 0.31,
  hipX: 0.1,
  thigh: 0.45,
  shin: 0.47,
  /** Rifle grip and handguard (left hand), and the muzzle, in the rifle's own frame (barrel along +Z). */
  rifleGrip: new Vector3(0, -0.06, 0),
  rifleHandguard: new Vector3(0, -0.02, 0.24),
  rifleMuzzle: new Vector3(0, 0.03, 0.66),
  /** The pistol's muzzle, and a grenade held in the right hand, in the right forearm's frame (the hand points along -Y). */
  pistolMuzzle: new Vector3(0, -0.43, 0.05),
  handGrenade: new Vector3(0, -0.32, 0.045),
  /** The set-up mortar's muzzle, in the ground frame under the kneeling soldier (front is +Z). */
  mortarMuzzle: new Vector3(0, 0.66, 1.2),
} as const;

const tmpColor = new Color();
const matrix = new Matrix4();
const turn = new Euler();

interface PieceOptions {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  /** Stretch before turning, e.g. to make a round cylinder oval. */
  sx?: number;
  sy?: number;
  sz?: number;
  /** Uniform cloth: tinted by the soldier's uniform color. */
  cloth?: boolean;
}

/** Move a non-indexed geometry into place and give it one flat vertex color and its uniform flag. */
function place(g: BufferGeometry, color: number, o: PieceOptions): BufferGeometry {
  g.scale(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  matrix.makeRotationFromEuler(turn.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0));
  matrix.setPosition(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  g.applyMatrix4(matrix);
  tmpColor.setHex(color);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.setAttribute(UNIFORM_MASK, new Float32BufferAttribute(new Float32Array(count).fill(o.cloth ? 1 : 0), 1));
  return g;
}

/** Non-indexed copy without UVs, so every piece merges with every other. */
function flat(geometry: BufferGeometry): BufferGeometry {
  const g = geometry.toNonIndexed();
  g.deleteAttribute('uv');
  geometry.dispose();
  return g;
}

function box(w: number, h: number, d: number, color: number, o: PieceOptions = {}): BufferGeometry {
  return place(flat(new BoxGeometry(w, h, d)), color, o);
}

/** A cylinder, oval if `sx`/`sz` are given, so limbs and the chest read round rather than boxy. */
function tube(rTop: number, rBottom: number, h: number, sides: number, color: number, o: PieceOptions = {}): BufferGeometry {
  return place(flat(new CylinderGeometry(rTop, rBottom, h, sides)), color, o);
}

/**
 * Merge pieces into one part and darken its vertices toward the part's lowest point (fake AO).
 * `aoTop`/`aoBottom` are the heights, in the part's frame, where the shading runs from full to `aoDark`.
 */
function part(pieces: BufferGeometry[], aoBottom: number, aoTop: number, aoDark = 0.72): BufferGeometry {
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('Soldier part merge failed');
  const pos = merged.getAttribute('position');
  const col = merged.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - aoBottom) / (aoTop - aoBottom)));
    const shade = aoDark + (1 - aoDark) * t;
    col.setXYZ(i, col.getX(i) * shade, col.getY(i) * shade, col.getZ(i) * shade);
  }
  merged.computeVertexNormals();
  return merged;
}

export interface SoldierGeometries {
  pelvis: BufferGeometry;
  torso: BufferGeometry;
  head: BufferGeometry;
  upperArm: BufferGeometry;
  forearm: BufferGeometry;
  thigh: BufferGeometry;
  shin: BufferGeometry;
  rifle: BufferGeometry;
  /** Sapper extras: the satchel charge on the chest (torso frame) and the red helmet band (head frame). */
  satchel: BufferGeometry;
  band: BufferGeometry;
  /** Grenadier extras: the crossed bandoliers of frags on the chest (torso frame), the grenade pouches on the belt (pelvis frame), and a frag in the right hand (forearm frame). */
  bandolier: BufferGeometry;
  pouches: BufferGeometry;
  handGrenade: BufferGeometry;
  /** Mortar team extras: the mortar carried on the back (torso frame), the mortar set up with its ammo crate (ground frame), and the pistol (right forearm frame). */
  mortarPack: BufferGeometry;
  mortar: BufferGeometry;
  pistol: BufferGeometry;
}

/** A helmet shell: the top of a sphere, stretched front to back, sitting on `y`. */
function helmetShell(radius: number, y: number, color: number, cloth: boolean): BufferGeometry {
  const g = flat(new SphereGeometry(radius, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2));
  return place(g, color, { y, sy: 0.82, sz: 1.1, cloth });
}

export function createSoldierGeometries(): SoldierGeometries {
  const s = SOLDIER;

  // Hips: trousers, the belt with its buckle, pouches on both hips and a bayonet frog on the left.
  const pelvis = part([
    tube(0.17, 0.165, 0.22, 8, TROUSERS, { y: -0.02, sz: 0.68, cloth: true }),
    tube(0.178, 0.178, 0.06, 8, WEB, { y: 0.08, sz: 0.7 }),
    box(0.05, 0.045, 0.02, METAL, { y: 0.08, z: 0.125 }),
    box(0.09, 0.11, 0.07, WEB_DARK, { x: 0.155, y: 0.02, z: 0.06 }),
    box(0.09, 0.11, 0.07, WEB_DARK, { x: -0.155, y: 0.02, z: 0.06 }),
    box(0.04, 0.2, 0.03, WEB_DARK, { x: 0.17, y: -0.04, z: -0.06, rz: 0.1 }),
    cylinderCanteen(-0.15, 0.0, -0.08),
  ], -0.13, 0.1, 0.78);

  // Chest from the waist up: shirt with pocket flaps and a collar, the Y-harness, three magazine pouches on the
  // belt line, a grenade on the strap, and a small pack with a rolled blanket on the back.
  const torso = part([
    tube(0.215, 0.18, 0.46, 8, SHIRT, { y: 0.24, sz: 0.62, cloth: true }),
    tube(0.18, 0.17, 0.1, 8, SHIRT, { y: 0.02, sz: 0.66, cloth: true }),
    box(0.46, 0.08, 0.16, SHIRT, { y: 0.45, cloth: true }),
    box(0.09, 0.05, 0.02, FLAP, { x: 0.09, y: 0.37, z: 0.125, cloth: true }),
    box(0.09, 0.05, 0.02, FLAP, { x: -0.09, y: 0.37, z: 0.125, cloth: true }),
    box(0.14, 0.05, 0.13, FLAP, { y: 0.5, z: -0.01, cloth: true }),
    // Harness straps over the shoulders, crossing on the back.
    box(0.055, 0.46, 0.02, WEB, { x: 0.1, y: 0.25, z: 0.13, rz: -0.08 }),
    box(0.055, 0.46, 0.02, WEB, { x: -0.1, y: 0.25, z: 0.13, rz: 0.08 }),
    box(0.055, 0.5, 0.02, WEB, { y: 0.25, z: -0.13, rz: 0.45 }),
    box(0.055, 0.5, 0.02, WEB, { y: 0.25, z: -0.13, rz: -0.45 }),
    box(0.055, 0.03, 0.27, WEB, { x: 0.12, y: 0.47, rx: 0 }),
    box(0.055, 0.03, 0.27, WEB, { x: -0.12, y: 0.47 }),
    // Pouches with flaps.
    box(0.1, 0.11, 0.065, WEB_DARK, { x: 0.11, y: 0.1, z: 0.13 }),
    box(0.1, 0.11, 0.065, WEB_DARK, { x: -0.11, y: 0.1, z: 0.13 }),
    box(0.1, 0.11, 0.065, WEB_DARK, { x: 0, y: 0.1, z: 0.135 }),
    box(0.105, 0.035, 0.07, WEB, { x: 0.11, y: 0.165, z: 0.135 }),
    box(0.105, 0.035, 0.07, WEB, { x: -0.11, y: 0.165, z: 0.135 }),
    box(0.105, 0.035, 0.07, WEB, { x: 0, y: 0.165, z: 0.14 }),
    tube(0.035, 0.035, 0.09, 6, 0x3e4430, { x: -0.1, y: 0.31, z: 0.155 }),
    // Pack, blanket roll and neck.
    box(0.27, 0.25, 0.1, WEB, { y: 0.25, z: -0.17 }),
    box(0.25, 0.06, 0.02, WEB_DARK, { y: 0.33, z: -0.225 }),
    tube(0.055, 0.055, 0.32, 6, 0x5a5a40, { y: 0.41, z: -0.17, rz: Math.PI / 2 }),
    tube(0.055, 0.06, 0.08, 6, SKIN, { y: 0.5 }),
  ], -0.04, 0.4, 0.7);

  // Head from the neck: face with brow, nose and jaw, ears; the helmet in its cloth cover, with a dark scrim band
  // and tufts, and the chinstrap down both cheeks and under the jaw.
  const head = part([
    tube(0.05, 0.055, 0.08, 6, SKIN, { y: 0.03 }),
    box(0.17, 0.2, 0.19, SKIN, { y: 0.14 }),
    box(0.15, 0.06, 0.15, SKIN_DARK, { y: 0.05, z: 0.015 }),
    box(0.16, 0.035, 0.02, SHADOW, { y: 0.165, z: 0.096 }),
    box(0.04, 0.05, 0.035, SKIN, { y: 0.125, z: 0.105 }),
    box(0.06, 0.02, 0.02, SHADOW, { y: 0.07, z: 0.096 }),
    box(0.02, 0.05, 0.04, SKIN_DARK, { x: 0.094, y: 0.14 }),
    box(0.02, 0.05, 0.04, SKIN_DARK, { x: -0.094, y: 0.14 }),
    helmetShell(0.162, 0.19, COVER, true),
    tube(0.182, 0.186, 0.025, 12, COVER, { y: 0.19, sz: 1.08, cloth: true }),
    tube(0.166, 0.17, 0.035, 12, SCRIM, { y: 0.225, sz: 1.08 }),
    box(0.04, 0.05, 0.03, SCRIM, { x: 0.08, y: 0.3, z: 0.06, rz: 0.4 }),
    box(0.035, 0.05, 0.03, SCRIM, { x: -0.06, y: 0.31, z: -0.06, rz: -0.5 }),
    box(0.012, 0.13, 0.015, WEB_DARK, { x: 0.088, y: 0.12, z: 0.03 }),
    box(0.012, 0.13, 0.015, WEB_DARK, { x: -0.088, y: 0.12, z: 0.03 }),
    box(0.17, 0.012, 0.03, WEB_DARK, { y: 0.06, z: 0.05 }),
  ], 0.0, 0.25, 0.8);

  // Bright red cloth band around the sapper's helmet, over the scrim band, with two tails at the back.
  const band = part([
    tube(0.172, 0.176, 0.05, 12, RED, { y: 0.23, sz: 1.08 }),
    box(0.04, 0.13, 0.015, RED, { x: 0.03, y: 0.18, z: -0.18, rx: 0.3 }),
    box(0.04, 0.11, 0.015, RED, { x: -0.03, y: 0.18, z: -0.185, rx: 0.4 }),
  ], 0.1, 0.25, 0.9);

  // A large satchel charge on the chest, over the harness: canvas bag, straps, and a detonator with a red cap.
  const satchel = part([
    box(0.36, 0.3, 0.16, CANVAS, { y: 0.2, z: 0.23 }),
    box(0.38, 0.04, 0.17, STRAP, { y: 0.27, z: 0.23 }),
    box(0.04, 0.32, 0.17, STRAP, { x: 0.1, y: 0.2, z: 0.23 }),
    box(0.04, 0.32, 0.17, STRAP, { x: -0.1, y: 0.2, z: 0.23 }),
    box(0.06, 0.5, 0.02, STRAP, { x: 0.12, y: 0.32, z: 0.15, rz: -0.3 }),
    box(0.09, 0.07, 0.06, METAL, { x: -0.12, y: 0.38, z: 0.26 }),
    box(0.03, 0.03, 0.03, RED, { x: -0.12, y: 0.43, z: 0.26 }),
  ], 0.04, 0.36, 0.75);

  // Upper arm: the sleeve, rolled up above the elbow into a thick cuff.
  const upperArm = part([
    tube(0.068, 0.058, 0.22, 7, SHIRT, { y: -0.1, cloth: true }),
    tube(0.075, 0.07, 0.07, 7, SHIRT, { y: -0.02, cloth: true }),
    tube(0.066, 0.066, 0.06, 7, ROLL, { y: -0.22, cloth: true }),
    tube(0.05, 0.048, 0.06, 6, SKIN, { y: -0.27 }),
  ], -0.3, 0.0, 0.8);

  // Forearm: bare, tapering to the wrist, into a dark glove with the fingers curled.
  const forearm = part([
    tube(0.047, 0.036, 0.22, 6, SKIN, { y: -0.11 }),
    tube(0.04, 0.04, 0.04, 6, GLOVE, { y: -0.225 }),
    box(0.075, 0.09, 0.085, GLOVE, { y: -s.forearm + 0.02 }),
    box(0.06, 0.05, 0.03, GLOVE, { y: -s.forearm - 0.02, z: 0.03 }),
    box(0.025, 0.05, 0.03, GLOVE, { x: 0.035, y: -s.forearm + 0.03, z: 0.04, rz: 0.4 }),
  ], -0.36, 0.0, 0.8);

  // Thigh: trouser leg with a cargo pocket and a knee crease.
  const thigh = part([
    tube(0.09, 0.07, 0.46, 7, TROUSERS, { y: -0.22, sz: 1.05, cloth: true }),
    box(0.04, 0.13, 0.11, FLAP, { x: 0.085, y: -0.22, z: 0.01, cloth: true }),
    box(0.045, 0.03, 0.12, TROUSERS, { x: 0.088, y: -0.15, z: 0.01, cloth: true }),
  ], -0.45, 0.0, 0.78);

  // Shin: trouser leg bloused into a tall laced boot, with a thick sole.
  const shin = part([
    tube(0.068, 0.062, 0.26, 7, TROUSERS, { y: -0.12, cloth: true }),
    tube(0.072, 0.072, 0.05, 7, TROUSERS, { y: -0.25, cloth: true }),
    tube(0.066, 0.064, 0.17, 7, BOOT, { y: -0.34 }),
    box(0.12, 0.09, 0.25, BOOT, { y: -0.42, z: 0.045 }),
    box(0.125, 0.03, 0.27, SOLE, { y: -0.455, z: 0.045 }),
    box(0.08, 0.012, 0.08, SOLE, { y: -0.37, z: 0.11, rx: 0.4 }),
  ], -0.47, -0.05, 0.62);

  // A fictional battle rifle: dark receiver, curved magazine, wooden stock and handguard, front and rear sight,
  // and a slack sling from the front swivel under the stock.
  const rifle = part([
    box(0.06, 0.1, 0.4, METAL, { y: 0.0, z: 0.08 }),
    box(0.05, 0.11, 0.26, WOOD, { y: -0.02, z: -0.22 }),
    box(0.055, 0.15, 0.04, WOOD, { y: -0.06, z: -0.345 }),
    box(0.04, 0.12, 0.05, METAL, { y: -0.08, z: 0.0, rx: 0.25 }),
    box(0.045, 0.17, 0.07, METAL, { y: -0.13, z: 0.15, rx: -0.3 }),
    box(0.065, 0.07, 0.2, WOOD, { y: 0.0, z: 0.34 }),
    tube(0.015, 0.015, 0.24, 6, METAL, { y: 0.02, z: 0.54, rx: Math.PI / 2 }),
    box(0.015, 0.05, 0.02, METAL, { y: 0.06, z: 0.58 }),
    box(0.03, 0.04, 0.05, METAL, { y: 0.07, z: -0.02 }),
    box(0.012, 0.03, 0.08, METAL, { x: 0.035, y: 0.03, z: 0.1 }),
    box(0.012, 0.015, 0.36, SLING, { y: -0.1, z: 0.06, rx: -0.12 }),
    box(0.012, 0.015, 0.26, SLING, { y: -0.12, z: -0.22, rx: 0.18 }),
  ], -0.2, 0.06, 0.85);

  // Two wide tan bandoliers crossed over the chest and back, with frags clipped high on the chest where the rifle
  // never covers them: a bright X and a row of bumps that read from far off.
  const bandolier = part([
    ...[1, -1].flatMap((side) => [
      box(0.095, 0.6, 0.024, BANDOLIER, { y: 0.25, z: 0.165 + (side > 0 ? 0.004 : 0), rz: 0.62 * side }),
      box(0.095, 0.6, 0.024, BANDOLIER, { y: 0.25, z: -0.236, rz: -0.62 * side }),
      box(0.08, 0.03, 0.42, BANDOLIER, { x: -0.13 * side, y: 0.478 }),
      box(0.084, 0.012, 0.026, BANDOLIER_DARK, { y: 0.25, z: 0.179 + (side > 0 ? 0.004 : 0), rz: 0.62 * side }),
      ...[0.13, 0.31].flatMap((t) => frag(side * (-0.17 + 0.34 * t), 0.45 - 0.42 * t, 0.205)),
    ]),
  ], -0.02, 0.45, 0.82);

  // Two tan grenade pouches either side of the buckle, each with a frag's cap showing over the flap.
  const pouches = part([
    ...[-0.075, 0.075].flatMap((x) => [
      box(0.075, 0.085, 0.06, BANDOLIER, { x, y: 0.02, z: 0.142 }),
      box(0.08, 0.025, 0.065, BANDOLIER_DARK, { x, y: 0.068, z: 0.142 }),
      tube(0.022, 0.022, 0.035, 6, FRAG_CAP, { x, y: 0.095, z: 0.142 }),
    ]),
    box(0.075, 0.085, 0.06, BANDOLIER, { x: 0.16, y: 0.02, z: -0.06, ry: Math.PI / 2 }),
    box(0.075, 0.085, 0.06, BANDOLIER, { x: -0.16, y: 0.02, z: -0.06, ry: Math.PI / 2 }),
  ], -0.03, 0.1, 0.8);

  // A frag in the right hand, a little bigger than life so the wind-up reads.
  const handGrenade = part(frag(0, SOLDIER.handGrenade.y, SOLDIER.handGrenade.z, 1.25), -0.36, -0.28, 0.85);

  // The mortar on the back for the march: the tube across the pack, its folded bipod beside it and the round
  // baseplate strapped flat over the pack.
  const mortarPack = part([
    tube(0.048, 0.048, 0.78, 8, TUBE, { x: 0.02, y: 0.3, z: -0.27, rz: -0.42 }),
    tube(0.056, 0.056, 0.05, 8, TUBE_DARK, { x: -0.13, y: 0.65, z: -0.27, rz: -0.42 }),
    box(0.02, 0.5, 0.02, TUBE_DARK, { x: 0.09, y: 0.27, z: -0.31, rz: -0.36 }),
    box(0.02, 0.5, 0.02, TUBE_DARK, { x: 0.12, y: 0.26, z: -0.3, rz: -0.32 }),
    tube(0.17, 0.17, 0.03, 8, PLATE, { y: 0.22, z: -0.235, rx: Math.PI / 2 }),
    box(0.3, 0.04, 0.025, WEB_DARK, { y: 0.3, z: -0.25 }),
  ], -0.05, 0.55, 0.78);

  // The mortar set up in front of the kneeling soldier: baseplate, tube at about 45 degrees, bipod legs and the
  // traversing screw, and an open ammo crate at its side with two rounds on top.
  const mortarSet = part([
    tube(0.21, 0.23, 0.05, 8, PLATE, { y: 0.025, z: 0.62 }),
    box(0.1, 0.06, 0.1, TUBE_DARK, { y: 0.07, z: 0.62 }),
    tube(0.052, 0.052, 0.8, 8, TUBE, { y: 0.08 + 0.4 * Math.SQRT1_2, z: 0.62 + 0.4 * Math.SQRT1_2, rx: Math.PI / 4 }),
    tube(0.062, 0.062, 0.06, 8, TUBE_DARK, { y: 0.08 + 0.78 * Math.SQRT1_2, z: 0.62 + 0.78 * Math.SQRT1_2, rx: Math.PI / 4 }),
    box(0.025, 0.56, 0.025, TUBE_DARK, { x: 0.13, y: 0.24, z: 1.06, rz: 0.42, rx: -0.12 }),
    box(0.025, 0.56, 0.025, TUBE_DARK, { x: -0.13, y: 0.24, z: 1.06, rz: -0.42, rx: -0.12 }),
    box(0.3, 0.025, 0.03, TUBE_DARK, { y: 0.32, z: 1.04 }),
    box(0.05, 0.03, 0.05, TUBE_DARK, { x: 0.25, y: 0.015, z: 1.08 }),
    box(0.05, 0.03, 0.05, TUBE_DARK, { x: -0.25, y: 0.015, z: 1.08 }),
    box(0.38, 0.2, 0.26, CRATE, { x: 0.55, y: 0.1, z: 0.3, ry: 0.25 }),
    box(0.4, 0.03, 0.04, CRATE_DARK, { x: 0.55, y: 0.17, z: 0.3, ry: 0.25 }),
    box(0.06, 0.03, 0.27, CRATE_DARK, { x: 0.55, y: 0.205, z: 0.3, ry: 0.25 }),
    tube(0.04, 0.04, 0.3, 6, SHELL, { x: 0.5, y: 0.245, z: 0.25, ry: 0.25, rz: Math.PI / 2 }),
    tube(0.04, 0.04, 0.3, 6, SHELL, { x: 0.58, y: 0.245, z: 0.35, ry: 0.25, rz: Math.PI / 2 }),
  ], 0.0, 0.5, 0.75);

  // A dark service pistol in the right hand: slide along the pointing direction, the grip below the wrist.
  const pistol = part([
    box(0.032, 0.19, 0.04, METAL, { y: -0.34, z: 0.05 }),
    box(0.028, 0.04, 0.1, METAL, { y: -0.29, z: 0.0, rx: -0.25 }),
    box(0.01, 0.03, 0.03, METAL, { y: -0.31, z: 0.015 }),
  ], -0.44, -0.27, 0.85);

  return {
    pelvis, torso, head, upperArm, forearm, thigh, shin, rifle, satchel, band,
    bandolier, pouches, handGrenade, mortarPack, mortar: mortarSet, pistol,
  };
}

/** A frag grenade standing at (x, y, z): an olive body and a fuse cap with its spoon. */
function frag(x: number, y: number, z: number, size = 1): BufferGeometry[] {
  return [
    tube(0.03 * size, 0.032 * size, 0.07 * size, 6, FRAG, { x, y, z }),
    tube(0.016 * size, 0.018 * size, 0.025 * size, 5, FRAG_CAP, { x, y: y + 0.045 * size, z }),
    box(0.012 * size, 0.05 * size, 0.012 * size, FRAG_CAP, { x: x + 0.025 * size, y: y + 0.02 * size, z }),
  ];
}

/** A canteen in its cover, hanging off the belt. */
function cylinderCanteen(x: number, y: number, z: number): BufferGeometry {
  return tube(0.048, 0.048, 0.13, 7, 0x3e4430, { x, y, z, sz: 0.7 });
}
