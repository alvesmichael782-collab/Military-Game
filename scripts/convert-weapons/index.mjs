#!/usr/bin/env node
// Converts the weapon models in Models/Weapons/ into game assets:
//   src/assets/models/weapons/<id>.glb     meters, barrel/blade along -Z, top up, centered on its bounding box,
//                                          moving parts as their own nodes, plus a muzzle (or tip) marker node
//   src/assets/textures/weapons/<id>.png   the color texture only, shrunk to 512 px (256 px for small items)
// Normal, specular, roughness, metalness and AO maps are ignored. Models over MAX_TRIANGLES are simplified.
//
// Usage: npm run convert:weapons [-- <id> ...]
// Needs macOS `sips` for the textures (and ffmpeg for any with `textureGamma`).

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Box3, Matrix3, Matrix4, Vector3 } from 'three';
import { writeGlb } from './glb.mjs';
import { loadSource } from './load.mjs';
import { MAX_TRIANGLES, TARGET_TRIANGLES, WEAPONS } from './weapons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_DIR = join(ROOT, 'Models/Weapons');
const MODEL_OUT = join(ROOT, 'src/assets/models/weapons');
const TEXTURE_OUT = join(ROOT, 'src/assets/textures/weapons');
/** Vertices this close (meters) to the very front of the body count as the muzzle face or blade tip. */
const FRONT_DEPTH = 0.01;
const DEG = Math.PI / 180;

/** Name of the bone that carries the most weight on vertex `i` of a skinned mesh. */
function dominantBone(mesh, i) {
  const index = mesh.geometry.getAttribute('skinIndex');
  const weight = mesh.geometry.getAttribute('skinWeight');
  let best = 0;
  let bestWeight = -1;
  for (let j = 0; j < 4; j++) {
    const w = weight.getComponent(i, j);
    if (w > bestWeight) {
      bestWeight = w;
      best = index.getComponent(i, j);
    }
  }
  return mesh.skeleton.bones[best].name;
}

/**
 * Every mesh's triangles as flat arrays in the source's world space (skinned meshes in their rest pose). For skinned
 * meshes `bones` holds each triangle's bone: the one most of its corners are bound to.
 */
function extractMesh(mesh) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
  const flip = mesh.matrixWorld.determinant() < 0;
  const order = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
  const count = order.length;
  const out = { position: new Float32Array(count * 3), normal: new Float32Array(count * 3), uv: new Float32Array(count * 2) };
  const v = new Vector3();
  for (let k = 0; k < count; k++) {
    // Keep triangles facing outward if the transform mirrors them.
    const corner = flip ? k - (k % 3) + [0, 2, 1][k % 3] : k;
    const i = order[corner];
    if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, v);
    else v.fromBufferAttribute(pos, i);
    v.applyMatrix4(mesh.matrixWorld);
    out.position.set([v.x, v.y, v.z], k * 3);
    if (nor) v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
    else v.set(0, 1, 0);
    out.normal.set([v.x, v.y, v.z], k * 3);
    out.uv.set(uv ? [uv.getX(i), uv.getY(i)] : [0, 0], k * 2);
  }
  if (mesh.isSkinnedMesh) {
    out.bones = [];
    for (let k = 0; k < count; k += 3) {
      const [a, b, c] = [order[k], order[k + 1], order[k + 2]].map((i) => dominantBone(mesh, i));
      out.bones.push(b === c ? b : a);
    }
  }
  return out;
}

/** The triangles of `soup` for which `keep(triangle)` is true, as a new soup. */
function filterTriangles(soup, keep) {
  const position = [];
  const normal = [];
  const uv = [];
  for (let t = 0; t < soup.position.length / 9; t++) {
    if (!keep(t)) continue;
    position.push(...soup.position.subarray(t * 9, t * 9 + 9));
    normal.push(...soup.normal.subarray(t * 9, t * 9 + 9));
    uv.push(...soup.uv.subarray(t * 6, t * 6 + 6));
  }
  return { position: new Float32Array(position), normal: new Float32Array(normal), uv: new Float32Array(uv) };
}

function concat(list, key) {
  const total = list.reduce((n, m) => n + m[key].length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const m of list) {
    out.set(m[key], at);
    at += m[key].length;
  }
  return out;
}

/** Share identical corners (same position, normal and uv) so the mesh is indexed and can be simplified. */
function weld(soup) {
  const map = new Map();
  const position = [];
  const normal = [];
  const uv = [];
  const index = new Uint32Array(soup.position.length / 3);
  const r = (x, s) => Math.round(x * s);
  for (let k = 0; k < index.length; k++) {
    const p = soup.position.subarray(k * 3, k * 3 + 3);
    const n = soup.normal.subarray(k * 3, k * 3 + 3);
    const t = soup.uv.subarray(k * 2, k * 2 + 2);
    const key = `${r(p[0], 1e5)},${r(p[1], 1e5)},${r(p[2], 1e5)},${r(n[0], 1e3)},${r(n[1], 1e3)},${r(n[2], 1e3)},${r(t[0], 1e5)},${r(t[1], 1e5)}`;
    let at = map.get(key);
    if (at === undefined) {
      at = position.length / 3;
      map.set(key, at);
      position.push(...p);
      normal.push(...n);
      uv.push(...t);
    }
    index[k] = at;
  }
  return { position: new Float32Array(position), normal: new Float32Array(normal), uv: new Float32Array(uv), index };
}

/** Simplify to about `ratio` of its triangles. Open borders are locked so no holes open up. */
function simplify(part, ratio) {
  const target = Math.max(3, Math.floor((part.index.length * ratio) / 3) * 3);
  const [index] = MeshoptSimplifier.simplify(part.index, part.position, 3, target, 0.02, ['LockBorder']);
  // Drop vertices no longer used.
  const remap = new Int32Array(part.position.length / 3).fill(-1);
  const position = [];
  const normal = [];
  const uv = [];
  const out = new Uint32Array(index.length);
  for (let k = 0; k < index.length; k++) {
    const i = index[k];
    if (remap[i] < 0) {
      remap[i] = position.length / 3;
      position.push(...part.position.subarray(i * 3, i * 3 + 3));
      normal.push(...part.normal.subarray(i * 3, i * 3 + 3));
      uv.push(...part.uv.subarray(i * 2, i * 2 + 2));
    }
    out[k] = remap[i];
  }
  return { ...part, position: new Float32Array(position), normal: new Float32Array(normal), uv: new Float32Array(uv), index: out };
}

function bounds(position) {
  const box = new Box3();
  const v = new Vector3();
  for (let i = 0; i < position.length; i += 3) box.expandByPoint(v.fromArray(position, i));
  return box;
}

function transform(soup, matrix) {
  const v = new Vector3();
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  for (let i = 0; i < soup.position.length; i += 3) {
    v.fromArray(soup.position, i).applyMatrix4(matrix).toArray(soup.position, i);
    v.fromArray(soup.normal, i).applyMatrix3(normalMatrix).normalize().toArray(soup.normal, i);
  }
}

/** Long axis of a set of points (unit vector), signed to point down (-Y): the way a magazine leaves its well. */
function longAxis(position) {
  const c = bounds(position).getCenter(new Vector3());
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < position.length; i += 3) {
    const d = [position[i] - c.x, position[i + 1] - c.y, position[i + 2] - c.z];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a * 3 + b] += d[a] * d[b];
  }
  let v = new Vector3(0, 1, 0);
  for (let k = 0; k < 50; k++) {
    v = new Vector3(m[0] * v.x + m[1] * v.y + m[2] * v.z, m[3] * v.x + m[4] * v.y + m[5] * v.z, m[6] * v.x + m[7] * v.y + m[8] * v.z).normalize();
  }
  return v.y > 0 ? v.negate() : v;
}

const round = (v, d = 4) => Number(v.toFixed(d));

function convert(def) {
  const root = loadSource(join(SOURCE_DIR, def.source));
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && !(def.skip ?? []).includes(o.name)) meshes.push(o);
  });
  const sourceTriangles = meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0);

  // Group the meshes into parts; whatever is not a named part is the body. A part can also take the triangles a
  // skinned mesh binds to its bones (a rigid moving piece the source rigged rather than modelled apart).
  const partEntries = Object.entries(def.parts ?? {});
  const partOf = (name) => partEntries.find(([, p]) => p.meshes?.includes(name))?.[0] ?? 'body';
  const partOfBone = (bone) => partEntries.find(([, p]) => p.bones?.includes(bone))?.[0];
  for (const [name, p] of partEntries) {
    for (const m of p.meshes ?? []) if (!meshes.some((o) => o.name === m)) throw new Error(`${def.id}: part ${name} mesh "${m}" not found`);
  }
  const extracted = meshes.map((m) => ({ part: partOf(m.name), soup: extractMesh(m) }));
  const names = ['body', ...partEntries.map(([name]) => name)];
  const triangleOwner = (soup, part, t) => (soup.bones && partOfBone(soup.bones[t])) || part;
  const soups = names.map((name) => {
    const list = extracted.map(({ part, soup }) => filterTriangles(soup, (t) => triangleOwner(soup, part, t) === name));
    return { name, position: concat(list, 'position'), normal: concat(list, 'normal'), uv: concat(list, 'uv') };
  });
  for (const s of soups) if (s.position.length === 0) throw new Error(`${def.id}: part ${s.name} is empty`);

  // Orientation, then units: barrel along -Z, top up, meters.
  const rotation = new Matrix4();
  for (const [axis, degrees] of def.rotate ?? []) {
    const r = new Matrix4()[`makeRotation${axis.toUpperCase()}`](degrees * DEG);
    rotation.premultiply(r);
  }
  for (const s of soups) transform(s, rotation);
  const all = bounds(concat(soups, 'position'));
  const size = all.getSize(new Vector3());
  const scale = def.scale ?? (def.length ? def.length / size.z : def.height / size.y);
  const center = all.getCenter(new Vector3()).multiplyScalar(scale);
  // Centered on the bounding box with every part where the source has it, then misplaced parts are moved.
  const place = new Matrix4().makeTranslation(-center.x, -center.y, -center.z).multiply(new Matrix4().makeScale(scale, scale, scale));
  for (const s of soups) {
    transform(s, place);
    const offset = def.parts?.[s.name]?.offset;
    if (offset) transform(s, new Matrix4().makeTranslation(...offset));
  }

  // Weld, then simplify every part by the same ratio if the whole model is too heavy.
  let parts = soups.map((s) => ({ ...weld(s), name: s.name }));
  const triangles = () => parts.reduce((n, p) => n + p.index.length / 3, 0);
  if (triangles() > MAX_TRIANGLES) {
    const ratio = TARGET_TRIANGLES / triangles();
    parts = parts.map((p) => simplify(p, ratio));
  }

  // The marker: average of the frontmost vertices (smallest Z) of the body and anything riding on it (a slide).
  const body = { position: concat(parts.filter((p) => p.name === 'body' || p.name === 'slide'), 'position') };
  let front = Infinity;
  for (let i = 2; i < body.position.length; i += 3) front = Math.min(front, body.position[i]);
  const marker = new Vector3();
  let count = 0;
  for (let i = 0; i < body.position.length; i += 3) {
    if (body.position[i + 2] - front > FRONT_DEPTH) continue;
    marker.add(new Vector3().fromArray(body.position, i));
    count++;
  }
  marker.divideScalar(count);

  // Moving parts get their origin at the center of their top, so the game can slide them along the well.
  const info = {};
  for (const p of parts) {
    let origin = [0, 0, 0];
    if (p.name !== 'body') {
      const box = bounds(p.position);
      origin = [(box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2];
      for (let i = 0; i < p.position.length; i += 3) {
        p.position[i] -= origin[0];
        p.position[i + 1] -= origin[1];
        p.position[i + 2] -= origin[2];
      }
      info[p.name] = { origin: origin.map((v) => round(v)), axis: longAxis(p.position).toArray().map((v) => round(v, 3)) };
    }
    p.translation = origin;
    // glTF puts the texture origin at the top left.
    for (let i = 1; i < p.uv.length; i += 2) p.uv[i] = 1 - p.uv[i];
  }

  mkdirSync(MODEL_OUT, { recursive: true });
  writeFileSync(join(MODEL_OUT, `${def.id}.glb`), writeGlb({ name: def.id, parts, markers: [{ name: def.marker, translation: marker.toArray() }] }));

  mkdirSync(TEXTURE_OUT, { recursive: true });
  const textureOut = join(TEXTURE_OUT, `${def.id}.png`);
  const textureIn = join(SOURCE_DIR, def.texture);
  if (def.textureGamma) {
    // Lift a texture that is too dark to read under the game's Lambert lighting (ffmpeg).
    const curve = `255*pow(val/255\\,${def.textureGamma})`;
    const filter = `scale=w='min(${def.textureSize},iw)':h='min(${def.textureSize},ih)':force_original_aspect_ratio=decrease:flags=area,lutrgb=r=${curve}:g=${curve}:b=${curve}`;
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', textureIn, '-vf', filter, textureOut], { stdio: 'inherit' });
  } else {
    execFileSync('sips', ['-s', 'format', 'png', '-Z', String(def.textureSize), textureIn, '--out', textureOut], { stdio: 'ignore' });
  }

  const finalBox = bounds(concat(parts.map((p) => ({ position: p.position.map((v, i) => v + p.translation[i % 3]) })), 'position'));
  return {
    id: def.id,
    sourceTriangles,
    triangles: triangles(),
    size: finalBox.getSize(new Vector3()).toArray().map((v) => round(v, 3)),
    [def.marker]: marker.toArray().map((v) => round(v)),
    parts: info,
  };
}

await MeshoptSimplifier.ready;
const only = process.argv.slice(2);
for (const def of WEAPONS) {
  if (only.length && !only.includes(def.id)) continue;
  console.log(JSON.stringify(convert(def)));
}
