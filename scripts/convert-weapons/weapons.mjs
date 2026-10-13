// The weapon models the converter turns into game assets. Paths are relative to Models/Weapons/.
//
// - `scale` turns source units into meters; `rotate` is applied in order (axis, degrees) so the barrel or
//   blade ends up along -Z with the top of the weapon up (+Y).
// - `parts` are meshes the game moves on their own (only meshes the source already has as separate objects).
//   Each part is written as its own node, its origin at the center of its top (the magazine's lip), so the game
//   can slide it out along the well. `offset` (meters, after rotation) moves a part that the source left out of place.
//   A part listed by `bones` takes the triangles a skinned mesh binds to those bones: a rigid piece the source
//   rigged inside a mesh (every vertex is bound 100% to one bone), so moving the part is moving the bone.
// - `skip` drops meshes (accessories the game does not use).
// - `marker` is the empty node written at the front of the body: the muzzle for guns, the tip for blades.
// - Models over `maxTriangles` are simplified to about `targetTriangles`.
// - `textureGamma` (below 1) lifts a color texture too dark to read in game.

export const MAX_TRIANGLES = 8000;
export const TARGET_TRIANGLES = 6000;

export const WEAPONS = [
  {
    id: 'm4',
    // FarCry carbine. Authored in centimeters with the barrel along +Z. Centered with the magazine where the file
    // leaves it, so the rifle sits exactly where its aim-down-sights pose was fitted; then the magazine is seated
    // (the file has it 3.5 cm low and 0.8 cm forward of the magwell).
    source: "AR's/FarCry carbine/source/M4.fbx",
    texture: "AR's/FarCry carbine/textures/M4.png",
    textureSize: 512,
    scale: 0.01,
    rotate: [['y', 180]],
    parts: { magazine: { meshes: ['M4_Magzine'], offset: [0, 0.035, 0.0083] } },
    marker: 'muzzle',
  },
  {
    id: 'pistol',
    // Black Pistol: a 9 mm service pistol with a separate magazine; the slide is part of the body mesh.
    // Unknown units with the barrel along +Z; scaled to a 0.20 m long pistol.
    source: 'Pistols/Black Pistol/gun.obj',
    texture: 'Pistols/Black Pistol/tx_eric_sp.png',
    // The texture is an atlas shared with hands and props, so the pistol only uses a corner of it: keep 512.
    textureSize: 512,
    length: 0.2,
    rotate: [['y', 180]],
    parts: { magazine: { meshes: ['gunmagazine_meshId1_name.002'] } },
    marker: 'muzzle',
  },
  {
    id: 'sg09',
    // SG-09 R: a full-size 9 mm pistol in meters. Baked to its rest pose it lies barrel along +Y, slide toward +Z.
    // The magazine is three meshes (body, base plate, rounds). The slide is rigged to bone _01 inside the body mesh.
    // The under-barrel laser (two meshes, with its own texture) is dropped.
    source: 'Pistols/SilverHK/SG-09 R.dae',
    texture: 'Pistols/SilverHK/wp4000_00_2_ALBD.png',
    textureSize: 512,
    scale: 1,
    rotate: [['x', 90], ['y', 180], ['x', 90]],
    parts: {
      magazine: { meshes: ['Group_5_Sub_0__wp4000_00_2_mat', 'Group_6_Sub_0__wp4000_00_2_mat', 'Group_20_Sub_0__wp4000_00_2_mat'] },
      slide: { bones: ['_01'] },
    },
    skip: ['Group_200_Sub_0__wp4000_00_laser_mat', 'Group_201_Sub_0__wp4000_00_laser_mat'],
    marker: 'muzzle',
  },
  {
    id: 'revolver',
    // Black revolver in meters, one mesh (the cylinder is not separate), barrel pointing down (-Y), sights toward +Z.
    source: 'Pistols/Black_Revolver/Eugene_Gun.obj',
    texture: 'Pistols/Black_Revolver/Eugene_Gun_Albedo.png',
    textureSize: 512,
    // Near-black blued steel: lifted so the shape reads as dark gunmetal rather than a silhouette.
    textureGamma: 0.5,
    scale: 1,
    rotate: [['x', -90], ['y', 180]],
    marker: 'muzzle',
  },
  {
    id: 'uzi',
    // Compact Uzi-style SMG, one mesh (no separate magazine), barrel along +Z. Scaled to 0.30 m tall with its magazine.
    source: "SMG's/Uzi/Submachine Gun (DR).obj",
    texture: "SMG's/Uzi/Textures/gun1.png",
    textureSize: 256,
    height: 0.3,
    rotate: [['y', 180]],
    marker: 'muzzle',
  },
  {
    id: 'knife',
    // Butterfly knife, open (TP_Butterfly): blade out, handles together, in meters, blade up (+Y). The other file in
    // the folder (PU_Bali) is the same knife closed, with the blade hidden between the handles. Turned so the
    // blade stands on edge.
    source: "Melee's/Bali/TP_Butterfly.obj",
    texture: "Melee's/Bali/knifedds.png",
    textureSize: 256,
    scale: 1,
    rotate: [['x', -90], ['z', 90]],
    marker: 'tip',
  },
];
