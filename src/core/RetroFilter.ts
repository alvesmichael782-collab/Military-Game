import {
  Mesh,
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
const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float levels;
varying vec2 vUv;
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec3 c = toSRGB(clamp(texture2D(map, vUv).rgb, 0.0, 1.0));
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
