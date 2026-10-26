import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  EdgesGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  NearestFilter,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Scene,
} from 'three';
import { config } from '../core/config';
import type { Enemy } from './Enemy';
import type { EnemyManager } from './EnemyManager';
import type { EnemyType } from './EnemyType';
import { Grenadier } from './Grenadier';
import { MortarTeam } from './MortarTeam';

/** Most path line segments drawn at once. */
const MAX_SEGMENTS = 4096;
const PATH_HEIGHT = 0.15;
const LABEL_HEIGHT = 2.25;
type Rgb = readonly [number, number, number];
/** Path (and label) color per type: yellow riflemen, red sappers, orange grenadiers, cyan mortar teams. */
const TYPE_COLORS: Record<EnemyType, Rgb> = {
  rifleman: [1, 0.85, 0.2],
  sapper: [1, 0.25, 0.2],
  grenadier: [1, 0.55, 0.15],
  mortar: [0.3, 0.9, 1],
};
const LABEL_COLORS: Record<EnemyType, string> = { rifleman: '#ffe27a', sapper: '#ff8a80', grenadier: '#ffb066', mortar: '#8ae6ff' };
const BREACH_COLOR = 0xff3cff;
/** Grenade arcs, throw targets and mortar targets: white; the mortar's accuracy circle: pink; its firing spot: green. */
const ARC_COLOR: Rgb = [1, 1, 1];
const CIRCLE_COLOR: Rgb = [1, 0.45, 0.75];
const SPOT_COLOR: Rgb = [0.35, 1, 0.45];
/** Seconds per segment of a drawn grenade arc, and the most segments drawn. */
const ARC_STEP = 0.06;
const ARC_MAX_STEPS = 60;
const CIRCLE_SEGMENTS = 24;
/** Half the size of a target cross, in meters. */
const CROSS = 0.6;
const arcPoint = new Vector3();
const arcLast = new Vector3();

/**
 * F4 debug drawing: each enemy's remaining path as a line (yellow riflemen, red sappers, orange grenadiers, cyan
 * mortar teams), its breach target wall outlined, and its state as a small label above its head. Grenadiers show
 * their throw target (a cross, from the wind-up) and the grenade's arc after the release; mortar teams show their
 * firing spot (green), their current target (a cross) and the circle the next shell can land in. Drawn through
 * walls. Off by default.
 */
export class EnemyDebugView {
  private visible = false;
  private readonly lines: LineSegments;
  private readonly positions: Float32BufferAttribute;
  private readonly colors: Float32BufferAttribute;
  private readonly outlines: LineSegments[] = [];
  private readonly labels: Sprite[] = [];
  private readonly labelMaterials = new Map<string, SpriteMaterial>();
  private readonly shownWalls = new Set<number>();
  /** Line segments written so far this frame. */
  private segments = 0;

  constructor(
    scene: Scene,
    private readonly enemies: EnemyManager,
  ) {
    const geometry = new BufferGeometry();
    this.positions = new Float32BufferAttribute(new Float32Array(MAX_SEGMENTS * 6), 3);
    this.colors = new Float32BufferAttribute(new Float32Array(MAX_SEGMENTS * 6), 3);
    this.positions.setUsage(DynamicDrawUsage);
    this.colors.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('color', this.colors);
    this.lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
    scene.add(this.lines);

    const w = config.structures.wall;
    const outline = new EdgesGeometry(new BoxGeometry(config.build.cellSize + 0.1, w.height + 0.1, w.thickness + w.lipWidth * 2 + 0.1));
    outline.translate(0, (w.height + 0.1) / 2, 0);
    const outlineMaterial = new LineBasicMaterial({ color: BREACH_COLOR, depthTest: false, transparent: true });
    const count = enemies.enemies.length;
    for (let i = 0; i < count; i++) {
      const box = new LineSegments(outline, outlineMaterial);
      box.visible = false;
      box.renderOrder = 10;
      scene.add(box);
      this.outlines.push(box);
      const label = new Sprite();
      label.visible = false;
      label.scale.set(1.8, 0.3, 1);
      label.renderOrder = 11;
      scene.add(label);
      this.labels.push(label);
    }
  }

  toggle(): void {
    this.visible = !this.visible;
    this.lines.visible = this.visible;
    if (!this.visible) {
      for (const box of this.outlines) box.visible = false;
      for (const label of this.labels) label.visible = false;
    }
  }

  /** Redraw. Call once per rendered frame, after the enemies have been posed. */
  update(): void {
    if (!this.visible) return;
    this.segments = 0;
    let boxes = 0;
    this.shownWalls.clear();

    this.enemies.enemies.forEach((enemy, index) => {
      const label = this.labels[index];
      if (!enemy.active) {
        label.visible = false;
        return;
      }
      label.visible = true;
      label.material = this.labelMaterial(enemy.label, enemy.type);
      label.position.set(enemy.renderFeet.x, enemy.renderFeet.y + LABEL_HEIGHT, enemy.renderFeet.z);
      if (!enemy.isAlive) return;

      this.drawPath(enemy);
      if (enemy instanceof Grenadier) this.drawThrow(enemy);
      else if (enemy instanceof MortarTeam) this.drawMortar(enemy);
      const wallId = enemy.breachWallId;
      if (wallId && !this.shownWalls.has(wallId)) {
        const wall = this.enemies.wall(wallId);
        if (wall) {
          this.shownWalls.add(wallId);
          const box = this.outlines[boxes++];
          box.visible = true;
          box.position.copy(wall.base);
          box.rotation.set(0, wall.yaw, 0);
        }
      }
    });
    for (let i = boxes; i < this.outlines.length; i++) this.outlines[i].visible = false;
    this.lines.geometry.setDrawRange(0, this.segments * 2);
    this.positions.needsUpdate = true;
    this.colors.needsUpdate = true;
  }

  /** The line from the enemy through its remaining waypoints. */
  private drawPath(enemy: Enemy): void {
    const path = enemy.path;
    const color = TYPE_COLORS[enemy.type];
    let x = enemy.renderFeet.x;
    let z = enemy.renderFeet.z;
    for (let k = Math.min(enemy.currentWaypoint, path.length); k < path.length; k++) {
      // Past the breach wall the line dims: that part needs the wall gone first.
      const dim = path.breachIndex >= 0 && k > path.breachIndex ? 0.4 : 1;
      this.segment(x, PATH_HEIGHT, z, path.xs[k], PATH_HEIGHT, path.zs[k], color, dim);
      x = path.xs[k];
      z = path.zs[k];
    }
  }

  /** The throw target while winding up; after the release, the grenade's damped arc to it. */
  private drawThrow(g: Grenadier): void {
    if (!g.throwing && !g.showArc) return;
    this.cross(g.throwLanding, ARC_COLOR);
    this.cross(g.throwAim, CIRCLE_COLOR, 0.5);
    if (!g.showArc) {
      this.segment(g.renderFeet.x, 1.9, g.renderFeet.z, g.throwLanding.x, PATH_HEIGHT, g.throwLanding.z, ARC_COLOR, 0.35);
      return;
    }
    const c = config.grenade.linearDamping;
    const gravity = -config.physics.gravity;
    const v = g.throwVelocity;
    arcLast.copy(g.throwFrom);
    for (let n = 1; n <= ARC_MAX_STEPS; n++) {
      const t = n * ARC_STEP;
      const k = c > 1e-4 ? (1 - Math.exp(-c * t)) / c : t;
      const y = c > 1e-4 ? (v.y + gravity / c) * k - (gravity * t) / c : v.y * t - 0.5 * gravity * t * t;
      arcPoint.set(g.throwFrom.x + v.x * k, g.throwFrom.y + y, g.throwFrom.z + v.z * k);
      this.segment(arcLast.x, arcLast.y, arcLast.z, arcPoint.x, arcPoint.y, arcPoint.z, ARC_COLOR);
      arcLast.copy(arcPoint);
      if (arcPoint.y <= g.throwLanding.y) break;
    }
  }

  /** The firing spot, the target, a line to it and the circle the next shell can land in. */
  private drawMortar(m: MortarTeam): void {
    if (m.hasFirePosition) {
      const p = m.firePosition;
      this.cross(p, SPOT_COLOR);
      this.circle(p.x, p.z, 0.9, SPOT_COLOR);
    }
    if (!m.hasTarget) return;
    const t = m.target;
    this.cross(t, ARC_COLOR);
    this.circle(t.x, t.z, m.nextError, CIRCLE_COLOR);
    this.segment(m.renderFeet.x, 1, m.renderFeet.z, t.x, PATH_HEIGHT, t.z, CIRCLE_COLOR, 0.5);
  }

  private cross(p: Vector3, color: Rgb, scale = 1): void {
    const r = CROSS * scale;
    this.segment(p.x - r, PATH_HEIGHT, p.z - r, p.x + r, PATH_HEIGHT, p.z + r, color);
    this.segment(p.x - r, PATH_HEIGHT, p.z + r, p.x + r, PATH_HEIGHT, p.z - r, color);
  }

  private circle(x: number, z: number, radius: number, color: Rgb): void {
    for (let n = 0; n < CIRCLE_SEGMENTS; n++) {
      const a = (n / CIRCLE_SEGMENTS) * Math.PI * 2;
      const b = ((n + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
      this.segment(x + Math.cos(a) * radius, PATH_HEIGHT, z + Math.sin(a) * radius, x + Math.cos(b) * radius, PATH_HEIGHT, z + Math.sin(b) * radius, color);
    }
  }

  /** One line segment in `color`, dimmed by `dim`, unless the buffer is full. */
  private segment(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: Rgb, dim = 1): void {
    if (this.segments >= MAX_SEGMENTS) return;
    const pos = this.positions.array as Float32Array;
    const col = this.colors.array as Float32Array;
    const o = this.segments * 6;
    pos[o] = x1;
    pos[o + 1] = y1;
    pos[o + 2] = z1;
    pos[o + 3] = x2;
    pos[o + 4] = y2;
    pos[o + 5] = z2;
    for (let v = 0; v < 2; v++) {
      col[o + v * 3] = color[0] * dim;
      col[o + v * 3 + 1] = color[1] * dim;
      col[o + v * 3 + 2] = color[2] * dim;
    }
    this.segments++;
  }

  /** One small text texture per distinct label, made on first use. */
  private labelMaterial(text: string, type: EnemyType): SpriteMaterial {
    let material = this.labelMaterials.get(text);
    if (material) return material;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 40;
    const g = canvas.getContext('2d');
    if (g) {
      g.fillStyle = 'rgba(0, 0, 0, 0.55)';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.font = 'bold 22px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = LABEL_COLORS[type];
      g.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
    }
    const texture = new CanvasTexture(canvas);
    texture.magFilter = NearestFilter;
    material = new SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    this.labelMaterials.set(text, material);
    return material;
  }
}
