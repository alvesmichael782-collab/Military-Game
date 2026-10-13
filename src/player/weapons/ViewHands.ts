import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec3 as Vector3Like, WeaponHands } from './defs/WeaponDef';

/*
 * First-person hands, as in FPS-Model(2) and FPS-Model(3): dark olive gloves, bare forearms and tan sleeves
 * rolled to the elbow. Each arm is one small mesh built in its own frame: the hand at the origin, the forearm
 * running back along +Z to the elbow. Both are children of the weapon model in hand, so they follow it through
 * recoil, sway and the reload tilt. Sizes are real-world meters; the M4 is about 0.75 m long.
 */

const GLOVE = 0x3e4128;
const GLOVE_DARK = 0x2c2e1c;
const SKIN = 0xb88a64;
const SLEEVE = 0xa08860;
const SLEEVE_ROLL = 0xb59c72;

const tmpColor = new Color();
const tmpMatrix = new Matrix4();
const UP = new Vector3(0, 1, 0);

/** A box or cylinder, placed and painted one color, without UVs so it merges with the rest. */
function piece(g: BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): BufferGeometry {
  const out = g.toNonIndexed();
  g.dispose();
  out.deleteAttribute('uv');
  out.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);
  tmpColor.setHex(color);
  const colors = new Float32Array(out.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([tmpColor.r, tmpColor.g, tmpColor.b], i);
  out.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return out;
}

/**
 * One arm in its own frame: a gloved fist around the origin (knuckles toward -Z, back of the hand toward +X for
 * the right hand), the forearm back along +Z, a rolled sleeve at the elbow. `mirror` builds the left arm.
 */
function armGeometry(mirror: boolean): BufferGeometry {
  const m = mirror ? -1 : 1;
  const parts: BufferGeometry[] = [
    // Palm and back of the hand.
    piece(new BoxGeometry(0.05, 0.085, 0.085), GLOVE, m * 0.012, 0, 0.0),
    // Four curled fingers wrapped round the grip, as a stepped block of knuckles.
    piece(new BoxGeometry(0.03, 0.084, 0.028), GLOVE_DARK, m * -0.018, 0, -0.04),
    piece(new BoxGeometry(0.024, 0.08, 0.026), GLOVE, m * -0.034, 0, -0.018),
    piece(new BoxGeometry(0.052, 0.022, 0.034), GLOVE_DARK, m * 0.004, -0.04, -0.03),
    // Thumb over the top.
    piece(new BoxGeometry(0.026, 0.024, 0.06), GLOVE, m * -0.02, 0.05, -0.012, 0.2, 0, 0),
    // Glove cuff.
    piece(new CylinderGeometry(0.04, 0.042, 0.05, 8), GLOVE_DARK, 0, 0, 0.055, Math.PI / 2),
    // Bare forearm, tapering to the wrist.
    piece(new CylinderGeometry(0.027, 0.036, 0.24, 10), SKIN, 0, 0, 0.19, Math.PI / 2),
    // Rolled sleeve at the elbow and the sleeve beyond.
    piece(new CylinderGeometry(0.05, 0.05, 0.06, 10), SLEEVE_ROLL, 0, 0, 0.33, Math.PI / 2),
    piece(new CylinderGeometry(0.046, 0.052, 0.3, 10), SLEEVE, 0, 0, 0.5, Math.PI / 2),
  ];
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('Arm geometry failed');
  // Fake occlusion: darker toward the elbow, which sits low in the frame, away from the light.
  const pos = merged.getAttribute('position');
  const col = merged.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const shade = 1 - Math.min(1, Math.max(0, (pos.getZ(i) - 0.1) / 0.5)) * 0.35;
    col.setXYZ(i, col.getX(i) * shade, col.getY(i) * shade, col.getZ(i) * shade);
  }
  // Each piece keeps its own normals, so the forearm and sleeve shade round.
  return merged;
}

/**
 * Put an arm's hand at `hand` and turn it so its forearm (+Z) runs along `toElbow`, the back of the hand up, then
 * `roll` radians about the forearm.
 */
function aimArm(arm: Object3D, hand: Vector3Like, toElbow: Vector3Like, roll = 0): void {
  arm.position.set(hand.x, hand.y, hand.z);
  tmpMatrix.lookAt(tmpElbow.set(toElbow.x, toElbow.y, toElbow.z), ORIGIN, UP);
  arm.quaternion.setFromRotationMatrix(tmpMatrix);
  if (roll !== 0) arm.quaternion.multiply(tmpRoll.setFromAxisAngle(Z_AXIS, roll));
}

const ORIGIN = new Vector3();
const Z_AXIS = new Vector3(0, 0, 1);
const tmpElbow = new Vector3();
const tmpRoll = new Quaternion();

/**
 * The two gloved arms, parented to whichever weapon is in hand and placed by its def: the right hand on the grip,
 * the left on the handguard, under the magazine or around the right hand. The reload and knife animations move
 * the left hand through `setLeft`; a weapon without a left-hand placement keeps the left arm out of view.
 */
export class ViewHands {
  private readonly right: Mesh;
  private readonly left: Mesh;
  private hands: WeaponHands | null = null;

  constructor() {
    const material = new MeshLambertMaterial({ vertexColors: true });
    this.right = new Mesh(armGeometry(false), material);
    this.left = new Mesh(armGeometry(true), material);
    this.right.name = 'rightArm';
    this.left.name = 'leftArm';
  }

  /** Move both arms onto `model` (a weapon's model root) and grip it as `hands` says. */
  attach(model: Object3D, hands: WeaponHands): void {
    this.hands = hands;
    model.add(this.right, this.left);
    aimArm(this.right, hands.right.grip, hands.right.elbow, hands.right.roll);
    this.left.visible = hands.left !== undefined;
    this.setLeft(null, null, 0);
  }

  /**
   * Pose the left hand: `blend` 0 is its grip from the def, 1 is at `hand` with its elbow toward `elbow` (model frame).
   * Pass nulls for the plain grip.
   */
  setLeft(hand: Vector3 | null, elbow: Vector3 | null, blend: number): void {
    const grip = this.hands?.left;
    if (!grip) return;
    if (!hand || !elbow || blend <= 0) {
      aimArm(this.left, grip.grip, grip.elbow, grip.roll);
      return;
    }
    tmpHand.set(grip.grip.x, grip.grip.y, grip.grip.z).lerp(hand, blend);
    tmpToElbow.set(grip.elbow.x, grip.elbow.y, grip.elbow.z).lerp(elbow, blend);
    aimArm(this.left, tmpHand, tmpToElbow, (grip.roll ?? 0) * (1 - blend));
  }
}

const tmpHand = new Vector3();
const tmpToElbow = new Vector3();
