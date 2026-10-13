// Minimal binary glTF (GLB) writer for static weapon models: named nodes with one indexed triangle mesh each
// (position, normal, uv), plus empty marker nodes. One shared untextured material; the game loads the color
// texture itself and swaps in MeshLambertMaterial.

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/**
 * @param {object} model
 * @param {string} model.name root node name
 * @param {{ name: string, translation: number[], position: Float32Array, normal: Float32Array, uv: Float32Array, index: Uint32Array }[]} model.parts
 * @param {{ name: string, translation: number[] }[]} model.markers
 * @returns {Buffer}
 */
export function writeGlb({ name, parts, markers }) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [];
  const accessors = [];

  function addView(array, target) {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteLength += pad;
    }
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    byteLength += bytes.length;
    return bufferViews.length - 1;
  }

  function addAccessor(array, type, componentType, target, withBounds) {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    const accessor = { bufferView: addView(array, target), componentType, count: array.length / size, type };
    if (withBounds) {
      const min = new Array(size).fill(Infinity);
      const max = new Array(size).fill(-Infinity);
      for (let i = 0; i < array.length; i++) {
        const c = i % size;
        min[c] = Math.min(min[c], array[i]);
        max[c] = Math.max(max[c], array[i]);
      }
      accessor.min = min;
      accessor.max = max;
    }
    accessors.push(accessor);
    return accessors.length - 1;
  }

  const meshes = [];
  const nodes = [{ name, children: [] }];
  for (const part of parts) {
    const vertexCount = part.position.length / 3;
    const index = vertexCount < 65536 ? Uint16Array.from(part.index) : part.index;
    const primitive = {
      attributes: {
        POSITION: addAccessor(part.position, 'VEC3', FLOAT, ARRAY_BUFFER, true),
        NORMAL: addAccessor(part.normal, 'VEC3', FLOAT, ARRAY_BUFFER, false),
        TEXCOORD_0: addAccessor(part.uv, 'VEC2', FLOAT, ARRAY_BUFFER, false),
      },
      indices: addAccessor(index, 'SCALAR', index instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_INT, ELEMENT_ARRAY_BUFFER, false),
      material: 0,
    };
    meshes.push({ name: part.name, primitives: [primitive] });
    nodes[0].children.push(nodes.length);
    nodes.push({ name: part.name, mesh: meshes.length - 1, translation: part.translation });
  }
  for (const marker of markers) {
    nodes[0].children.push(nodes.length);
    nodes.push({ name: marker.name, translation: marker.translation });
  }

  const json = {
    asset: { version: '2.0', generator: 'last-stand-fortress convert-weapons' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials: [{ name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  const bin = Buffer.concat(chunks);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
  const chunkHeader = (length, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(length, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([header, chunkHeader(jsonPadded.length, 0x4e4f534a), jsonPadded, chunkHeader(binPadded.length, 0x004e4942), binPadded]);
}
