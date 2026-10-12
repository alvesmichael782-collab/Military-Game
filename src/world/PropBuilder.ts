import RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildGrid } from './BuildGrid';
import { tagSurface, type SurfaceType } from './Surfaces';

/** Options for one piece of a prop, in the prop's own frame (set by `at`). */
export interface PieceOptions {
  /** Turn of the piece, in radians. */
  rx?: number;
  ry?: number;
  rz?: number;
  /**
   * Texture mapping: a number maps the texture by position, one repeat per that many meters, so neighbouring
   * pieces line up (walls, slabs); 'native' keeps the geometry's own UVs (cylinders, crate faces).
   */
  uv?: number | 'native';
  /** Color multiplier baked into the vertex colors (1 is the texture as painted). */
  tint?: number | readonly [number, number, number];
  /** Darken toward the ground (fake ambient occlusion). On by default. */
  ao?: boolean;
  /** A box collider matching the piece, with this surface. Off by default. */
  collide?: SurfaceType;
}

/** A repeated prop drawn with one instanced mesh: its shared geometry (with vertex colors) and material. */
export interface InstanceKind {
  readonly name: string;
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

/** Placement of one instance, in the prop's frame. */
export interface InstanceOptions {
  rx?: number;
  ry?: number;
  rz?: number;
  scale?: number | readonly [number, number, number];
  /** Per-instance color multiplier. */
  color?: number;
}

interface ColliderSpec {
  desc: RAPIER.ColliderDesc;
  surface: SurfaceType | null;
}

/** Height over which ground occlusion fades out, and how dark it is at the ground. */
const AO_HEIGHT = 1.4;
const AO_GROUND = 0.58;
/** Inside corners listed with `corner` darken vertices within this radius, down to this shade. */
const CORNER_RADIUS = 1.3;
const CORNER_SHADE = 0.72;

const WIRE_COLOR = 0x2a2622;

const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpEuler = new Euler();
const tmpVec = new Vector3();
const tmpNormal = new Vector3();
const ONE = new Vector3(1, 1, 1);

/**
 * Collects static map props into as few draws as possible: every piece using the same material is merged into one
 * mesh. Pieces get position-based UVs (so plaster runs on across a wall broken by a window) and vertex colors
 * darkened at the ground and in listed corners as fake ambient occlusion. Also gathers box colliders, tagged with
 * their surface, and the footprints to block on the build grid so enemy routes go around the props.
 */
export class PropBuilder {
  private readonly parts = new Map<Material, BufferGeometry[]>();
  private readonly colliders: ColliderSpec[] = [];
  private readonly footprints: { x: number; z: number; hx: number; hz: number }[] = [];
  private readonly frame = new Matrix4();
  private yaw = 0;
  private origin = new Vector3();
  private corners: [number, number][] = [];
  /** Wire segments as pairs of points, in the world. */
  private readonly wires: number[] = [];
  private readonly instances = new Map<InstanceKind, { matrices: Matrix4[]; colors: Color[] }>();

  /** Start a prop at (x, z) on the ground, turned by `yaw`. Following calls use its frame. */
  at(x: number, z: number, yaw = 0): this {
    this.origin.set(x, 0, z);
    this.yaw = yaw;
    this.frame.compose(this.origin, tmpQuat.setFromAxisAngle(tmpVec.set(0, 1, 0), yaw), ONE);
    this.corners = [];
    return this;
  }

  /** Inside corners of the current prop (in its frame) that collect shadow. */
  corner(x: number, z: number): this {
    this.corners.push([x, z]);
    return this;
  }

  /** A box centered at (x, y, z) in the prop's frame. */
  box(material: Material, w: number, h: number, d: number, x: number, y: number, z: number, o: PieceOptions = {}): this {
    this.piece(material, new BoxGeometry(w, h, d), x, y, z, o);
    if (o.collide) this.collider(w / 2, h / 2, d / 2, x, y, z, o.ry ?? 0, o.collide);
    return this;
  }

  /** A cylinder (along Y unless turned) centered at (x, y, z). Collides as a box around it if asked. */
  cylinder(material: Material, rTop: number, rBottom: number, h: number, sides: number, x: number, y: number, z: number, o: PieceOptions = {}): this {
    this.piece(material, new CylinderGeometry(rTop, rBottom, h, sides), x, y, z, { uv: 'native', ...o, collide: undefined });
    if (o.collide) {
      const r = Math.max(rTop, rBottom);
      this.colliderDesc(RAPIER.ColliderDesc.cylinder(h / 2, r), x, y, z, o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, o.collide);
    }
    return this;
  }

  /** Any geometry, placed at (x, y, z) in the prop's frame. Takes ownership of it. */
  piece(material: Material, geometry: BufferGeometry, x: number, y: number, z: number, o: PieceOptions = {}): this {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    tmpEuler.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    tmpMatrix.compose(tmpVec.set(x, y, z), tmpQuat.setFromEuler(tmpEuler), ONE);
    g.applyMatrix4(tmpMatrix);
    if (o.uv !== 'native') planarUv(g, o.uv ?? 2);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    this.paint(g, o);
    g.applyMatrix4(this.frame);
    g = keepStandardAttributes(g);
    let list = this.parts.get(material);
    if (!list) this.parts.set(material, (list = []));
    list.push(g);
    return this;
  }

  /** A thin wire through `points` (x, y, z in the prop's frame), drawn as one-pixel lines. */
  wire(points: readonly [number, number, number][]): this {
    for (let k = 0; k < points.length - 1; k++) {
      for (const p of [points[k], points[k + 1]]) {
        tmpVec.set(p[0], p[1], p[2]).applyMatrix4(this.frame);
        this.wires.push(tmpVec.x, tmpVec.y, tmpVec.z);
      }
    }
    return this;
  }

  /** One copy of a repeated prop at (x, y, z) in the prop's frame. */
  instance(kind: InstanceKind, x: number, y: number, z: number, o: InstanceOptions = {}): this {
    let list = this.instances.get(kind);
    if (!list) this.instances.set(kind, (list = { matrices: [], colors: [] }));
    const sc = o.scale ?? 1;
    tmpEuler.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ');
    const local = new Matrix4().compose(
      tmpVec.set(x, y, z),
      tmpQuat.setFromEuler(tmpEuler),
      typeof sc === 'number' ? new Vector3(sc, sc, sc) : new Vector3(sc[0], sc[1], sc[2]),
    );
    list.matrices.push(local.premultiply(this.frame));
    list.colors.push(new Color(o.color ?? 0xffffff));
    return this;
  }

  /** A cylinder collider (upright unless turned) centered at (x, y, z) in the prop's frame. */
  cylinderCollider(halfHeight: number, radius: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, surface: SurfaceType): this {
    return this.colliderDesc(RAPIER.ColliderDesc.cylinder(halfHeight, radius), x, y, z, rx, ry, rz, surface);
  }

  /** A box collider centered at (x, y, z) in the prop's frame, turned by `ry`. */
  collider(hx: number, hy: number, hz: number, x: number, y: number, z: number, ry: number, surface: SurfaceType | null, groups?: number): this {
    return this.colliderDesc(RAPIER.ColliderDesc.cuboid(hx, hy, hz), x, y, z, 0, ry, 0, surface, groups);
  }

  /** Block the build grid under a rectangle of half sizes (hx, hz) centered at (x, z) in the prop's frame. */
  block(hx: number, hz: number, x = 0, z = 0): this {
    // The world-aligned box around the turned rectangle.
    const c = Math.abs(Math.cos(this.yaw));
    const s = Math.abs(Math.sin(this.yaw));
    tmpVec.set(x, 0, z).applyMatrix4(this.frame);
    this.footprints.push({ x: tmpVec.x, z: tmpVec.z, hx: hx * c + hz * s, hz: hx * s + hz * c });
    return this;
  }

  /** Merge into meshes, add the colliders to one fixed body and block the grid. */
  build(scene: Scene, world: RAPIER.World, grid: BuildGrid, name: string): void {
    this.buildMeshes(scene, name);
    this.buildPhysics(world, grid);
  }

  /** Only the meshes, added to `parent`: for a model whose owner makes its own colliders. */
  buildMeshes(parent: Object3D, name: string): void {
    for (const [material, list] of this.parts) {
      const merged = mergeGeometries(list);
      for (const g of list) g.dispose();
      if (!merged) throw new Error(`Prop merge failed for ${name}`);
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, material);
      mesh.name = `${name}.${material.name || 'part'}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    for (const [kind, list] of this.instances) {
      const mesh = new InstancedMesh(kind.geometry, kind.material, list.matrices.length);
      mesh.name = `${name}.${kind.name}`;
      list.matrices.forEach((m, k) => {
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, list.colors[k]);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    if (this.wires.length > 0) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(this.wires, 3));
      const lines = new LineSegments(geometry, new LineBasicMaterial({ color: WIRE_COLOR }));
      lines.name = `${name}.wires`;
      parent.add(lines);
    }
  }

  /** The colliders, on one fixed body, and the blocked grid cells. */
  buildPhysics(world: RAPIER.World, grid: BuildGrid): void {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const spec of this.colliders) {
      const collider = world.createCollider(spec.desc, body);
      if (spec.surface) tagSurface(collider, spec.surface);
    }
    for (const f of this.footprints) grid.blockArea(tmpVec.set(f.x, 0, f.z), f.hx, f.hz);
  }

  private colliderDesc(
    desc: RAPIER.ColliderDesc,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    surface: SurfaceType | null,
    groups?: number,
  ): this {
    tmpVec.set(x, y, z).applyMatrix4(this.frame);
    tmpEuler.set(rx, ry + this.yaw, rz, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    desc.setTranslation(tmpVec.x, tmpVec.y, tmpVec.z).setRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w });
    if (groups !== undefined) desc.setCollisionGroups(groups);
    this.colliders.push({ desc, surface });
    return this;
  }

  /** Vertex colors: the tint, darkened toward the ground and into the listed corners. */
  private paint(g: BufferGeometry, o: PieceOptions): void {
    const tint = typeof o.tint === 'number' ? [o.tint, o.tint, o.tint] : (o.tint ?? [1, 1, 1]);
    const positions = g.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      let shade = o.ao === false ? 1 : AO_GROUND + (1 - AO_GROUND) * Math.sqrt(Math.min(1, Math.max(0, y / AO_HEIGHT)));
      for (const [cx, cz] of this.corners) {
        const d = Math.hypot(positions.getX(i) - cx, positions.getZ(i) - cz);
        if (d < CORNER_RADIUS) shade *= CORNER_SHADE + (1 - CORNER_SHADE) * (d / CORNER_RADIUS);
      }
      colors[i * 3] = tint[0] * shade;
      colors[i * 3 + 1] = tint[1] * shade;
      colors[i * 3 + 2] = tint[2] * shade;
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }
}

/**
 * Bake ground occlusion into a repeated prop's own geometry (its frame, feet at y = 0) as vertex colors, times
 * `tint`. For instance kinds, whose copies all share it.
 */
export function shadeKind(g: BufferGeometry, tint = 1, groundShade = AO_GROUND, height = AO_HEIGHT): BufferGeometry {
  const positions = g.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const shade = tint * (groundShade + (1 - groundShade) * Math.sqrt(Math.min(1, Math.max(0, positions.getY(i) / height))));
    colors.fill(shade, i * 3, i * 3 + 3);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

/**
 * Texture coordinates from position, one repeat per `tile` meters: side faces use height for v and the
 * horizontal run of the face for u; up- and down-facing faces use x and z.
 */
function planarUv(g: BufferGeometry, tile: number): void {
  const positions = g.getAttribute('position');
  const normals = g.getAttribute('normal');
  const uvs = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    tmpNormal.fromBufferAttribute(normals, i);
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    let u: number;
    let v: number;
    if (Math.abs(tmpNormal.y) > 0.7) {
      u = x;
      v = z;
    } else if (Math.abs(tmpNormal.x) > Math.abs(tmpNormal.z)) {
      u = tmpNormal.x > 0 ? -z : z;
      v = y;
    } else {
      u = tmpNormal.z > 0 ? x : -x;
      v = y;
    }
    uvs[i * 2] = u / tile;
    uvs[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
}

/** Position, normal, uv and color only, so every piece merges with every other. */
function keepStandardAttributes(g: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
  }
  g.clearGroups();
  return g;
}
