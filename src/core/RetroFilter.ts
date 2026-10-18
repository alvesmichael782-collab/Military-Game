import {
  Mesh,
  Vector2,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { config } from './config';

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// The target stores sRGB and is read back as linear light; encode to sRGB again, then cut each channel to
// `levels` steps for the slight banding of a 16-bit era framebuffer.
// At low health the scene also blurs toward the edges (clear inside `clearRadius`, measured in half screen heights
// from the middle) and loses color. Twelve taps on two rings; skipped entirely while `blur` is 0.
const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float levels;
uniform float blur;
uniform float clearRadius;
uniform float desaturation;
uniform vec2 texel;
uniform float aspect;
varying vec2 vUv;
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 scene(vec2 uv) {
  return clamp(texture2D(map, uv).rgb, 0.0, 1.0);
}
void main() {
  vec3 c = scene(vUv);
  if (blur > 0.0) {
    vec2 fromCenter = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
    float edge = smoothstep(clearRadius, clearRadius + 0.7, length(fromCenter));
    float r = blur * edge;
    if (r > 0.05) {
      vec2 o = texel * r;
      vec2 h = o * 0.5;
      vec3 sum = c;
      sum += scene(vUv + vec2(o.x, 0.0)) + scene(vUv - vec2(o.x, 0.0));
      sum += scene(vUv + vec2(0.0, o.y)) + scene(vUv - vec2(0.0, o.y));
      sum += scene(vUv + o * 0.7071) + scene(vUv - o * 0.7071);
      sum += scene(vUv + vec2(o.x, -o.y) * 0.7071) + scene(vUv - vec2(o.x, -o.y) * 0.7071);
      sum += scene(vUv + vec2(h.x, h.y) * 0.7071) + scene(vUv - vec2(h.x, h.y) * 0.7071);
      sum += scene(vUv + vec2(h.x, -h.y) * 0.7071) + scene(vUv - vec2(h.x, -h.y) * 0.7071);
      c = sum / 13.0;
    }
  }
  if (desaturation > 0.0) {
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(luma), desaturation);
  }
  c = toSRGB(c);
  c = floor(c * levels + 0.5) / levels;
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * The retro render filter. Between `begin` and `end` everything the game draws (the world, then the view model
 * over it) goes into a low-resolution target (`config.retro.renderScale` of the canvas), which `end` stretches
 * over the canvas with nearest filtering and slight color quantization. The HUD is HTML over the canvas, so it
 * stays at full resolution. Turned off, the scene is drawn straight to the canvas as before.
 */
export class RetroFilter {
  private readonly target: WebGLRenderTarget;
  private readonly material: ShaderMaterial;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private _enabled: boolean = config.retro.enabled;

  constructor(private readonly renderer: WebGLRenderer) {
    this.target = new WebGLRenderTarget(1, 1, {
      type: UnsignedByteType,
      colorSpace: SRGBColorSpace,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    this.material = new ShaderMaterial({
      uniforms: {
        map: { value: this.target.texture },
        levels: { value: 2 ** config.retro.colorBits - 1 },
        blur: { value: 0 },
        clearRadius: { value: 1 },
        desaturation: { value: 0 },
        texel: { value: new Vector2(1, 1) },
        aspect: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.resize();
  }

  get enabled(): boolean {
    return this._enabled;
  }

  /** Low-resolution size in pixels, for the debug overlay and tests. */
  get size(): { width: number; height: number } {
    return { width: this.target.width, height: this.target.height };
  }

  toggle(): void {
    this._enabled = !this._enabled;
  }

  /** Match the canvas. Call after `renderer.setSize`. */
  resize(): void {
    const width = this.renderer.domElement.width;
    const height = this.renderer.domElement.height;
    const scale = config.retro.renderScale;
    this.target.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const u = this.material.uniforms;
    (u.texel.value as Vector2).set(1 / this.target.width, 1 / this.target.height);
    u.aspect.value = width / Math.max(1, height);
  }

  /**
   * Low-health vision for this frame: `blur` in low-resolution pixels at the screen edges (0 for none), the clear
   * radius in the middle in half screen heights, and the color lost, 0..1. Only the 3D scene is affected, and only
   * while the filter is on.
   */
  setVision(blur: number, clearRadius: number, desaturation: number): void {
    const u = this.material.uniforms;
    u.blur.value = blur;
    u.clearRadius.value = clearRadius;
    u.desaturation.value = desaturation;
  }

  /** Start a frame: draw into the low-resolution target (or the canvas when off) and clear it. */
  begin(): void {
    this.renderer.setRenderTarget(this._enabled ? this.target : null);
    this.renderer.clear();
  }

  /** Finish a frame: blow the target up over the canvas. */
  end(): void {
    if (!this._enabled) return;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
