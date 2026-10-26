import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3, type Scene } from 'three';
import type { Explosions } from '../combat/Explosion';
import { config } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';

const STREAK_COLOR = 0x24211d;
/** Length and thickness of the falling streak, in meters. */
const STREAK_LENGTH = 3.2;
const STREAK_WIDTH = 0.09;
/** Blast center above the impact point, in meters. */
const BLAST_HEIGHT = 0.25;
const FORWARD = new Vector3(0, 0, 1);

const streakGeometry = new BoxGeometry(STREAK_WIDTH, STREAK_WIDTH, STREAK_LENGTH).translate(0, 0, -STREAK_LENGTH / 2);
const streakMaterial = new MeshBasicMaterial({ color: STREAK_COLOR, transparent: true, opacity: 0.75, depthWrite: false });

class Shell {
  active = false;
  readonly from = new Vector3();
  readonly impact = new Vector3();
  flightTime = 0;
  time = 0;
  whistled = false;
  /** A multiplayer client's copy of the host's shell: sounds and effects only, the host's own does the damage. */
  harmless = false;
  readonly streak: Mesh;

  constructor(scene: Scene) {
    this.streak = new Mesh(streakGeometry, streakMaterial);
    this.streak.visible = false;
    this.streak.frustumCulled = false;
    scene.add(this.streak);
  }
}

/**
 * Pooled mortar shells in flight. A shell has no body: it is a launch point, an impact point and a flight time.
 * Firing one sends `mortarFired` (the launch thump at the mortar); `whistleLead` seconds before it lands it sends
 * `mortarWhistle` at the impact point (the players' warning, every time); in its last `streakTime` seconds a dark
 * streak falls along its arc; then it calls `explode()` there with source 'enemy', so it hurts players, walls,
 * structures and enemies like any blast.
 */
export class MortarShells {
  private readonly pool: Shell[] = [];
  private readonly point = new Vector3();
  private readonly direction = new Vector3();

  constructor(
    scene: Scene,
    private readonly explosions: Explosions,
    private readonly events: EventBus<GameEvents>,
  ) {
    for (let i = 0; i < config.mortar.shell.maxActive; i++) this.pool.push(new Shell(scene));
  }

  get activeCount(): number {
    let n = 0;
    for (const s of this.pool) if (s.active) n++;
    return n;
  }

  /**
   * Fire a shell from `from` to land on `impact` in `flightTime` seconds. Returns false if every pooled shell is in the
   * air. A `harmless` one (a multiplayer client's copy of the host's) blows up with no damage.
   */
  fire(from: Vector3, impact: Vector3, flightTime: number, harmless = false): boolean {
    const s = this.pool.find((shell) => !shell.active);
    if (!s) return false;
    s.active = true;
    s.from.copy(from);
    s.impact.copy(impact);
    s.flightTime = Math.max(0.1, flightTime);
    s.time = 0;
    s.whistled = false;
    s.harmless = harmless;
    this.events.emit('mortarFired', { position: s.from, impact: s.impact, flightTime: s.flightTime });
    return true;
  }

  update(dt: number): void {
    const c = config.mortar.shell;
    for (const s of this.pool) {
      if (!s.active) continue;
      s.time += dt;
      const left = s.flightTime - s.time;
      if (!s.whistled && left <= c.whistleLead) {
        s.whistled = true;
        this.events.emit('mortarWhistle', { position: s.impact });
      }
      if (left <= 0) {
        s.active = false;
        s.streak.visible = false;
        this.point.copy(s.impact).setY(s.impact.y + BLAST_HEIGHT);
        this.explosions.explode(this.point, c.radius, c.damage, 'enemy', {
          kind: 'mortar',
          fullDamageRadius: c.fullDamageRadius,
          harmless: s.harmless,
        });
        continue;
      }
      s.streak.visible = left <= c.streakTime;
      if (s.streak.visible) this.placeStreak(s);
    }
  }

  /** The streak's head where the shell is on its arc now, pointing the way it flies. */
  private placeStreak(s: Shell): void {
    const h = config.mortar.shell.apexHeight;
    const u = Math.min(1, s.time / s.flightTime);
    this.point.lerpVectors(s.from, s.impact, u);
    this.point.y += 4 * h * u * (1 - u);
    this.direction.subVectors(s.impact, s.from);
    this.direction.y += 4 * h * (1 - 2 * u);
    this.direction.normalize();
    s.streak.position.copy(this.point);
    s.streak.quaternion.setFromUnitVectors(FORWARD, this.direction);
  }
}
