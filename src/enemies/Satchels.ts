import { BoxGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, Vector3, type Scene } from 'three';
import type { Explosions } from '../combat/Explosion';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';

const CANVAS = 0x76663f;
const STRAP = 0xa48d5e;
const METAL = 0x2b2c2a;
const LED_ON = 0xff2a1a;
const LED_OFF = 0x4a0f0a;
/** Seconds the light stays lit after each beep. */
const BLINK_TIME = 0.09;
/** Blast center above the satchel's base, in meters. */
const BLAST_HEIGHT = 0.2;
const blastCenter = new Vector3();

const shared = {
  bag: new BoxGeometry(0.34, 0.2, 0.16),
  strap: new BoxGeometry(0.04, 0.21, 0.17),
  detonator: new BoxGeometry(0.09, 0.06, 0.06),
  led: new BoxGeometry(0.035, 0.035, 0.035),
  canvas: new MeshLambertMaterial({ color: CANVAS, flatShading: true }),
  strapMaterial: new MeshLambertMaterial({ color: STRAP, flatShading: true }),
  metal: new MeshLambertMaterial({ color: METAL, flatShading: true }),
  ledOn: new MeshBasicMaterial({ color: LED_ON }),
  ledOff: new MeshBasicMaterial({ color: LED_OFF }),
};

class Satchel {
  readonly root = new Object3D();
  readonly position = new Vector3();
  active = false;
  fuse = 0;
  beepTimer = 0;
  blink = 0;
  /** A multiplayer client's copy of the host's satchel: it goes off with no damage (the host's own does the damage). */
  harmless = false;
  /** Bumped each time this pooled satchel is armed, so old handles go stale. */
  generation = 0;
  private readonly led: Mesh;

  constructor(scene: Scene) {
    const bag = new Mesh(shared.bag, shared.canvas);
    bag.position.y = 0.1;
    const strapA = new Mesh(shared.strap, shared.strapMaterial);
    strapA.position.set(0.09, 0.1, 0);
    const strapB = new Mesh(shared.strap, shared.strapMaterial);
    strapB.position.set(-0.09, 0.1, 0);
    const detonator = new Mesh(shared.detonator, shared.metal);
    detonator.position.set(0, 0.23, 0.02);
    this.led = new Mesh(shared.led, shared.ledOff);
    this.led.position.set(0, 0.27, 0.02);
    for (const mesh of [bag, strapA, strapB, detonator]) {
      mesh.castShadow = true;
      this.root.add(mesh);
    }
    this.root.add(this.led);
    this.root.visible = false;
    scene.add(this.root);
  }

  setLit(lit: boolean): void {
    this.led.material = lit ? shared.ledOn : shared.ledOff;
  }
}

/** Refers to one armed satchel; stale once it has gone off. */
export interface SatchelHandle {
  index: number;
  generation: number;
}

/**
 * Pooled satchel charges: a canvas bag with a detonator whose red light blinks with each beep, faster in the
 * last second. When the fuse runs out it calls `explode()` with the satchel's large blast. Satchels are
 * always the enemy's: their damage carries source 'enemy', so kills they cause pay no cash, and they hurt
 * enemies too.
 */
export class Satchels {
  private readonly pool: Satchel[] = [];

  constructor(
    scene: Scene,
    private readonly explosions: Explosions,
    private readonly events: EventBus<GameEvents>,
  ) {
    for (let i = 0; i < config.satchel.maxActive; i++) this.pool.push(new Satchel(scene));
  }

  get activeCount(): number {
    let n = 0;
    for (const s of this.pool) if (s.active) n++;
    return n;
  }

  /**
   * Arm a satchel on the ground at `position`, facing `yaw`. Returns null if every pooled satchel is out.
   * A `harmless` one (a multiplayer client's copy of the host's) blows up with no damage.
   */
  arm(position: Vector3, yaw: number, fuse: number, dropped: boolean, harmless = false): SatchelHandle | null {
    const index = this.pool.findIndex((s) => !s.active);
    if (index < 0) return null;
    const s = this.pool[index];
    s.active = true;
    s.generation++;
    s.fuse = fuse;
    s.harmless = harmless;
    s.beepTimer = 0;
    s.blink = 0;
    s.position.set(position.x, 0, position.z);
    s.root.position.copy(s.position);
    s.root.rotation.set(0, yaw, dropped ? 0.25 : 0);
    s.root.visible = true;
    this.events.emit('satchelArmed', { position: s.position, yaw, fuse, dropped });
    return { index, generation: s.generation };
  }

  /** True while the satchel behind `handle` has yet to go off. */
  isArmed(handle: SatchelHandle | null): boolean {
    if (!handle) return false;
    const s = this.pool[handle.index];
    return s.active && s.generation === handle.generation;
  }

  update(dt: number): void {
    const cfg = config.satchel;
    for (const s of this.pool) {
      if (!s.active) continue;
      s.fuse -= dt;
      s.beepTimer -= dt;
      if (s.beepTimer <= 0) {
        s.beepTimer += s.fuse <= 1 ? cfg.beepIntervalFinal : cfg.beepInterval;
        s.blink = BLINK_TIME;
        this.events.emit('satchelBeep', { position: s.position });
      }
      s.blink -= dt;
      s.setLit(s.blink > 0);
      if (s.fuse <= 0) this.detonate(s);
    }
  }

  private detonate(s: Satchel): void {
    const cfg = config.satchel;
    s.active = false;
    s.root.visible = false;
    s.setLit(false);
    blastCenter.copy(s.position).setY(BLAST_HEIGHT);
    // Can chain: the blast may kill a sapper whose dropped satchel arms in this same pool.
    this.explosions.explode(blastCenter, cfg.radius, cfg.damage, 'enemy', {
      kind: 'satchel',
      fullDamageRadius: cfg.fullDamageRadius,
      harmless: s.harmless,
    });
  }
}
