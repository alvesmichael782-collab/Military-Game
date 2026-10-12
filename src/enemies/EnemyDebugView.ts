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
  type Scene,
} from 'three';
import { config } from '../core/config';
import type { Enemy } from './Enemy';
import type { EnemyManager } from './EnemyManager';

/** Most path line segments drawn at once. */
const MAX_SEGMENTS = 4096;
const PATH_HEIGHT = 0.15;
const LABEL_HEIGHT = 2.25;
const RIFLEMAN_COLOR = [1, 0.85, 0.2] as const;
const SAPPER_COLOR = [1, 0.25, 0.2] as const;
const BREACH_COLOR = 0xff3cff;

/**
 * F4 debug drawing: each enemy's remaining path as a line (yellow riflemen, red sappers), its breach target
 * wall outlined, and its state as a small label above its head. Drawn through walls. Off by default.
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
    const pos = this.positions.array as Float32Array;
    const col = this.colors.array as Float32Array;
    let segments = 0;
    let boxes = 0;
    this.shownWalls.clear();

    this.enemies.enemies.forEach((enemy, index) => {
      const label = this.labels[index];
      if (!enemy.active) {
        label.visible = false;
        return;
      }
      label.visible = true;
      label.material = this.labelMaterial(enemy.label);
      label.position.set(enemy.renderFeet.x, enemy.renderFeet.y + LABEL_HEIGHT, enemy.renderFeet.z);
      if (!enemy.isAlive) return;

      segments = this.drawPath(enemy, pos, col, segments);
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
    this.lines.geometry.setDrawRange(0, segments * 2);
    this.positions.needsUpdate = true;
    this.colors.needsUpdate = true;
  }

  /** The line from the enemy through its remaining waypoints. */
  private drawPath(enemy: Enemy, pos: Float32Array, col: Float32Array, segments: number): number {
    const path = enemy.path;
    const color = enemy.type === 'sapper' ? SAPPER_COLOR : RIFLEMAN_COLOR;
    let x = enemy.renderFeet.x;
    let z = enemy.renderFeet.z;
    for (let k = Math.min(enemy.currentWaypoint, path.length); k < path.length && segments < MAX_SEGMENTS; k++) {
      const o = segments * 6;
      pos[o] = x;
      pos[o + 1] = PATH_HEIGHT;
      pos[o + 2] = z;
      pos[o + 3] = path.xs[k];
      pos[o + 4] = PATH_HEIGHT;
      pos[o + 5] = path.zs[k];
      // Past the breach wall the line dims: that part needs the wall gone first.
      const dim = path.breachIndex >= 0 && k > path.breachIndex ? 0.4 : 1;
      for (let v = 0; v < 2; v++) {
        col[o + v * 3] = color[0] * dim;
        col[o + v * 3 + 1] = color[1] * dim;
        col[o + v * 3 + 2] = color[2] * dim;
      }
      x = path.xs[k];
      z = path.zs[k];
      segments++;
    }
    return segments;
  }

  /** One small text texture per distinct label, made on first use. */
  private labelMaterial(text: string): SpriteMaterial {
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
      g.fillStyle = text.startsWith('SAPPER') ? '#ff8a80' : '#ffe27a';
      g.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
    }
    const texture = new CanvasTexture(canvas);
    texture.magFilter = NearestFilter;
    material = new SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    this.labelMaterials.set(text, material);
    return material;
  }
}
