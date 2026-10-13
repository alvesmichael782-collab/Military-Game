// Loads a weapon source file (.obj, .dae or .fbx) into a three.js scene graph, in Node.
// three's loaders expect a browser; the shims here give them just enough: an XML parser for Collada and a
// texture loader that records the file name instead of decoding the image (textures are handled separately).

import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { DOMParser } from 'linkedom';
import { LoadingManager, Texture, TextureLoader } from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

globalThis.DOMParser ??= DOMParser;
// linkedom's XML documents lack `children` on some nodes the Collada parser reads; fall back to element children.
if (globalThis.window === undefined) globalThis.window = globalThis;

/** A texture that only remembers which file it named. */
function namedTexture(url) {
  const texture = new Texture();
  texture.userData.file = basename(decodeURIComponent(url).replace(/\\/g, '/'));
  return texture;
}

TextureLoader.prototype.load = function load(url, onLoad) {
  const texture = namedTexture(url);
  onLoad?.(texture);
  return texture;
};

const manager = new LoadingManager();
manager.addHandler(/\.(tga|dds)$/i, { load: (url, onLoad) => namedTexture(url), setPath() {}, path: '' });

/** `map_Kd` per material name from an .mtl file next to an .obj. */
function readMtl(objPath) {
  const text = readFileSync(objPath, 'utf8');
  const lib = /^mtllib\s+(.+)$/m.exec(text)?.[1]?.trim();
  const maps = new Map();
  if (!lib) return maps;
  let current = null;
  let mtl;
  try {
    mtl = readFileSync(join(dirname(objPath), lib), 'utf8');
  } catch {
    return maps;
  }
  for (const line of mtl.split(/\r?\n/)) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key === 'newmtl') current = rest.join(' ');
    else if (key === 'map_Kd' && current) maps.set(current, basename(rest[rest.length - 1].replace(/\\/g, '/')));
  }
  return maps;
}

/**
 * Load `path` and return its root object. Every mesh's material(s) get `userData.diffuse`, the file name of
 * their color texture when the source names one.
 */
export function loadSource(path) {
  const ext = extname(path).toLowerCase();
  let root;
  if (ext === '.obj') {
    root = new OBJLoader().parse(readFileSync(path, 'utf8'));
    const maps = readMtl(path);
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) m.userData.diffuse = maps.get(m.name) ?? null;
    });
  } else if (ext === '.dae') {
    root = new ColladaLoader(manager).parse(readFileSync(path, 'utf8'), `${dirname(path)}/`).scene;
  } else if (ext === '.fbx') {
    const buffer = readFileSync(path);
    root = new FBXLoader(manager).parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), `${dirname(path)}/`);
  } else {
    throw new Error(`Unsupported model format: ${path}`);
  }
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) m.userData.diffuse ??= m.map?.userData.file ?? null;
  });
  root.updateMatrixWorld(true);
  return root;
}
