import RAPIER from '@dimforge/rapier3d-compat';
import {
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import type { EventBus, GameEvents, SegmentDestroyedEvent } from '../core/EventBus';
import { createDebrisGeometry, DEBRIS_HALF_EXTENTS, DEBRIS_KINDS, type DebrisKind } from './DebrisGeometry';

const FADE_ATTRIBUTE = 'debrisFade';
/** Brick weighs about 1.8 t per cubic meter. */
const DENSITY = 1800;
const ONE = new Vector3(1, 1, 1);

interface Chunk {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  kind: DebrisKind;
  active: boolean;
  /** Seconds since it was thrown. */
  age: number;
  readonly prevPosition: Vector3;
  readonly currPosition: Vector3;
  readonly prevRotation: Quaternion;
  readonly currRotation: Quaternion;
  readonly lastVelocity: Vector3;
}

/**
 * Debris chunks thrown when a structure collapses: pooled Rapier dynamic bodies (disabled while unused)
 * drawn with one instanced mesh per chunk kind. Chunks fly away from what destroyed the structure, tumble,
 * settle, and after `lifetime` seconds dither out and go back to the pool. At most `maxActive` are out at
 * once; once all are, the oldest is reused. Simulated in fixed steps, interpolated for rendering.
 * Only world geometry and other chunks feel them, so they never trip the player or stop bullets.
 */
export class Debris {
  private readonly chunks: Chunk[] = [];
  private readonly meshes = new Map<DebrisKind, InstancedMesh>();
  private soundGap = 0;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly velocity = new Vector3();
  /** Instances drawn per kind this frame (reused every frame). */
  private readonly counts = new Map<DebrisKind, number>();
  private readonly spawnPoint = new Vector3();
  private readonly along = new Vector3();
  private readonly away = new Vector3();
  private readonly axis = new Vector3();

  constructor(
    scene: Scene,
    world: RAPIER.World,
    private readonly events: EventBus<GameEvents>,
  ) {
    const d = config.destruction.debris;
    const material = createDebrisMaterial();
    for (const kind of DEBRIS_KINDS) {
      const geometry = createDebrisGeometry(kind);
      geometry.setAttribute(FADE_ATTRIBUTE, new InstancedBufferAttribute(new Float32Array(d.maxActive), 1));
      const mesh = new InstancedMesh(geometry, material, d.maxActive);
      mesh.name = `debris-${kind}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      this.meshes.set(kind, mesh);
    }
    for (let i = 0; i < d.maxActive; i++) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setEnabled(false).setLinearDamping(0.1).setAngularDamping(0.6));
      const h = DEBRIS_HALF_EXTENTS.brick;
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setDensity(DENSITY).setFriction(0.9).setRestitution(0.15).setCollisionGroups(Groups.debris),
        body,
      );
      this.chunks.push({
        body,
        collider,
        kind: 'brick',
        active: false,
        age: 0,
        prevPosition: new Vector3(),
        currPosition: new Vector3(),
        prevRotation: new Quaternion(),
        currRotation: new Quaternion(),
        lastVelocity: new Vector3(),
      });
    }

    events.on('segmentDestroyed', (e) => this.burst(e));
  }

  /** Chunks out on the field, for the debug overlay. */
  get activeCount(): number {
    let n = 0;
    for (const chunk of this.chunks) if (chunk.active) n++;
    return n;
  }

  /** Call after each physics step. */
  fixedUpdate(dt: number): void {
    const d = config.destruction.debris;
    this.soundGap = Math.max(0, this.soundGap - dt);
    for (const chunk of this.chunks) {
      if (!chunk.active) continue;
      chunk.age += dt;
      if (chunk.age >= d.lifetime + d.fadeTime) {
        chunk.active = false;
        chunk.body.setEnabled(false);
        continue;
      }
      // A chunk at rest stays put: skip reading it back (every Rapier read allocates).
      if (chunk.body.isSleeping()) {
        chunk.prevPosition.copy(chunk.currPosition);
        chunk.prevRotation.copy(chunk.currRotation);
        chunk.lastVelocity.set(0, 0, 0);
        continue;
      }
      const t = chunk.body.translation();
      const r = chunk.body.rotation();
      const v = chunk.body.linvel();
      chunk.prevPosition.copy(chunk.currPosition);
      chunk.prevRotation.copy(chunk.currRotation);
      chunk.currPosition.set(t.x, t.y, t.z);
      chunk.currRotation.set(r.x, r.y, r.z, r.w);

      // A sudden change in velocity beyond gravity is a landing.
      this.velocity.set(v.x, v.y, v.z);
      const impact = Math.hypot(v.x - chunk.lastVelocity.x, v.y - (chunk.lastVelocity.y + config.physics.gravity * dt), v.z - chunk.lastVelocity.z);
      chunk.lastVelocity.copy(this.velocity);
      if (impact > d.soundSpeed && this.soundGap <= 0) {
        this.soundGap = d.soundGap;
        this.events.emit('debrisLanded', { position: chunk.currPosition, impactSpeed: impact });
      }
    }
  }

  /** Draw every live chunk where it is between the last two physics steps. */
  render(alpha: number): void {
    const d = config.destruction.debris;
    const counts = this.counts;
    counts.clear();
    for (const chunk of this.chunks) {
      if (!chunk.active) continue;
      const mesh = this.meshes.get(chunk.kind);
      if (!mesh) continue;
      const index = counts.get(chunk.kind) ?? 0;
      counts.set(chunk.kind, index + 1);
      this.position.lerpVectors(chunk.prevPosition, chunk.currPosition, alpha);
      this.rotation.slerpQuaternions(chunk.prevRotation, chunk.currRotation, alpha);
      mesh.setMatrixAt(index, this.matrix.compose(this.position, this.rotation, ONE));
      const fade = 1 - Math.max(0, chunk.age - d.lifetime) / d.fadeTime;
      (mesh.geometry.getAttribute(FADE_ATTRIBUTE) as InstancedBufferAttribute).setX(index, fade);
    }
    this.meshes.forEach((mesh, kind) => {
      mesh.count = counts.get(kind) ?? 0;
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.getAttribute(FADE_ATTRIBUTE).needsUpdate = true;
    });
  }

  /** Throw a collapse's chunks out of the structure's footprint, away from what destroyed it. */
  private burst({ type, position, yaw, source }: SegmentDestroyedEvent): void {
    const d = config.destruction.debris;
    const count = d.minChunks + Math.floor(Math.random() * (d.maxChunks - d.minChunks + 1));
    this.along.set(Math.cos(yaw), 0, -Math.sin(yaw));
    for (let i = 0; i < count; i++) {
      let kind: DebrisKind;
      if (type === 'wall') {
        // Out of the wall's middle, anywhere up its height.
        const s = (Math.random() - 0.5) * 1.8;
        this.spawnPoint.copy(position).addScaledVector(this.along, s);
        this.spawnPoint.x += (Math.random() - 0.5) * 0.3 * this.along.z;
        this.spawnPoint.z -= (Math.random() - 0.5) * 0.3 * this.along.x;
        this.spawnPoint.y = 0.7 + Math.random() * 1.6;
        const roll = Math.random();
        kind = roll < 0.45 ? 'brick' : roll < 0.75 ? 'plaster' : 'block';
      } else {
        // From somewhere round the sandbag ring.
        const a = Math.random() * Math.PI * 2;
        this.spawnPoint.set(position.x + Math.cos(a) * 1.5, 0.5 + Math.random() * 0.5, position.z + Math.sin(a) * 1.5);
        kind = 'bag';
      }
      this.throwChunk(this.take(), kind, source);
    }
  }

  /** A free chunk, or the oldest one out if all are in use. */
  private take(): Chunk {
    let oldest = this.chunks[0];
    for (const chunk of this.chunks) {
      if (!chunk.active) return chunk;
      if (chunk.age > oldest.age) oldest = chunk;
    }
    return oldest;
  }

  private throwChunk(chunk: Chunk, kind: DebrisKind, source: Vector3): void {
    const d = config.destruction.debris;
    chunk.kind = kind;
    chunk.collider.setHalfExtents(DEBRIS_HALF_EXTENTS[kind]);
    // Away from the source along the ground; straight out at random if the source sits right on it.
    this.away.set(this.spawnPoint.x - source.x, 0, this.spawnPoint.z - source.z);
    if (this.away.lengthSq() < 0.01) this.away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    this.away.normalize();
    const speed = d.minSpeed + Math.random() * (d.maxSpeed - d.minSpeed);
    this.velocity.set(
      this.away.x * speed + (Math.random() - 0.5) * 1.5,
      d.upSpeed * (0.4 + Math.random() * 0.8),
      this.away.z * speed + (Math.random() - 0.5) * 1.5,
    );
    this.rotation.setFromAxisAngle(this.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), Math.random() * Math.PI * 2);
    const spin = (): number => (Math.random() * 2 - 1) * d.maxSpin;

    const body = chunk.body;
    body.setEnabled(true);
    body.setTranslation(this.spawnPoint, true);
    body.setRotation(this.rotation, true);
    body.setLinvel(this.velocity, true);
    body.setAngvel({ x: spin(), y: spin(), z: spin() }, true);
    chunk.active = true;
    chunk.age = 0;
    chunk.prevPosition.copy(this.spawnPoint);
    chunk.currPosition.copy(this.spawnPoint);
    chunk.prevRotation.copy(this.rotation);
    chunk.currRotation.copy(this.rotation);
    chunk.lastVelocity.copy(this.velocity);
  }
}

/** Vertex-colored Lambert that dithers out by the per-instance fade (1 solid, 0 gone), so fading needs no sorting. */
function createDebrisMaterial(): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float ${FADE_ATTRIBUTE};\nvarying float vDebrisFade;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvDebrisFade = ${FADE_ATTRIBUTE};`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vDebrisFade;
float debrisBayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float debrisBayer4(vec2 a) { return debrisBayer2(0.5 * a) * 0.25 + debrisBayer2(a); }`,
      )
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (vDebrisFade <= debrisBayer4(gl_FragCoord.xy) + 0.03) discard;`);
  };
  material.customProgramCacheKey = () => 'debrisDither';
  return material;
}
