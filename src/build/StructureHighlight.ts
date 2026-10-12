import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Object3D, type Scene } from 'three';
import type { Structure } from './Structure';

const COLOR = 0xffe9b0;
/** Grow the box a little so it sits just outside the structure's faces. */
const PADDING = 0.06;

/**
 * Marks the structure the build tool would remove: a faint warm box with a crisp outline.
 * Reads the same on lit and shaded faces, and for walls and the nest alike.
 */
export class StructureHighlight {
  private readonly root = new Object3D();

  constructor(scene: Scene) {
    const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const fill = new Mesh(box, new MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.16, depthWrite: false, fog: false }));
    const edges = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: COLOR, transparent: true, opacity: 0.9, fog: false }));
    fill.renderOrder = 2;
    edges.renderOrder = 3;
    this.root.add(fill, edges);
    this.root.visible = false;
    this.root.name = 'structureHighlight';
    scene.add(this.root);
  }

  show(structure: Structure): void {
    this.root.position.copy(structure.base);
    this.root.rotation.y = structure.yaw;
    this.root.scale.set(structure.size.x + PADDING, structure.size.y + PADDING / 2, structure.size.z + PADDING);
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }
}
