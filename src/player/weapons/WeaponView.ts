import { Euler, Vector3, type Object3D } from 'three';
import { adsPoseOf, type AdsPose } from './AdsPose';
import type { WeaponDef } from './defs/WeaponDef';
import type { MagazineRig } from './ReloadAnimation';
import type { WeaponAsset } from './WeaponAssets';

/**
 * One weapon as the view model draws it: its own copy of the model, the parts that move on their own, where the
 * muzzle (or blade tip) is, and its hip and aimed poses.
 */
export class WeaponView {
  readonly model: Object3D;
  /** The separate magazine mesh, if the model has one. Its origin is the center of its top; its loaded transform is seated. */
  readonly magazine: Object3D | null;
  /** The separate slide, if the model has one, and its forward (rest) position. */
  readonly slide: Object3D | null;
  readonly slideRest: Vector3;
  /** Where the magazine is seated and which way it leaves the well (a stand-in point for guns without a magazine mesh). */
  readonly magazineRig: MagazineRig | null;
  readonly marker: Vector3;
  readonly hipPosition: Vector3;
  readonly hipRotation: Euler;
  /** Null for weapons that cannot aim down sights. */
  readonly ads: AdsPose | null;

  constructor(
    readonly def: WeaponDef,
    asset: WeaponAsset,
  ) {
    this.model = asset.root.clone();
    this.model.name = `view.${def.id}`;
    this.marker = asset.marker.clone();
    this.magazine = this.model.getObjectByName('magazine') ?? null;
    this.slide = this.model.getObjectByName('slide') ?? null;
    this.slideRest = this.slide ? this.slide.position.clone() : new Vector3();
    const p = def.view.position;
    const r = def.view.rotation;
    this.hipPosition = new Vector3(p.x, p.y, p.z);
    this.hipRotation = new Euler(r.x, r.y, r.z);

    if (def.slot === 'gun') {
      this.ads = adsPoseOf(def.ads);
      const reload = def.reload;
      if (reload.kind === 'magazine') {
        const well = reload.magazineWell;
        const rest = this.magazine ? this.magazine.position.clone() : new Vector3(well?.x ?? 0, well?.y ?? 0, well?.z ?? 0);
        const a = reload.magazineAxis;
        this.magazineRig = { rest, axis: new Vector3(a.x, a.y, a.z).normalize() };
      } else {
        this.magazineRig = null;
      }
    } else {
      this.ads = null;
      this.magazineRig = null;
    }
  }
}
