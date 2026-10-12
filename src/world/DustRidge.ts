import RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
  type Scene,
} from 'three';
import { Groups } from '../core/CollisionGroups';
import { config } from '../core/config';
import { createSandTexture, createTireTrackTexture } from './GroundTextures';
import { createRandom } from './random';
import { createSky } from './Sky';
import { tagSurface } from './Surfaces';
import { smoothstep, tileFbm, tileNoise } from './TextureKit';

/** Ground extends far past the play area so it fades into the fog and the ridges instead of ending. */
const GROUND_EXTENT = 1280;
/**
 * Ground grid lines: every `GROUND_FINE_STEP` meters out to `GROUND_FINE_HALF` from the center (enough
 * vertices for the vertex-color patches over the play area), then farther and farther apart toward the edge.
 */
const GROUND_FINE_STEP = 5;
const GROUND_FINE_HALF = 150;
const GROUND_OUTER_LINES = [162, 178, 198, 222, 252, 290, 336, 392, 460, 545, 640];
/** The sand texture repeats every this many meters. */
const GROUND_TILE = 8;
/** Large-patch tints over the sand texture (multiplied with it). */
const GROUND_PALE = 0xfff4e4;
const GROUND_HARDPAN = 0xd8bfa0;
const GROUND_GRAVEL = 0xbcb2a4;
/** Tire tracks: ribbon width, sample spacing and texture repeat along it, in meters; how far short of the core they stop; lift off the ground. */
const TRACK_WIDTH = 2.6;
const TRACK_STEP = 1.5;
const TRACK_TILE = 4;
const TRACK_STOP = 30;
const TRACK_LIFT = 0.01;
const BERM_HEIGHT = 1.2;
const BERM_WIDTH = 3;
const ROCK_COUNT = 140;
/** Large and small rocks inside the play area. These are solid. */
const FIELD_ROCK_COUNT = 10;
const FIELD_PEBBLE_COUNT = 8;
/** Keep the outpost area clear of rocks, in meters from the core. */
const FIELD_CLEAR_RADIUS = 25;
/** Keep the spawn pads clear of rocks, in meters. */
const SPAWN_CLEAR_RADIUS = 12;
const SEED = 1337;
const LEGACY_GROUND_DRAWS = 61 * 61;

const BERM_COLOR = 0xb98f5a;
const ROCK_COLOR = 0xa98d6a;
const SPAWN_PAD_COLOR = 0xc0392b;
const SPAWN_POLE_COLOR = 0x5a4632;

/** A large solid rock inside the play area, as a rough footprint for the walking grid. */
export interface MapObstacle {
  center: Vector3;
  /** Half the footprint's side, in meters. */
  halfSize: number;
}

export interface DustRidgeMap {
  /** Enemy spawn points on the ground plane. */
  spawnPoints: Vector3[];
  /** Large rocks inside the play area. Pebbles are left out: walkers slide past them. */
  obstacles: MapObstacle[];
}

/**
 * Dust Ridge: flat 200 x 200 m desert with a berm around the edge,
 * rock ridges outside the play area and two marked enemy spawns.
 */
export function createDustRidge(scene: Scene, world: RAPIER.World): DustRidgeMap {
  const random = createRandom(SEED);
  const half = config.map.size / 2;

  createSky(scene);
  scene.add(createGround(createRandom(SEED + 1), half));
  // The ground used to draw one number per vertex of a 60 x 60 grid from this sequence; skip as many so every
  // rock stays exactly where it always was.
  for (let k = 0; k < LEGACY_GROUND_DRAWS; k++) random();
  createGroundCollider(world);

  for (const berm of createBerms(half)) scene.add(berm);
  createBoundaryColliders(world, half);

  scene.add(createRocks(random, half));

  const spawnPoints = config.map.spawnPoints.map((p) => new Vector3(p.x, 0, p.z));
  const core = new Vector3(config.map.corePosition.x, 0, config.map.corePosition.z);
  scene.add(createTracks(createRandom(SEED + 2), spawnPoints, core));
  const obstacles: MapObstacle[] = [];
  scene.add(createFieldRocks(random, half, spawnPoints, world, obstacles));
  for (const point of spawnPoints) scene.add(createSpawnMarker(point));

  return { spawnPoints, obstacles };
}

/** Ground grid line positions along one axis, from -GROUND_EXTENT / 2 to +GROUND_EXTENT / 2. */
function groundLines(): number[] {
  const half: number[] = [];
  for (let d = 0; d <= GROUND_FINE_HALF; d += GROUND_FINE_STEP) half.push(d);
  half.push(...GROUND_OUTER_LINES);
  return [...half.slice(1).reverse().map((d) => -d), ...half];
}

/**
 * One large plane with the tiling sand-and-gravel texture. Vertex colors lay large patches over it (paler
 * windblown sand, darker hardpan, gravel flats) so the tiling never shows, and fade it a little darker outside
 * the play area.
 */
function createGround(random: () => number, half: number): Mesh {
  const lines = groundLines();
  const segments = lines.length - 1;
  const geometry = new PlaneGeometry(1, 1, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  // Move the even grid onto the ground lines. Texture coordinates in meters / tile size, so the texture
  // repeats every `GROUND_TILE` meters.
  const uv = geometry.getAttribute('uv');
  const grid = geometry.getAttribute('position');
  for (let i = 0; i < grid.count; i++) {
    const x = lines[Math.round((grid.getX(i) + 0.5) * segments)];
    const z = lines[Math.round((grid.getZ(i) + 0.5) * segments)];
    grid.setX(i, x);
    grid.setZ(i, z);
    uv.setXY(i, (x + GROUND_EXTENT / 2) / GROUND_TILE, (GROUND_EXTENT / 2 - z) / GROUND_TILE);
  }
  geometry.computeBoundingSphere();

  const noise = tileNoise(4242);
  const pale = new Color(GROUND_PALE);
  const hardpan = new Color(GROUND_HARDPAN);
  const gravel = new Color(GROUND_GRAVEL);
  const tint = new Color();
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    // Noise over a 1,280 m period: patches tens of meters across, with smaller blotches inside them.
    const broad = tileFbm(noise, x + 640, z + 640, 1280, 24, 3);
    const blotch = tileFbm(noise, x + 1000, z + 300, 1280, 96, 2);
    tint.setRGB(1, 1, 1);
    tint.lerp(pale, smoothstep(0.55, 0.75, broad) * 0.85);
    tint.lerp(hardpan, smoothstep(0.45, 0.25, broad) * 0.7);
    tint.lerp(gravel, smoothstep(0.62, 0.78, blotch) * 0.6);
    const outside = Math.max(Math.abs(x), Math.abs(z)) - half;
    tint.multiplyScalar(1 - smoothstep(0, 60, outside) * 0.08 + (random() - 0.5) * 0.03);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const texture = createSandTexture();
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ map: texture, vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

/**
 * Tire tracks from each spawn point in toward the outpost, stopping short of the build area: a ribbon of the
 * rut texture laid just over the ground along a gently wandering line.
 */
function createTracks(random: () => number, spawnPoints: readonly Vector3[], core: Vector3): Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  const side = new Vector3();
  for (const spawn of spawnPoints) {
    const toCore = new Vector3().subVectors(core, spawn).setY(0);
    const length = toCore.length() - TRACK_STOP;
    toCore.normalize();
    side.set(-toCore.z, 0, toCore.x);
    const phase = random() * 10;
    const steps = Math.ceil(length / TRACK_STEP);
    const start = positions.length / 3;
    for (let k = 0; k <= steps; k++) {
      const d = (k / steps) * length;
      // Swings a few meters to either side, settling onto the straight line near the outpost.
      const swing = Math.sin(d / 23 + phase) * 4 + Math.sin(d / 9 + phase * 2) * 1.2;
      point.copy(spawn).addScaledVector(toCore, d).addScaledVector(side, swing * Math.min(1, (length - d) / 20 + 0.2));
      for (const s of [-1, 1]) {
        positions.push(point.x + side.x * s * TRACK_WIDTH * 0.5, TRACK_LIFT, point.z + side.z * s * TRACK_WIDTH * 0.5);
        uvs.push(s < 0 ? 0 : 1, d / TRACK_TILE);
      }
      if (k > 0) {
        const a = start + (k - 1) * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new Float32BufferAttribute(positions.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(indices);
  const material = new MeshLambertMaterial({
    map: createTireTrackTexture(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'tracks';
  return mesh;
}

/** Infinite plane at y = 0. Exact for a flat map, and avoids precision trouble a huge box causes against small shapes. */
function createGroundCollider(world: RAPIER.World): void {
  tagSurface(world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 }))), 'gravel');
}

/** Low sand berms marking the four edges of the play area. */
function createBerms(half: number): Mesh[] {
  const material = new MeshLambertMaterial({ color: BERM_COLOR });
  const length = config.map.size + BERM_WIDTH * 2;
  const offset = half + BERM_WIDTH / 2;
  const alongX = new BoxGeometry(length, BERM_HEIGHT, BERM_WIDTH);
  const alongZ = new BoxGeometry(BERM_WIDTH, BERM_HEIGHT, length);

  const layout: [BoxGeometry, number, number][] = [
    [alongX, 0, -offset],
    [alongX, 0, offset],
    [alongZ, -offset, 0],
    [alongZ, offset, 0],
  ];
  return layout.map(([geometry, x, z]) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, BERM_HEIGHT / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  });
}

/**
 * Walls just outside the play area: a solid part matching the visible berm, and an invisible
 * part above it that stops bodies but lets bullets fly over the berm.
 */
function createBoundaryColliders(world: RAPIER.World, half: number): void {
  const bermHalf = BERM_HEIGHT / 2;
  const upperHalf = (config.map.boundaryHeight - BERM_HEIGHT) / 2;
  const t = BERM_WIDTH / 2;
  const span = half + BERM_WIDTH;
  const offset = half + t;
  const walls: [number, number, number, number][] = [
    // x, z, halfX, halfZ
    [0, -offset, span, t],
    [0, offset, span, t],
    [-offset, 0, t, span],
    [offset, 0, t, span],
  ];
  for (const [x, z, hx, hz] of walls) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, z));
    tagSurface(world.createCollider(RAPIER.ColliderDesc.cuboid(hx, bermHalf, hz).setTranslation(0, bermHalf, 0), body), 'sand');
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, upperHalf, hz)
        .setTranslation(0, BERM_HEIGHT + upperHalf, 0)
        .setCollisionGroups(Groups.boundary),
      body,
    );
  }
}

/** Instanced rock clusters scattered outside the play area to form the surrounding ridges. */
function createRocks(random: () => number, half: number): InstancedMesh {
  const geometry = new DodecahedronGeometry(1, 0);
  const material = new MeshLambertMaterial({ color: ROCK_COLOR, flatShading: true });
  const rocks = new InstancedMesh(geometry, material, ROCK_COUNT);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.name = 'rocks';

  const dummy = new Object3D();
  const minDistance = half + BERM_WIDTH + 4;
  const maxDistance = half + 90;
  const shade = new Color();
  const base = new Color(ROCK_COLOR);

  for (let i = 0; i < ROCK_COUNT; i++) {
    // Pick a point in the square ring between minDistance and maxDistance (Chebyshev distance).
    let x = 0;
    let z = 0;
    do {
      x = (random() * 2 - 1) * maxDistance;
      z = (random() * 2 - 1) * maxDistance;
    } while (Math.max(Math.abs(x), Math.abs(z)) < minDistance);

    const size = 2 + random() * 7;
    dummy.position.set(x, size * 0.25, z);
    dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    dummy.scale.set(size * (0.8 + random() * 0.6), size * (0.5 + random() * 0.4), size * (0.8 + random() * 0.6));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rocks.setColorAt(i, shade.copy(base).multiplyScalar(0.8 + random() * 0.35));
  }
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  return rocks;
}

/** Solid rocks scattered inside the play area, each with a convex hull collider matching its mesh. */
function createFieldRocks(
  random: () => number,
  half: number,
  spawnPoints: Vector3[],
  world: RAPIER.World,
  obstacles: MapObstacle[],
): InstancedMesh {
  const geometry = new DodecahedronGeometry(1, 0);
  const material = new MeshLambertMaterial({ color: ROCK_COLOR, flatShading: true });
  const total = FIELD_ROCK_COUNT + FIELD_PEBBLE_COUNT;
  const rocks = new InstancedMesh(geometry, material, total);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.name = 'fieldRocks';

  const core = new Vector3(config.map.corePosition.x, 0, config.map.corePosition.z);
  const limit = half - 6;
  const candidate = new Vector3();
  const dummy = new Object3D();
  const vertex = new Vector3();
  const source = geometry.getAttribute('position');
  const hullPoints = new Float32Array(source.count * 3);

  for (let i = 0; i < total; i++) {
    do {
      candidate.set((random() * 2 - 1) * limit, 0, (random() * 2 - 1) * limit);
    } while (
      candidate.distanceTo(core) < FIELD_CLEAR_RADIUS ||
      spawnPoints.some((p) => candidate.distanceTo(p) < SPAWN_CLEAR_RADIUS)
    );

    const pebble = i >= FIELD_ROCK_COUNT;
    const size = pebble ? 0.4 + random() * 0.5 : 2 + random() * 3;
    dummy.position.set(candidate.x, size * 0.25, candidate.z);
    dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    dummy.scale.set(size * (0.8 + random() * 0.6), size * (0.5 + random() * 0.4), size * (0.8 + random() * 0.6));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    // A turned rock reaches about 80% of its largest horizontal scale from its center.
    if (!pebble) obstacles.push({ center: candidate.clone(), halfSize: Math.max(dummy.scale.x, dummy.scale.z) * 0.8 });

    // Bake the instance transform into the hull points; the collider sits at the origin.
    for (let v = 0; v < source.count; v++) {
      vertex.fromBufferAttribute(source, v).applyMatrix4(dummy.matrix);
      hullPoints[v * 3] = vertex.x;
      hullPoints[v * 3 + 1] = vertex.y;
      hullPoints[v * 3 + 2] = vertex.z;
    }
    const hull = RAPIER.ColliderDesc.convexHull(hullPoints);
    // Rock has no surface type of its own yet; concrete is the closest hard one.
    if (hull) tagSurface(world.createCollider(hull), 'concrete');
  }
  rocks.instanceMatrix.needsUpdate = true;
  return rocks;
}

/** Placeholder spawn marker: red pad with a flag pole. */
function createSpawnMarker(point: Vector3): Object3D {
  const group = new Object3D();
  group.position.copy(point);
  group.name = 'spawnMarker';

  const pad = new Mesh(
    new CylinderGeometry(3, 3, 0.1, 12),
    new MeshLambertMaterial({ color: SPAWN_PAD_COLOR }),
  );
  pad.position.y = 0.05;
  pad.receiveShadow = true;
  group.add(pad);

  const pole = new Mesh(
    new CylinderGeometry(0.08, 0.08, 4, 6),
    new MeshLambertMaterial({ color: SPAWN_POLE_COLOR }),
  );
  pole.position.y = 2;
  pole.castShadow = true;
  group.add(pole);

  const flag = new Mesh(new BoxGeometry(1.2, 0.7, 0.05), new MeshLambertMaterial({ color: SPAWN_PAD_COLOR }));
  flag.position.set(0.6, 3.6, 0);
  flag.castShadow = true;
  group.add(flag);

  return group;
}
