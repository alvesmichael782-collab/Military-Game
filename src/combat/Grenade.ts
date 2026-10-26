import RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { DamageSource } from './Damage';

const BODY_COLOR = 0x4a5a2a;
const METAL_COLOR = 0x8a8d80;
/** Gives the grenade a believable weight of about 0.4 kg. */
const DENSITY = 280;
/** Spin in rad/s per m/s of throw speed. */
const TUMBLE = 0.8;

const shared = {
  body: new IcosahedronGeometry(1, 0),
  cap: new CylinderGeometry(0.4, 0.45, 0.5, 6),
  spoon: new BoxGeometry(0.18, 0.9, 0.12),
  bodyMaterial: new MeshLambertMaterial({ color: BODY_COLOR, flatShading: true }),
  metalMaterial: new MeshLambertMaterial({ color: METAL_COLOR, flatShading: true }),
};

/** Placeholder frag grenade: a faceted olive body with a fuse cap and spoon. */
function createGrenadeMesh(radius: number): Object3D {
  const root = new Object3D();
  root.name = 'grenade';
  const body = new Mesh(shared.body, shared.bodyMaterial);
  body.scale.set(radius, radius * 1.2, radius);
  const cap = new Mesh(shared.cap, shared.metalMaterial);
  cap.scale.setScalar(radius);
  cap.position.y = radius * 1.3;
  const spoon = new Mesh(shared.spoon, shared.metalMaterial);
  spoon.scale.setScalar(radius);
  spoon.position.set(radius * 0.55, radius * 0.9, 0);
  spoon.rotation.z = -0.25;
  for (const mesh of [body, cap, spoon]) {
    mesh.castShadow = true;
    root.add(mesh);
  }
  return root;
}

/**
 * One pooled frag grenade: a Rapier dynamic ball that bounces around until its fuse runs out.
 * The body is disabled (not removed) while unused. Simulated in fixed steps, interpolated for rendering.
 */
export class Grenade {
  readonly mesh: Object3D;
  /** Seconds until it explodes. */
  fuse = 0;
  /** Who threw it; its blast carries this source. */
  source: DamageSource = 'player';
  /** Another player's grenade, shown here: it deals no damage (see `Grenades.throw`). */
  harmless = false;

  private readonly body: RAPIER.RigidBody;
  private _active = false;
  private readonly prevPosition = new Vector3();
  private readonly currPosition = new Vector3();
  private readonly prevRotation = new Quaternion();
  private readonly currRotation = new Quaternion();
  private readonly lastVelocity = new Vector3();
  private readonly velocity = new Vector3();

  constructor(scene: Scene, world: RAPIER.World) {
    const g = config.grenade;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setEnabled(false)
        .setCcdEnabled(true)
        .setLinearDamping(g.linearDamping)
        .setAngularDamping(g.angularDamping),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(g.bodyRadius)
        .setDensity(DENSITY)
        .setRestitution(g.restitution)
        .setFriction(g.friction)
        .setCollisionGroups(Groups.grenade),
      this.body,
    );

    this.mesh = createGrenadeMesh(g.bodyRadius);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  get active(): boolean {
    return this._active;
  }

  /** Latest simulated position. */
  get position(): Vector3 {
    return this.currPosition;
  }

  launch(position: Vector3, velocity: Vector3, source: DamageSource, fuse: number = config.grenade.fuse): void {
    this._active = true;
    this.source = source;
    this.fuse = fuse;
    this.body.setEnabled(true);
    this.body.setTranslation(position, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel(velocity, true);
    // Tumble end over end, around the horizontal axis across the throw.
    this.body.setAngvel({ x: velocity.z * TUMBLE, y: (Math.random() - 0.5) * 4, z: -velocity.x * TUMBLE }, true);

    this.prevPosition.copy(position);
    this.currPosition.copy(position);
    this.prevRotation.identity();
    this.currRotation.identity();
    this.lastVelocity.copy(velocity);
    this.mesh.visible = true;
  }

  deactivate(): void {
    this._active = false;
    this.body.setEnabled(false);
    this.mesh.visible = false;
  }

  /**
   * Record the state after a physics step. Returns the change in velocity beyond gravity, in m/s,
   * which is large on the step it bounced.
   */
  afterStep(dt: number): number {
    const t = this.body.translation();
    const r = this.body.rotation();
    const v = this.body.linvel();
    this.prevPosition.copy(this.currPosition);
    this.prevRotation.copy(this.currRotation);
    this.currPosition.set(t.x, t.y, t.z);
    this.currRotation.set(r.x, r.y, r.z, r.w);

    this.velocity.set(v.x, v.y, v.z);
    const impact = Math.hypot(
      this.velocity.x - this.lastVelocity.x,
      this.velocity.y - (this.lastVelocity.y + config.physics.gravity * dt),
      this.velocity.z - this.lastVelocity.z,
    );
    this.lastVelocity.copy(this.velocity);
    return impact;
  }

  render(alpha: number): void {
    this.mesh.position.lerpVectors(this.prevPosition, this.currPosition, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevRotation, this.currRotation, alpha);
  }
}
