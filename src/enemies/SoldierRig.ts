import { Object3D, Quaternion, Vector3 } from 'three';
import { SOLDIER } from './SoldierGeometry';
import type { SoldierRenderer } from './SoldierRenderer';

/** Everything the procedural animation needs for one frame. Owned and updated by the enemy. */
export interface SoldierPose {
  /** Holds a rifle (riflemen) instead of swinging free arms (sappers). */
  armed: boolean;
  /** A sapper's satchel charge on the chest, and the red helmet band. */
  satchel: boolean;
  band: boolean;
  /** Horizontal speed now, in m/s, and the speed at which the gait reaches full swing. */
  speed: number;
  fullSpeed: number;
  /** Walk cycle angle: one full turn (2 pi) is two steps. */
  phase: number;
  /** 0 = rifle at low ready, 1 = shouldered and aimed. Aim pitch in radians, positive up. */
  aim: number;
  aimPitch: number;
  /** 0..1 crouched planting pose (sappers). */
  crouch: number;
  /** Forward lean of the upper body at full speed, in radians. */
  lean: number;
  /** Sideways lean of the upper body (leaning out from cover), in radians; positive leans to its right. */
  roll: number;
  /** 0..1 kicks that decay: recoil from a shot, and a flinch from a hit (to the `flinchSide`, -1 or 1). */
  recoil: number;
  flinch: number;
  flinchSide: number;
  /** 0..1 through toppling over dead, the direction it falls (world x, z, unit), and how far it has sunk, in meters. */
  fall: number;
  fallX: number;
  fallZ: number;
  sink: number;
}

export function createSoldierPose(): SoldierPose {
  return {
    armed: true, satchel: false, band: false, speed: 0, fullSpeed: 4, phase: 0, aim: 0, aimPitch: 0, crouch: 0,
    lean: 0.1, roll: 0, recoil: 0, flinch: 0, flinchSide: 1, fall: 0, fallX: 0, fallZ: 1, sink: 0,
  };
}

const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);

// Rifle carry poses in the torso's frame: grip position and the rifle's turn.
const LOW_READY_POS = new Vector3(-0.07, 0.12, 0.25);
const LOW_READY_ROT = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.75).multiply(
  new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5),
);
const AIM_POS = new Vector3(-0.1, 0.42, 0.3);
const AIM_ROT = new Quaternion();
/** Dead: the rifle lies across the chest instead of pointing at the sky. */
const DEAD_RIFLE_POS = new Vector3(0.08, 0.2, 0.2);
const DEAD_RIFLE_ROT = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2 - 0.3);
/** Elbows bend outward and down. */
const POLE_RIGHT = new Vector3(-1, -1, -0.4).normalize();
const POLE_LEFT = new Vector3(1, -1.2, -0.2).normalize();

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const yawQ = new Quaternion();
const fallQ = new Quaternion();
const fallAxis = new Vector3();

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * One soldier's skeleton of plain Object3D joints (never added to the scene) and its procedural animation:
 * walk and run leg and arm swing, the rifle carried at low ready or shouldered (hands kept on it by two-bone
 * arm IK), recoil kick, a flinch when hit, the sapper's crouched planting pose, and toppling over dead.
 * `write` copies each joint's world matrix into the soldier's slot in the instanced renderer.
 */
export class SoldierRig {
  private readonly root = new Object3D();
  private readonly hips = new Object3D();
  private readonly torso = new Object3D();
  private readonly head = new Object3D();
  private readonly shoulders = [new Object3D(), new Object3D()];
  private readonly elbows = [new Object3D(), new Object3D()];
  private readonly legs = [new Object3D(), new Object3D()];
  private readonly knees = [new Object3D(), new Object3D()];
  private readonly rifle = new Object3D();
  private visible = { armed: true, satchel: false, band: false };

  constructor() {
    const s = SOLDIER;
    this.root.add(this.hips);
    this.hips.add(this.torso);
    this.torso.position.y = s.waist;
    this.torso.add(this.head);
    this.head.position.y = s.neck;
    this.torso.add(this.rifle);
    // Index 0 is the right side (-X), 1 the left (+X).
    for (let side = 0; side < 2; side++) {
      const x = side === 0 ? -1 : 1;
      this.torso.add(this.shoulders[side]);
      this.shoulders[side].position.set(x * s.shoulderX, s.shoulderY, 0);
      this.shoulders[side].add(this.elbows[side]);
      this.elbows[side].position.y = -s.upperArm;
      this.hips.add(this.legs[side]);
      this.legs[side].position.set(x * s.hipX, -0.02, 0);
      this.legs[side].add(this.knees[side]);
      this.knees[side].position.y = -s.thigh;
    }
  }

  /** World position of the rifle's muzzle, from the last pose. */
  muzzle(out: Vector3): Vector3 {
    return out.copy(SOLDIER.rifleMuzzle).applyMatrix4(this.rifle.matrixWorld);
  }

  /** World position of the head, from the last pose. */
  headPosition(out: Vector3): Vector3 {
    return out.set(0, 0.14, 0).applyMatrix4(this.head.matrixWorld);
  }

  /**
   * Where the hit zones sit in the last pose, in world space: the middle of the head (face and helmet), and
   * the two ends of the body capsule's axis, from just below the knees up the spine to the lower chest
   * (the capsule's radius covers the shoulders). They follow every pose: crouching, leaning, flinching.
   */
  hitZones(head: Vector3, bottom: Vector3, top: Vector3): void {
    head.set(0, 0.16, 0).applyMatrix4(this.head.matrixWorld);
    bottom.setFromMatrixPosition(this.knees[0].matrixWorld);
    hitTmp.setFromMatrixPosition(this.knees[1].matrixWorld);
    bottom.add(hitTmp).multiplyScalar(0.5);
    bottom.y -= 0.1;
    // Up the spine from the waist.
    top.setFromMatrixPosition(this.torso.matrixWorld);
    hitTmp.setFromMatrixPosition(this.head.matrixWorld).sub(top).normalize();
    top.addScaledVector(hitTmp, 0.17);
  }

  /** Pose the skeleton standing at `feet`, facing `yaw` (0 faces +Z). */
  pose(feet: Vector3, yaw: number, p: SoldierPose): void {
    const s = SOLDIER;
    this.visible.armed = p.armed;
    this.visible.satchel = p.satchel;
    this.visible.band = p.band;
    const dead = p.fall > 0;
    const gait = Math.min(1, p.speed / p.fullSpeed);
    const sin = Math.sin(p.phase);
    const cos = Math.cos(p.phase);

    // Legs: swing from the hips, bend the knee on the forward swing. Crouch folds them under.
    const swing = lerp(0.45, 0.8, gait) * gait;
    const kneeBend = lerp(0.7, 1.3, gait) * gait;
    const legAngles = [swing * sin, -swing * sin];
    const kneeAngles = [kneeBend * Math.max(0, -cos), kneeBend * Math.max(0, cos)];
    for (let side = 0; side < 2; side++) {
      // Negative x swings the foot forward.
      let thigh = legAngles[side];
      let knee = kneeAngles[side] + 0.08;
      thigh = lerp(thigh, side === 0 ? -1.25 : -0.95, p.crouch);
      knee = lerp(knee, side === 0 ? 1.55 : 2.0, p.crouch);
      if (dead) {
        const buckle = Math.min(1, p.fall * 2.5) * (1 - p.fall * 0.6);
        thigh = lerp(thigh, -0.5, buckle);
        knee = lerp(knee, 1.1, buckle);
      }
      thigh += p.flinch * 0.15;
      knee += p.flinch * 0.3;
      this.legs[side].rotation.set(thigh, 0, side === 0 ? -0.03 : 0.03);
      this.knees[side].rotation.set(knee, 0, 0);
    }

    const bob = 0.045 * gait * Math.abs(cos);
    this.hips.position.set(0, lerp(s.hipHeight - bob, 0.62, p.crouch) - p.flinch * 0.04, 0);
    this.hips.rotation.set(0, 0.08 * gait * sin, 0);

    // Upper body: lean into the run, bend over to plant, pitch with the aim, jolt on recoil and hits.
    const torsoPitch = p.lean * gait + p.crouch * 0.6 - p.aimPitch * p.aim - p.recoil * 0.06 + p.flinch * 0.22;
    this.torso.rotation.set(torsoPitch, -0.08 * gait * sin - 0.12 * p.aim, p.flinch * 0.2 * p.flinchSide + p.roll);
    this.head.rotation.set(0.12 * p.aim - p.crouch * 0.3 - torsoPitch * 0.3 + p.flinch * 0.25, 0.12 * p.aim, -p.flinch * 0.15 * p.flinchSide - p.roll * 0.6);

    if (p.armed && !dead) this.poseRifleArms(p);
    else this.poseFreeArms(p, gait, sin, dead);
    if (p.armed && dead) {
      const t = Math.min(1, p.fall * 2);
      this.rifle.position.lerp(DEAD_RIFLE_POS, t);
      this.rifle.quaternion.slerp(DEAD_RIFLE_ROT, t);
    }

    // Root: feet position and facing, then the death topple about the feet.
    yawQ.setFromAxisAngle(UP, yaw);
    if (dead) {
      fallAxis.set(p.fallZ, 0, -p.fallX); // up x fall direction: tips +Y toward the fall direction
      const t = Math.min(1, p.fall);
      fallQ.setFromAxisAngle(fallAxis, (Math.PI / 2 - 0.06) * t * t);
      this.root.quaternion.copy(fallQ).multiply(yawQ);
      this.root.position.set(feet.x, feet.y + 0.14 * t - p.sink, feet.z);
    } else {
      this.root.quaternion.copy(yawQ);
      this.root.position.copy(feet);
    }
    this.root.updateMatrixWorld(true);
  }

  /** Copy the posed joints into this soldier's slot. */
  write(renderer: SoldierRenderer, slot: number): void {
    renderer.set('pelvis', slot, 0, this.hips.matrixWorld);
    renderer.set('torso', slot, 0, this.torso.matrixWorld);
    renderer.set('head', slot, 0, this.head.matrixWorld);
    for (let side = 0; side < 2; side++) {
      renderer.set('upperArm', slot, side, this.shoulders[side].matrixWorld);
      renderer.set('forearm', slot, side, this.elbows[side].matrixWorld);
      renderer.set('thigh', slot, side, this.legs[side].matrixWorld);
      renderer.set('shin', slot, side, this.knees[side].matrixWorld);
    }
    if (this.visible.armed) renderer.set('rifle', slot, 0, this.rifle.matrixWorld);
    else renderer.hide('rifle', slot);
    if (this.visible.satchel) renderer.set('satchel', slot, 0, this.torso.matrixWorld);
    else renderer.hide('satchel', slot);
    if (this.visible.band) renderer.set('band', slot, 0, this.head.matrixWorld);
    else renderer.hide('band', slot);
  }

  /** Rifle at low ready or shouldered, with both hands kept on it by IK. */
  private poseRifleArms(p: SoldierPose): void {
    const s = SOLDIER;
    const rifle = this.rifle;
    rifle.position.lerpVectors(LOW_READY_POS, AIM_POS, p.aim);
    rifle.quaternion.slerpQuaternions(LOW_READY_ROT, AIM_ROT, p.aim);
    // Recoil shoves the rifle straight back along its barrel.
    tmpA.set(0, 0, -0.07 * p.recoil).applyQuaternion(rifle.quaternion);
    rifle.position.add(tmpA);
    rifle.updateMatrix();

    const grip = tmpB.copy(s.rifleGrip).applyMatrix4(rifle.matrix);
    this.solveArm(0, grip, POLE_RIGHT);
    const guard = tmpC.copy(s.rifleHandguard).applyMatrix4(rifle.matrix);
    this.solveArm(1, guard, POLE_LEFT);
  }

  /** Arms swinging opposite the legs (sappers), reaching down to plant, or flung out when dead. */
  private poseFreeArms(p: SoldierPose, gait: number, sin: number, dead: boolean): void {
    const swing = lerp(0.35, 1.0, gait) * gait;
    for (let side = 0; side < 2; side++) {
      const out = side === 0 ? -1 : 1;
      let x = (side === 0 ? -swing : swing) * sin;
      let z = out * 0.12;
      let elbow = -(0.35 + 0.95 * gait);
      x = lerp(x, -1.15 + side * 0.15, p.crouch);
      elbow = lerp(elbow, -0.45, p.crouch);
      if (dead) {
        const t = Math.min(1, p.fall * 1.5);
        x = lerp(x, -0.6 - side * 0.5, t);
        z = lerp(z, out * 1.2, t);
        elbow = lerp(elbow, -0.4, t);
      }
      this.shoulders[side].quaternion.identity();
      this.shoulders[side].rotation.set(x + p.flinch * 0.4, 0, z);
      this.elbows[side].rotation.set(elbow, 0, 0);
    }
  }

  /**
   * Two-bone IK in the torso's frame: turn the upper arm and forearm so the hand reaches `target`, with the
   * elbow bending toward `pole`. Out of reach, the arm points straight at the target.
   */
  private solveArm(side: number, target: Vector3, pole: Vector3): void {
    const s = SOLDIER;
    const a = s.upperArm;
    const b = s.forearm;
    const shoulder = this.shoulders[side];
    const toTarget = tmpA.copy(target).sub(shoulder.position);
    const d = Math.min(Math.max(toTarget.length(), 0.05), a + b - 1e-3);
    const dir = toTarget.normalize();
    // Angle at the shoulder between the target line and the upper arm (law of cosines).
    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    // Bend direction: the pole with its part along the target line removed.
    const bend = poleVector.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (bend.lengthSq() < 1e-6) bend.set(0, -1, 0);
    bend.normalize();
    const upper = upperDir.copy(dir).multiplyScalar(cosA).addScaledVector(bend, sinA);

    shoulder.quaternion.setFromUnitVectors(DOWN, upper);
    // Forearm: from the elbow to the target, expressed in the upper arm's frame.
    const elbowPos = elbowPoint.copy(shoulder.position).addScaledVector(upper, a);
    const fore = foreDir.copy(target).sub(elbowPos).normalize();
    fore.applyQuaternion(inverse.copy(shoulder.quaternion).invert());
    this.elbows[side].quaternion.setFromUnitVectors(DOWN, fore);
  }
}

const poleVector = new Vector3();
const hitTmp = new Vector3();
const upperDir = new Vector3();
const elbowPoint = new Vector3();
const foreDir = new Vector3();
const inverse = new Quaternion();
