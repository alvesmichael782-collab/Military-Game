import {
  AdditiveBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';

/** Speed of a tracer streak, in m/s, its length and width, in meters. */
const SPEED = 380;
const LENGTH = 5;
const WIDTH = 0.045;

const vertexShader = /* glsl */ `
attribute vec3 aTail;
attribute vec3 aHead;
attribute float aAlpha;
varying float vAlong;
varying float vAcross;
varying float vAlpha;
uniform float width;
void main() {
  vAlong = position.x;
  vAcross = position.y * 2.0;
  vAlpha = aAlpha;
  vec4 tail = modelViewMatrix * vec4(aTail, 1.0);
  vec4 head = modelViewMatrix * vec4(aHead, 1.0);
  vec4 mv = mix(tail, head, position.x);
  vec3 along = head.xyz - tail.xyz;
  // Widen sideways, facing the camera.
  vec3 side = normalize(cross(along, mv.xyz) + vec3(1e-6, 0.0, 0.0));
  // Keep a minimum on-screen width so far tracers do not vanish between pixels.
  float w = width * max(1.0, -mv.z / 25.0);
  mv.xyz += side * position.y * w;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
varying float vAlong;
varying float vAcross;
varying float vAlpha;
void main() {
  float core = 1.0 - abs(vAcross);
  float a = vAlpha * core * core * (0.25 + 0.75 * vAlong);
  // Warm yellow (sRGB 1.0, 0.82, 0.45) in linear light, so it reads the same drawn straight to the screen or
  // through the retro filter's render target.
  gl_FragColor = vec4(vec3(1.0, 0.639, 0.171) * a, a);
  #include <colorspace_fragment>
}
`;

interface Tracer {
  start: Vector3;
  dir: Vector3;
  length: number;
  traveled: number;
}

/**
 * Pooled tracer streaks: a short, bright line that flies from the muzzle to where the bullet stopped,
 * so the player can see where shots come from. All drawn in one instanced, additive draw call.
 * When the pool is full, the oldest tracer is replaced.
 */
export class Tracers {
  private readonly tracers: Tracer[] = [];
  private readonly tail: InstancedBufferAttribute;
  private readonly head: InstancedBufferAttribute;
  private readonly alpha: InstancedBufferAttribute;
  private next = 0;

  constructor(scene: Scene, private readonly capacity: number) {
    const quad = new PlaneGeometry(1, 1);
    // x runs 0 (tail) to 1 (head), y runs -0.5 to 0.5 across.
    quad.translate(0.5, 0, 0);
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    const attr = (size: number): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.tail = attr(3);
    this.head = attr(3);
    this.alpha = attr(1);
    geometry.setAttribute('aTail', this.tail);
    geometry.setAttribute('aHead', this.head);
    geometry.setAttribute('aAlpha', this.alpha);
    geometry.instanceCount = capacity;

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: { width: { value: WIDTH } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    scene.add(mesh);

    for (let i = 0; i < capacity; i++) {
      this.tracers.push({ start: new Vector3(), dir: new Vector3(), length: 0, traveled: Infinity });
    }
  }

  /** Fire a tracer from `from` to `to`. */
  add(from: Vector3, to: Vector3): void {
    const t = this.tracers[this.next];
    this.next = (this.next + 1) % this.capacity;
    t.start.copy(from);
    t.dir.subVectors(to, from);
    t.length = t.dir.length();
    if (t.length < 0.5) {
      t.traveled = Infinity;
      return;
    }
    t.dir.divideScalar(t.length);
    t.traveled = 0;
  }

  update(dt: number): void {
    const tails = this.tail.array as Float32Array;
    const heads = this.head.array as Float32Array;
    const alphas = this.alpha.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) {
      const t = this.tracers[i];
      // Done once the tail has reached the end.
      if (t.traveled - LENGTH >= t.length) {
        alphas[i] = 0;
        continue;
      }
      t.traveled += SPEED * dt;
      const headAt = Math.min(t.length, t.traveled);
      const tailAt = Math.max(0, Math.min(t.length, t.traveled - LENGTH));
      tails[i * 3] = t.start.x + t.dir.x * tailAt;
      tails[i * 3 + 1] = t.start.y + t.dir.y * tailAt;
      tails[i * 3 + 2] = t.start.z + t.dir.z * tailAt;
      heads[i * 3] = t.start.x + t.dir.x * headAt;
      heads[i * 3 + 1] = t.start.y + t.dir.y * headAt;
      heads[i * 3 + 2] = t.start.z + t.dir.z * headAt;
      alphas[i] = headAt - tailAt > 0.05 ? 1 : 0;
    }
    this.tail.needsUpdate = true;
    this.head.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
