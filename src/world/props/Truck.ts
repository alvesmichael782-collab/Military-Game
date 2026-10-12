import { CylinderGeometry } from 'three';
import type { PropBuilder } from '../PropBuilder';
import { PropMaterials } from '../PropMaterials';

/** Outer size of the truck, in meters: width, and length from bumper to tailgate. */
const WIDTH = 2.4;
const LENGTH = 6.6;

/**
 * A wrecked army cargo truck (FPS-Model(2)): olive cab and hood on a chassis, a cargo bed with a torn canvas cover
 * on bows, five of its six wheels (the front left one lies on the ground beside it). A generic stenciled
 * number on the doors, no insignia. One box collider around the body; its footprint is blocked for routes.
 */
export function addTruck(b: PropBuilder, x: number, z: number, yaw: number): void {
  const olive = PropMaterials.oliveMetal();
  const dark = PropMaterials.darkMetal();
  const canvas = PropMaterials.burlap();
  b.at(x, z, yaw);
  // Front is +z. Heights are taken as they are; `y` keeps the call sites readable.
  const y = (_px: number, _pz: number, h: number): number => h;
  const tip = {};

  // Chassis rails and bumper.
  for (const side of [-0.55, 0.55]) b.box(dark, 0.16, 0.22, LENGTH - 0.4, side, y(side, 0, 0.75), 0, { ...tip, tint: 0.7 });
  b.box(dark, WIDTH * 0.95, 0.22, 0.18, 0, y(0, 3.2, 0.7), LENGTH / 2 - 0.1, { ...tip, tint: 0.75 });
  // Hood and grille.
  b.box(olive, 1.9, 0.75, 1.5, 0, y(0, 2.4, 1.25), 2.35, { ...tip, uv: 2 });
  b.box(dark, 1.5, 0.6, 0.06, 0, y(0, 3.1, 1.2), 3.12, { ...tip, tint: 0.45 });
  // Fenders.
  for (const side of [-1, 1]) b.box(olive, 0.5, 0.12, 1.3, side * 1.0, y(side, 2.4, 1.0), 2.4, { ...tip, uv: 2, tint: 0.9 });
  // Cab with dark broken windows.
  b.box(olive, WIDTH * 0.92, 1.45, 1.6, 0, y(0, 0.9, 1.75), 0.9, { ...tip, uv: 2 });
  b.box(dark, WIDTH * 0.8, 0.55, 0.05, 0, y(0, 1.7, 2.15), 1.71, { ...tip, tint: 0.25 });
  for (const side of [-1, 1]) b.box(dark, 0.05, 0.5, 0.8, side * WIDTH * 0.465, y(side, 1, 2.15), 1.05, { ...tip, tint: 0.25 });
  b.box(olive, WIDTH * 0.96, 0.08, 1.7, 0, y(0, 0.9, 2.5), 0.9, { ...tip, uv: 2, tint: 0.85 });
  // Cargo bed: floor and low sides.
  const bedZ = -1.4;
  const bedLength = 3.8;
  b.box(olive, WIDTH, 0.12, bedLength, 0, y(0, bedZ, 1.05), bedZ, { ...tip, uv: 2, tint: 0.85 });
  for (const side of [-1, 1]) b.box(olive, 0.08, 0.55, bedLength, side * (WIDTH / 2 - 0.04), y(side, bedZ, 1.37), bedZ, { ...tip, uv: 2 });
  b.box(olive, WIDTH, 0.55, 0.08, 0, y(0, bedZ - 1.9, 1.37), bedZ - bedLength / 2 + 0.04, { ...tip, uv: 2 });
  // Canvas cover: the front two thirds still on, torn off the back, with the last bows bare.
  const cover = bedLength * 0.62;
  const coverZ = bedZ + bedLength / 2 - cover / 2;
  b.box(canvas, WIDTH + 0.04, 0.06, cover, 0, y(0, coverZ, 2.85), coverZ, { ...tip, uv: 1.2, tint: [0.62, 0.66, 0.46] });
  for (const side of [-1, 1]) {
    b.box(canvas, 0.05, 1.3, cover, side * (WIDTH / 2 + 0.01), y(side, coverZ, 2.2), coverZ, { ...tip, uv: 1.2, tint: [0.6, 0.64, 0.44] });
  }
  for (let k = 0; k < 3; k++) {
    const bz = bedZ - bedLength / 2 + 0.2 + k * 0.55;
    b.box(dark, WIDTH, 0.06, 0.06, 0, y(0, bz, 2.82), bz, { ...tip, tint: 0.8, ao: false });
    for (const side of [-1, 1]) b.box(dark, 0.06, 1.4, 0.06, side * (WIDTH / 2 - 0.02), y(side, bz, 2.12), bz, { ...tip, tint: 0.8 });
  }
  // Wheels: two at the front (one gone), four at the back. A lone wheel lies on the ground beside the wreck.
  const wheels: [number, number][] = [[1, 2.4], [-1, -0.9], [1, -0.9], [-1, -2.2], [1, -2.2]];
  for (const [side, wz] of wheels) {
    b.piece(dark, new CylinderGeometry(0.52, 0.52, 0.36, 12), side * 1.0, y(side, wz, 0.5), wz, { rz: Math.PI / 2, uv: 'native', tint: 0.55 });
    b.piece(dark, new CylinderGeometry(0.22, 0.22, 0.38, 8), side * 1.0, y(side, wz, 0.5), wz, { rz: Math.PI / 2, uv: 'native', tint: 0.95, ao: false });
  }
  b.piece(dark, new CylinderGeometry(0.52, 0.52, 0.36, 12), -2.1, 0.18, 3.2, { rx: 0, rz: 0, ry: 0.4, uv: 'native', tint: 0.55 });
  b.collider(0.55, 0.18, 0.55, -2.1, 0.18, 3.2, 0, 'metal');
  // Body collider and footprint.
  b.collider(WIDTH / 2, 1.3, LENGTH / 2, 0, 1.3, 0, 0, 'metal');
  b.block(WIDTH / 2 + 0.3, LENGTH / 2 + 0.3);
}
