import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type Scene,
  type Texture,
} from 'three';

/** Everything needed to spawn one particle. Reuse one object per caller; `spawn` copies the values. */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds. */
  life: number;
  /** Billboard size in meters at birth and death. Growth eases out. */
  size: number;
  endSize: number;
  /** Color at birth and death (linear RGB, as stored by `Color`). */
  color: Color;
  endColor: Color;
  /** Peak opacity. */
  alpha: number;
  /** Fraction of life spent fading in, and the point (0..1) where fading out starts. */
  fadeIn: number;
  fadeOutStart: number;
  /** Downward acceleration in m/s^2 (negative floats upward). */
  gravity: number;
  /** Fraction of velocity lost per second. */
  drag: number;
  /** Starting rotation and spin, in radians and radians per second. */
  angle: number;
  spin: number;
}

export function createParticleSpec(): ParticleSpec {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 1, endSize: 1,
    color: new Color(1, 1, 1), endColor: new Color(1, 1, 1), alpha: 1, fadeIn: 0, fadeOutStart: 0,
    gravity: 0, drag: 0, angle: 0, spin: 0,
  };
}

const vertexShader = /* glsl */ `
attribute vec3 aOffset;
attribute vec4 aColor;
attribute vec2 aSizeAngle;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(aOffset, 1.0);
  float c = cos(aSizeAngle.y);
  float s = sin(aSizeAngle.y);
  vec2 p = position.xy * aSizeAngle.x;
  mvPosition.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = texture2D(map, vUv) * vColor;
  if (gl_FragColor.a < 0.01) discard;
  #ifdef USE_FOG
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #ifdef ADDITIVE
      // Additive light fades to nothing in fog rather than adding the fog color.
      gl_FragColor.rgb *= 1.0 - fogFactor;
    #else
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
    #endif
  #endif
  #include <colorspace_fragment>
}
`;

/**
 * A fixed-size pool of camera-facing particles drawn in one instanced draw call.
 * Live particles are packed at the front of the arrays; dead ones are swapped out.
 * When the pool is full, new particles are dropped.
 */
export class ParticleSystem {
  private readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly offsetAttr: InstancedBufferAttribute;
  private readonly colorAttr: InstancedBufferAttribute;
  private readonly sizeAngleAttr: InstancedBufferAttribute;

  // Simulation state, structure-of-arrays.
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col0: Float32Array;
  private readonly col1: Float32Array;
  /** life, age, size, endSize, alpha, fadeIn, fadeOutStart, gravity, drag, angle, spin */
  private readonly params: Float32Array;
  private count = 0;

  constructor(
    scene: Scene,
    texture: Texture,
    private readonly capacity: number,
    additive: boolean,
  ) {
    const quad = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));

    const attr = (itemSize: number): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.offsetAttr = attr(3);
    this.colorAttr = attr(4);
    this.sizeAngleAttr = attr(2);
    geometry.setAttribute('aOffset', this.offsetAttr);
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aSizeAngle', this.sizeAngleAttr);
    geometry.instanceCount = 0;

    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { map: { value: null } }]),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? AdditiveBlending : NormalBlending,
      defines: additive ? { ADDITIVE: '' } : {},
    });
    material.uniforms.map.value = texture;

    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    // Glow draws after smoke so fire reads through it.
    this.mesh.renderOrder = additive ? 2 : 1;
    scene.add(this.mesh);

    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col0 = new Float32Array(capacity * 3);
    this.col1 = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * PARAMS);
  }

  get activeCount(): number {
    return this.count;
  }

  spawn(spec: ParticleSpec): void {
    if (this.count >= this.capacity || spec.life <= 0) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = spec.x;
    this.pos[i3 + 1] = spec.y;
    this.pos[i3 + 2] = spec.z;
    this.vel[i3] = spec.vx;
    this.vel[i3 + 1] = spec.vy;
    this.vel[i3 + 2] = spec.vz;
    this.col0[i3] = spec.color.r;
    this.col0[i3 + 1] = spec.color.g;
    this.col0[i3 + 2] = spec.color.b;
    this.col1[i3] = spec.endColor.r;
    this.col1[i3 + 1] = spec.endColor.g;
    this.col1[i3 + 2] = spec.endColor.b;
    const p = i * PARAMS;
    this.params[p] = spec.life;
    this.params[p + 1] = 0;
    this.params[p + 2] = spec.size;
    this.params[p + 3] = spec.endSize;
    this.params[p + 4] = spec.alpha;
    this.params[p + 5] = spec.fadeIn;
    this.params[p + 6] = spec.fadeOutStart;
    this.params[p + 7] = spec.gravity;
    this.params[p + 8] = spec.drag;
    this.params[p + 9] = spec.angle;
    this.params[p + 10] = spec.spin;
  }

  /** Advance and upload every live particle. Call once per rendered frame. */
  update(dt: number): void {
    const { pos, vel, col0, col1, params } = this;
    const offsets = this.offsetAttr.array as Float32Array;
    const colors = this.colorAttr.array as Float32Array;
    const sizes = this.sizeAngleAttr.array as Float32Array;

    let i = 0;
    while (i < this.count) {
      const p = i * PARAMS;
      const life = params[p];
      const age = params[p + 1] + dt;
      if (age >= life) {
        this.swapRemove(i);
        continue; // re-process the particle swapped into slot i
      }
      params[p + 1] = age;
      const t = age / life;

      const i3 = i * 3;
      const damping = Math.max(0, 1 - params[p + 8] * dt);
      vel[i3] *= damping;
      vel[i3 + 1] = vel[i3 + 1] * damping - params[p + 7] * dt;
      vel[i3 + 2] *= damping;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      // Nothing sinks into the ground.
      if (pos[i3 + 1] < 0.02) {
        pos[i3 + 1] = 0.02;
        if (vel[i3 + 1] < 0) vel[i3 + 1] *= -0.3;
        vel[i3] *= 0.7;
        vel[i3 + 2] *= 0.7;
      }
      params[p + 9] += params[p + 10] * dt;

      const fadeIn = params[p + 5];
      const fadeOutStart = params[p + 6];
      let alpha = params[p + 4];
      if (fadeIn > 0 && t < fadeIn) alpha *= t / fadeIn;
      if (t > fadeOutStart) alpha *= 1 - (t - fadeOutStart) / (1 - fadeOutStart);
      const grow = 1 - (1 - t) * (1 - t);

      offsets[i3] = pos[i3];
      offsets[i3 + 1] = pos[i3 + 1];
      offsets[i3 + 2] = pos[i3 + 2];
      const i4 = i * 4;
      colors[i4] = col0[i3] + (col1[i3] - col0[i3]) * t;
      colors[i4 + 1] = col0[i3 + 1] + (col1[i3 + 1] - col0[i3 + 1]) * t;
      colors[i4 + 2] = col0[i3 + 2] + (col1[i3 + 2] - col0[i3 + 2]) * t;
      colors[i4 + 3] = alpha;
      const i2 = i * 2;
      sizes[i2] = params[p + 2] + (params[p + 3] - params[p + 2]) * grow;
      sizes[i2 + 1] = params[p + 9];
      i++;
    }

    this.mesh.geometry.instanceCount = this.count;
    for (const attr of [this.offsetAttr, this.colorAttr, this.sizeAngleAttr]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    copy(this.pos, i, last, 3);
    copy(this.vel, i, last, 3);
    copy(this.col0, i, last, 3);
    copy(this.col1, i, last, 3);
    copy(this.params, i, last, PARAMS);
  }
}

const PARAMS = 11;

function copy(array: Float32Array, to: number, from: number, stride: number): void {
  array.copyWithin(to * stride, from * stride, from * stride + stride);
}
