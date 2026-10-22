import {
  Box3,
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { WeaponDef } from '../../player/weapons/defs/WeaponDef';
import type { WeaponAsset } from '../../player/weapons/WeaponAssets';

/** Shop menu icon images by icon key (a weapon def id, "armorPlate", "grenade"), as image URLs. */
export type ShopIcons = ReadonlyMap<string, string>;

/** Size of a weapon silhouette image, in pixels (3:1, like the menu's icon box), and the supersampling it is drawn at. */
const WIDTH = 480;
const HEIGHT = 160;
const SUPERSAMPLE = 2;
/** Empty space kept around the weapon, as a fraction of the image. */
const MARGIN = 0.06;

/** A ballistic plate (the HUD's spare plate shape), solid white with its inset edge line cut out. */
const PLATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 26 30">
<mask id="m"><path d="M6 1 H18 L23 6 V20 Q23 24.5 18 26 L12 27.5 L6 26 Q1 24.5 1 20 V6 Z" fill="#fff"/>
<path d="M7 4 H17 L20 7 V19.5 Q20 22.5 17 23.5 L12 24.7 L7 23.5 Q4 22.5 4 19.5 V7 Z" fill="none" stroke="#000" stroke-width="1.3"/></mask>
<rect x="-1" y="-1" width="26" height="30" fill="#fff" mask="url(#m)"/></svg>`;

/** A frag grenade (the HUD's grenade shape), solid white: body, fuse cap, spoon and pull ring. */
const GRENADE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 30" fill="#fff" stroke="#fff">
<circle cx="13" cy="19" r="9.5" stroke="none"/><rect x="9" y="5.5" width="8" height="5" rx="1" stroke="none"/>
<path d="M16.5 6.5 Q23.5 6 23.5 15" fill="none" stroke-width="2.4" stroke-linecap="round"/>
<circle cx="7.5" cy="6.5" r="3.2" fill="none" stroke-width="1.8"/></svg>`;

function svgUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Every shop icon: a flat white side-view silhouette of each weapon (barrel or blade to the right), drawn once at
 * startup from its model with the game's renderer, plus the drawn consumable shapes. The menu turns them black
 * on a highlighted row with a CSS filter.
 */
export function createShopIcons(renderer: WebGLRenderer, defs: readonly WeaponDef[], assets: ReadonlyMap<string, WeaponAsset>): ShopIcons {
  const icons = new Map<string, string>([
    ['armorPlate', svgUrl(PLATE_SVG)],
    ['grenade', svgUrl(GRENADE_SVG)],
  ]);
  const w = WIDTH * SUPERSAMPLE;
  const h = HEIGHT * SUPERSAMPLE;
  const target = new WebGLRenderTarget(w, h);
  const scene = new Scene();
  const material = new MeshBasicMaterial({ color: 0xffffff });
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const pixels = new Uint8Array(w * h * 4);
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const fullContext = full.getContext('2d');
  const out = document.createElement('canvas');
  out.width = WIDTH;
  out.height = HEIGHT;
  const outContext = out.getContext('2d');
  if (!fullContext || !outContext) return icons;

  const clearColor = renderer.getClearColor(new Color());
  const clearAlpha = renderer.getClearAlpha();
  const box = new Box3();
  const size = new Vector3();
  const center = new Vector3();
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(target);

  for (const def of defs) {
    const asset = assets.get(def.view.model);
    if (!asset) continue;
    const model = asset.root.clone();
    model.traverse((child) => {
      if ((child as Mesh).isMesh) (child as Mesh).material = material;
    });
    scene.add(model);
    box.setFromObject(model).getSize(size);
    box.getCenter(center);

    // From the gun's right side (+X), so the barrel (-Z) points right; fit its length and height inside the margin.
    const aspect = WIDTH / HEIGHT;
    const half = Math.max(size.z / 2, (size.y / 2) * aspect) / (1 - 2 * MARGIN);
    camera.left = -half;
    camera.right = half;
    camera.top = half / aspect;
    camera.bottom = -half / aspect;
    camera.position.set(center.x + 10, center.y, center.z);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    scene.remove(model);

    // Rows come bottom first. Keep only coverage: pure white wherever the weapon is.
    const image = fullContext.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const from = (h - 1 - y) * w * 4;
      const to = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        image.data[to + x] = 255;
        image.data[to + x + 1] = 255;
        image.data[to + x + 2] = 255;
        image.data[to + x + 3] = pixels[from + x + 3];
      }
    }
    fullContext.putImageData(image, 0, 0);
    outContext.clearRect(0, 0, WIDTH, HEIGHT);
    outContext.imageSmoothingQuality = 'high';
    outContext.drawImage(full, 0, 0, WIDTH, HEIGHT);
    icons.set(def.id, out.toDataURL('image/png'));
  }

  renderer.setRenderTarget(null);
  renderer.setClearColor(clearColor, clearAlpha);
  target.dispose();
  material.dispose();
  return icons;
}
