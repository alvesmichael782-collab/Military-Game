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
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * First-person hands for the rifle, as in FPS-Model(2) and FPS-Model(3): dark olive gloves, bare forearms and
 * tan sleeves rolled to the elbow. Each arm is one small mesh built in its own frame: the hand at the origin,
 * the forearm running back along +Z to the elbow. Both are children of the rifle model, so they follow it
 * through recoil, sway and the reload tilt. Sizes are real-world meters; the rifle is about 0.75 m long.
 */

const GLOVE = 0x3e4128;
const GLOVE_DARK = 0x2c2e1c;
const SKIN = 0xb88a64;
const SLEEVE = 0xa08860;
const SLEEVE_ROLL = 0xb59c72;

/** Where the hands hold the rifle, in the rifle model's frame (barrel along -Z, centered on its bounding box). */
const RIGHT_GRIP = new Vector3(0.004, -0.03, 0.172);
const LEFT_GRIP = new Vector3(-0.004, 0.044, -0.115);
/** Where each elbow is from its hand, which sets which way the forearm runs. */
const RIGHT_ELBOW = new Vector3(0.146, -0.17, 0.258);
const LEFT_ELBOW = new Vector3(-0.1, -0.33, 0.21);
/** The left hand on the magazine during a reload: offset from the magazine's top center (its pivot), and its elbow. */
const LEFT_ON_MAG = new Vector3(-0.02, -0.075, 0.0);
const LEFT_ON_MAG_ELBOW = new Vector3(-0.17, -0.24, 0.17);
const X_AXIS = new Vector3(1, 0, 0);

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

/** Put an arm's hand at `hand` and turn it so its forearm (+Z) runs along `toElbow`, the back of the hand up. */
function aimArm(arm: Object3D, hand: Vector3, toElbow: Vector3): void {
  arm.position.copy(hand);
  tmpMatrix.lookAt(toElbow, ORIGIN, UP);
  arm.quaternion.setFromRotationMatrix(tmpMatrix);
}

const ORIGIN = new Vector3();

/**
 * The two arms on the rifle. The right hand stays on the pistol grip; the left hand sits under the handguard and
 * during a reload goes to the magazine, rides down with it and back up with the new one, then returns.
 */
export class ViewHands {
  private readonly right: Mesh;
  private readonly left: Mesh;
  private readonly hand = new Vector3();
  private readonly elbow = new Vector3();
  private readonly onMag = new Vector3();

  constructor(rifle: Object3D) {
    const material = new MeshLambertMaterial({ vertexColors: true });
    this.right = new Mesh(armGeometry(false), material);
    this.left = new Mesh(armGeometry(true), material);
    this.right.name = 'rightArm';
    this.left.name = 'leftArm';
    rifle.add(this.right, this.left);
    aimArm(this.right, RIGHT_GRIP, RIGHT_ELBOW);
    aimArm(this.left, LEFT_GRIP, LEFT_ELBOW);
  }

  /**
   * Pose the left hand: `grab` 0 is on the handguard, 1 holding the magazine whose pivot is at `magazine`
   * (rifle frame) tipped by `magTilt` about X.
   */
  update(grab: number, magazine: Vector3, magTilt: number): void {
    this.onMag.copy(LEFT_ON_MAG).applyAxisAngle(X_AXIS, magTilt).add(magazine);
    this.hand.lerpVectors(LEFT_GRIP, this.onMag, grab);
    this.elbow.lerpVectors(LEFT_ELBOW, LEFT_ON_MAG_ELBOW, grab);
    aimArm(this.left, this.hand, this.elbow);
  }
}
