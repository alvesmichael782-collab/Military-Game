import { MeshLambertMaterial } from 'three';
import { config } from '../core/config';
import { createBrickTexture, createWallDamageAtlas, DAMAGE_COLUMNS, DAMAGE_ROWS } from '../destruction/WallDamageTextures';
import type { Edge } from '../world/BuildGrid';
import { WALL_BROKEN_ATTRIBUTE } from './WallGeometry';
import { createWallBaseTexture, createWallWearAtlas, WEAR_COLUMNS, WEAR_ROWS, WEAR_TILES } from './WallTextures';

/**
 * Per-instance wear data for wall pieces (`wallWear` attribute): the wear overlay on the piece's +z side,
 * the one on its -z side, and how far along the piece's +x the middle of its wall lies (0 for a segment,
 * half a cell for an arm, which sits at a grid point and points into its wall).
 */
export const WALL_WEAR_ATTRIBUTE = 'wallWear';

/**
 * Per-instance damage data for wall pieces (`wallDamage` attribute): the damage overlay tile on the wall's
 * +z face and on its -z face (-1 for none, see destruction/WallDamageTextures), and +1 or -1 for whether
 * the piece points the same way as its wall's middle segment (the far arm is turned half round).
 */
export const WALL_DAMAGE_ATTRIBUTE = 'wallDamage';

/** The wear overlays on a wall's two faces, fixed per grid edge so a wall always looks the same. */
export function wearOf(edge: Readonly<Edge>): [number, number] {
  let h = Math.imul(edge.i + 1, 73856093) ^ Math.imul(edge.j + 1, 19349663) ^ (edge.axis === 'x' ? 0x5bd1e995 : 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  const front = h % WEAR_TILES;
  // Never the same overlay on both faces.
  const back = (front + 1 + ((h >>> 8) % (WEAR_TILES - 1))) % WEAR_TILES;
  return [front, back];
}

/**
 * Plaster wall material: Lambert with vertex-color shading, plus the base plaster sampled by world
 * position (continuous across every wall and joint), each wall's own wear overlay on its two faces, its
 * damage overlay once it is damaged or breached, and bare brick on broken faces (`wallBroken`).
 */
export function createWallMaterial(): MeshLambertMaterial {
  const base = createWallBaseTexture();
  const wear = createWallWearAtlas();
  const damage = createWallDamageAtlas();
  const brick = createBrickTexture();
  const material = new MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  const tile = config.build.cellSize.toFixed(3);
  const height = config.structures.wall.height.toFixed(3);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.wallBase = { value: base };
    shader.uniforms.wallWear = { value: wear };
    shader.uniforms.wallDamageMap = { value: damage };
    shader.uniforms.wallBrick = { value: brick };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 ${WALL_WEAR_ATTRIBUTE};
attribute vec3 ${WALL_DAMAGE_ATTRIBUTE};
attribute float ${WALL_BROKEN_ATTRIBUTE};
varying vec2 vWallUv;
varying vec3 vWallWear;
varying vec3 vWallDamage;
varying vec2 vWallBrickUv;
varying float vWallBroken;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
mat4 wallModel = modelMatrix;
#ifdef USE_INSTANCING
wallModel = modelMatrix * instanceMatrix;
#endif
mat3 wallRotation = mat3(wallModel);
vec3 wallPosition = (wallModel * vec4(transformed, 1.0)).xyz;
vec3 wallNormal = normalize(wallRotation * objectNormal);
vec3 wallAlong = normalize(wallRotation * vec3(1.0, 0.0, 0.0));
vec3 wallAcross = normalize(wallRotation * vec3(0.0, 0.0, 1.0));
// Upright faces read left to right as seen from outside; flat faces run along the wall, always toward +x/+z.
vec3 wallFlat = wallAlong.x + wallAlong.z < 0.0 ? -wallAlong : wallAlong;
bool wallIsFlat = abs(wallNormal.y) > 0.7;
vec3 wallTangent = wallIsFlat ? wallFlat : normalize(cross(vec3(0.0, 1.0, 0.0), wallNormal));
vec3 wallOrigin = (wallModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
// Flat faces (wall tops, lip tops) take a strip of the face texture from just below their own height,
// spread across their width from the wall's center line, so they get the same weathering as the face below.
float wallOffCenter = dot(wallPosition - wallOrigin, vec3(-wallFlat.z, 0.0, wallFlat.x)) / ${tile};
vWallUv = vec2(
  dot(wallPosition, wallTangent) / ${tile},
  wallIsFlat ? min(wallPosition.y / ${height}, 0.88) + wallOffCenter * 0.5 : wallPosition.y / ${height}
);
vec3 wallMiddle = wallOrigin + wallAlong * ${WALL_WEAR_ATTRIBUTE}.z;
float wallFacing = dot(wallNormal, wallAcross);
vWallWear = vec3(
  dot(wallPosition - wallMiddle, wallTangent) / ${tile} + 0.5,
  wallPosition.y / ${height},
  abs(wallFacing) > 0.9 ? (wallFacing > 0.0 ? ${WALL_WEAR_ATTRIBUTE}.x : ${WALL_WEAR_ATTRIBUTE}.y) : -1.0
);
// Damage overlays live in the wall's own frame (its middle segment's), so they line up with its holes.
vec3 wallSegAlong = wallAlong * ${WALL_DAMAGE_ATTRIBUTE}.z;
float wallSegFacing = dot(wallNormal, wallAcross * ${WALL_DAMAGE_ATTRIBUTE}.z);
vWallDamage = vec3(
  dot(wallPosition - wallMiddle, wallSegAlong) / ${tile} + 0.5,
  wallPosition.y / ${height},
  abs(wallSegFacing) > 0.9 ? (wallSegFacing > 0.0 ? ${WALL_DAMAGE_ATTRIBUTE}.x : ${WALL_DAMAGE_ATTRIBUTE}.y) : -1.0
);
// Bare brick on broken faces: courses run level on upright faces, and across the wall on flat ones.
vWallBrickUv = wallIsFlat
  ? vec2(dot(wallPosition, wallFlat) / ${tile}, dot(wallPosition, vec3(-wallFlat.z, 0.0, wallFlat.x)) / ${height})
  : vec2(dot(wallPosition, wallTangent) / ${tile}, wallPosition.y / ${height});
vWallBroken = ${WALL_BROKEN_ATTRIBUTE};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D wallBase;
uniform sampler2D wallWear;
uniform sampler2D wallDamageMap;
uniform sampler2D wallBrick;
varying vec2 vWallUv;
varying vec3 vWallWear;
varying vec3 vWallDamage;
varying vec2 vWallBrickUv;
varying float vWallBroken;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 wallColor = texture2D(wallBase, vWallUv).rgb;
// Sampled on every face (no branch, so mipmapping stays smooth); faces without wear discard the result.
float wallTile = floor(max(vWallWear.z, 0.0) + 0.5);
vec2 wallTileUv = clamp(vWallWear.xy, 0.0, 1.0) * (254.0 / 256.0) + 1.0 / 256.0;
vec2 wallAtlasUv = (vec2(mod(wallTile, ${WEAR_COLUMNS}.0), floor(wallTile / ${WEAR_COLUMNS}.0)) + wallTileUv) / vec2(${WEAR_COLUMNS}.0, ${WEAR_ROWS}.0);
vec4 wallMark = texture2D(wallWear, wallAtlasUv);
float wallInside = step(-0.5, vWallWear.z) * step(0.0, vWallWear.x) * step(vWallWear.x, 1.0);
wallColor = mix(wallColor, wallMark.rgb, wallMark.a * wallInside);
// Damage overlay, the same way as the wear.
float wallDamageTile = floor(max(vWallDamage.z, 0.0) + 0.5);
vec2 wallDamageTileUv = clamp(vWallDamage.xy, 0.0, 1.0) * (254.0 / 256.0) + 1.0 / 256.0;
vec2 wallDamageUv = (vec2(mod(wallDamageTile, ${DAMAGE_COLUMNS}.0), floor(wallDamageTile / ${DAMAGE_COLUMNS}.0)) + wallDamageTileUv) / vec2(${DAMAGE_COLUMNS}.0, ${DAMAGE_ROWS}.0);
vec4 wallDamageMark = texture2D(wallDamageMap, wallDamageUv);
float wallDamaged = step(-0.5, vWallDamage.z) * step(0.0, vWallDamage.x) * step(vWallDamage.x, 1.0);
wallColor = mix(wallColor, wallDamageMark.rgb, wallDamageMark.a * wallDamaged);
wallColor = mix(wallColor, texture2D(wallBrick, vWallBrickUv).rgb, step(0.5, vWallBroken));
diffuseColor.rgb *= wallColor;`,
      );
  };
  material.customProgramCacheKey = () => 'wallPlaster';
  return material;
}
