import {
  BackSide,
  DoubleSide,
  Color,
  Float32BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshLambertMaterial,
  ShaderMaterial,
  SphereGeometry,
  type Scene,
} from 'three';
import { HORIZON_COLOR, SUN_DIRECTION } from './Lighting';
import { createRandom } from './random';

/** Radius of the sky dome, in meters; inside the camera's far plane. */
const DOME_RADIUS = 950;
const ZENITH_COLOR = 0x4f7fb8;
const MID_COLOR = 0x9cb8d4;
/** Angular radius of the sun disk, and of its glow, in radians. */
const SUN_RADIUS = 0.035;
const SUN_GLOW = 0.5;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Pin the dome to the far plane so it never covers anything.
  gl_Position = p.xyww;
}
`;

// Warm pale horizon up through a light blue to a deeper zenith, a hard bright sun disk and a soft glow around it.
const fragmentShader = /* glsl */ `
uniform vec3 horizon;
uniform vec3 mid;
uniform vec3 zenith;
uniform vec3 sunDir;
uniform float sunCos;
uniform float glowSize;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 sky = mix(horizon, mid, smoothstep(0.0, 0.22, h));
  sky = mix(sky, zenith, smoothstep(0.2, 0.85, h));
  float s = dot(d, sunDir);
  float glow = smoothstep(1.0 - glowSize, 1.0, s);
  sky += vec3(1.0, 0.86, 0.6) * glow * glow * 0.45;
  sky = mix(sky, vec3(1.0, 0.97, 0.88) * 1.6, step(sunCos, s));
  gl_FragColor = vec4(sky, 1.0);
  #include <colorspace_fragment>
}
`;

/** Ridge rings: distance from the map center, in meters, base and peak heights, color, facets around. */
const RIDGES = [
  { radius: 380, low: 6, high: 30, color: 0xb08a5c, segments: 64, seed: 31 },
  { radius: 600, low: 30, high: 95, color: 0x9c8c7c, segments: 40, seed: 77 },
] as const;

/**
 * The sky: a gradient dome with the sun disk where the sun light comes from, and two rings of low-poly ridges
 * on the horizon (a nearer sandy one and a taller, hazier one beyond), faded by the distance fog.
 */
export function createSky(scene: Scene): void {
  const dome = new Mesh(
    new SphereGeometry(DOME_RADIUS, 32, 16),
    new ShaderMaterial({
      uniforms: {
        horizon: { value: new Color(HORIZON_COLOR) },
        mid: { value: new Color(MID_COLOR) },
        zenith: { value: new Color(ZENITH_COLOR) },
        sunDir: { value: SUN_DIRECTION.clone() },
        sunCos: { value: Math.cos(SUN_RADIUS) },
        glowSize: { value: 1 - Math.cos(SUN_GLOW) },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  dome.name = 'sky';
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  // Follow the camera so the horizon never shifts.
  dome.onBeforeRender = (_r, _s, camera) => {
    dome.position.copy(camera.position);
    dome.updateMatrixWorld();
  };
  scene.add(dome);

  for (const ridge of RIDGES) scene.add(createRidge(ridge));
}

/**
 * A closed ring of low-poly mountains: a crest of a few big swells with smaller peaks on them, faced as one
 * row of quads from a buried base, plus a ridge line set back behind each crest point so every peak has a lit
 * and a shaded flank. Flat shaded by the sun; slightly darker toward the base.
 */
function createRidge(r: (typeof RIDGES)[number]): Mesh {
  const random = createRandom(r.seed);
  const n = r.segments;
  const crest: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const swell = 0.5 + 0.3 * Math.sin(a * 3 + r.seed) + 0.2 * Math.sin(a * 7 + r.seed * 2);
    crest.push(r.low + (r.high - r.low) * Math.min(1, Math.max(0, swell * 0.75 + (random() - 0.5) * 0.45)));
  }
  const positions: number[] = [];
  const colors: number[] = [];
  const base = new Color(r.color);
  const dark = base.clone().multiplyScalar(0.72);
  const at = (k: number, rad: number, y: number): number[] => {
    const a = (k / n) * Math.PI * 2;
    return [Math.cos(a) * rad, y, Math.sin(a) * rad];
  };
  const push = (v: number[], low: boolean): void => {
    positions.push(...v);
    const c = low ? dark : base;
    colors.push(c.r, c.g, c.b);
  };
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    const b0 = at(k, r.radius, -6);
    const b1 = at(k1, r.radius, -6);
    // Peaks sit a little behind the foot of the slope, so the front faces lean back.
    const t0 = at(k, r.radius + crest[k] * 1.2, crest[k]);
    const t1 = at(k1, r.radius + crest[k1] * 1.2, crest[k1]);
    // The back of the ridge, falling away from the crest.
    const f0 = at(k, r.radius + crest[k] * 2.6, crest[k] * 0.45);
    const f1 = at(k1, r.radius + crest[k1] * 2.6, crest[k1] * 0.45);
    for (const [v, low] of [[b0, true], [b1, true], [t0, false], [t0, false], [b1, true], [t1, false]] as const) push(v, low);
    for (const [v, low] of [[t0, false], [t1, false], [f0, false], [f0, false], [t1, false], [f1, false]] as const) push(v, low);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }));
  mesh.name = 'ridges';
  return mesh;
}
