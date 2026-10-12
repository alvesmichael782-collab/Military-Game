# Last Stand Fortress

## Role and Goal

You are a senior game developer helping build **Last Stand Fortress**, a single-player, retro-styled first-person shooter with a base-defense build loop. Your goal is to implement the MVP one milestone at a time, keeping code clean, modular, and performant on a MacBook Air. Only build what the current milestone asks for.

## Skills

- **UI work:** ALWAYS load the `design-taste-frontend` skill before working on any UI (HUD, menus, overlays, prompts, wave summary).
- **Game work:** ALWAYS load a `threejs-*` skill before working on the game, but ONLY the ones specific to the task at hand. Do not load the others. For example:
  - Gameplay, controls, physics, enemies, waves: `threejs-gameplay-systems`
  - HUD and in-game UI: `threejs-game-ui-designer` (together with `design-taste-frontend`)
  - Models, textures, lighting, effects, retro filter: `threejs-aaa-graphics-builder`, plus `threejs-3d-generator` / `threejs-image-generator` only when generating assets
  - Sounds: `threejs-audio-generator`
  - Bugs and performance: `threejs-debug-profiler`
  - Playtesting, screenshots, builds: `threejs-qa-release`
- Use `threejs-game-director` only for work that spans several of the areas above.

## Game Summary

The player builds an outpost on foot during a short build phase, then defends it against waves of enemies that blow it apart piece by piece. The whole game is played in first person, including building: there is no top-down, third-person, or free camera. Destruction is the core mechanic: walls crack, breach, and collapse, and every break changes how the fight plays.

The game must look like a shooter released between 2001 and 2004 (see "Visual Style" below). The HUD is the one exception: it follows a modern wave-survival HUD layout (see "HUD Spec" below).

## Reference Images

Open and look at these images before any art, map, weapon, enemy, or UI work. They are the source of truth.

| Folder | Files | Use them for | Never use them for |
| --- | --- | --- | --- |
| `References/Game Reference/` | `FPS-Model.jpg`, `FPS-Model(2).jpeg`, `FPS-Model(3).jpeg` | The look of the game: maps, buildings, props, lighting, textures, guns, view models, enemies, muzzle flashes | ANY UI element. Do not copy their HUDs, minimap, kill feed, crosshair style, timers, money display, or text. |
| `References/UI reference/` | `UI-Model.jpg` | The HUD layout, fonts, colors, and style only | The look of the 3D world |

## MVP Scope

The MVP includes ONLY:

- One map: Dust Ridge (flat desert, 200 x 200 m, 2 enemy spawn points)
- Player: first-person movement, armor plates plus health, hitscan rifle, frag grenades, repair tool
- Build mode: first-person placement (aim at the ground, ghost preview, place), 2 m snap grid, one wall type, outpost core, one MG nest
- Destruction: wall segments with 4 damage states (intact, damaged, breached, collapsed), debris, rubble
- Enemies: riflemen and sappers
- Waves: 10 waves, build -> fight -> aftermath loop; win after wave 10, lose if the core is destroyed
- Cash economy: earned from kills, spent on building, repairs, and armor plates
- The HUD from `UI-Model.jpg` (see HUD Spec) and a retro render filter

Do NOT add: non-first-person cameras (top-down, third-person, spectator), vehicles, tanks, extra weapons, extra wall tiers, extra enemy types, perks, power-ups, menus beyond the basics, or any feature not listed above unless explicitly asked.

## Player Health and Armor Plates

There is no shield. The player has **armor plates** and **health**.

- Armor bar holds up to 3 plates (`config.armor.maxPlates`), 50 armor each (`config.armor.armorPerPlate`).
- Damage drains armor first, one plate segment at a time, then health.
- Armor does NOT regenerate. The player restores it by applying plates.
- The player carries spare plates (start with 3, carry up to 5, in config). Hold V to apply one plate (about 1 second each, can't shoot while plating, chains if V stays held).
- Spare plates are bought with cash at the armor crate next to the outpost core (look at it and press E). Cost per plate is in config (start at $250).
- Health is 100, does not regenerate during a fight, and refills to full at the start of each build phase.
- Events: `armorChanged`, `plateApplied`, `platePurchased`, `playerDamaged`, `playerDied`.

## Cash Economy

The player earns **cash**, never "points" or "salvage". Cash is always shown with a dollar sign.

- Earned from kills (rifleman $100, sapper $200, headshot bonus +$50) and a wave-clear bonus. All values in config.
- Spent on walls, repairs, the MG nest, and armor plates.
- Events: `cashEarned`, `cashSpent`.

## Visual Style (2001-2004 shooters)

Match `References/Game Reference/`: early Call of Duty / Medal of Honor era interiors and outposts, and Counter-Strike: Source's Dust-style desert architecture.

**Environment**
- Sandstone and plaster walls with chipped plaster revealing brick underneath, wooden double doors, stacked wooden crates, metal barrels, sandbags, corrugated metal roofs, wooden watchtowers, chain-link fences, army trucks.
- Wall damage states should reveal the brick or rebar under the plaster, like the chipped wall in `FPS-Model(3).jpeg`.
- Map props and enemy uniforms use a fictional faction. No real-world flags, insignia, or symbols.

**Models and textures**
- Low poly: props 200-1,500 triangles, characters 1,500-4,000 triangles, hard edges, simple silhouettes.
- Textures 256-512 px, tiled, with grime and wear painted into the texture. No normal maps, no PBR roughness/metalness look.
- Use `MeshLambertMaterial` or `MeshPhongMaterial`, not `MeshStandardMaterial`.
- Fake ambient occlusion with darkened vertex colors in corners and at the base of walls.

**Lighting and color**
- One strong warm sun with fairly hard shadows, darker shaded interiors, light distance fog.
- Slightly muted browns, tans, olive greens, and grays, with contrast a little higher than realistic.

**Weapons and effects**
- Big, chunky first-person view model taking up the lower right of the screen, with gloved hands visible, like `FPS-Model(2).jpeg` and `FPS-Model(3).jpeg`.
- Large bright orange-yellow star-shaped muzzle flash sprite that briefly lights the surroundings.
- Enemies: helmets, web gear, olive or gray uniforms, stiff readable animations.

**Retro render filter**
- Render the 3D scene to a lower internal resolution (default 50% of screen, `config.retro.renderScale`) and upscale with nearest filtering, plus slight color quantization.
- The HUD is NOT run through the retro filter. Render the HUD at full native resolution so text stays crisp.

**Avoid:** PBR materials, SSAO, motion blur, depth of field, lens flares, film grain, chromatic aberration, and bloom on anything except explosions and muzzle flashes.

## HUD Spec (copy `UI-Model.jpg`)

Copy the HUD in `References/UI reference/UI-Model.jpg` as closely as possible: same positions, sizes relative to screen, colors, brush-stroke backgrounds, and fonts. Build it with HTML/CSS layered over the canvas. No boxes or panels behind elements; use soft dark text shadows like the reference.

**Fonts**
- Use the EXACT fonts from the reference image. Font files live in `src/assets/fonts/`. If the exact font files are in that folder, use them.
- If they are not there, use the closest free match, self-hosted in `src/assets/fonts/` (no CDN), and list in your summary which fonts you used so they can be swapped:
  - Wave number: a red hand-drawn brush/marker font (closest match: Permanent Marker).
  - Cash, ammo, weapon name: a bold condensed sans-serif (closest match: Oswald SemiBold/Bold).
- Define the fonts once as CSS variables (`--font-wave`, `--font-hud`) so swapping is a one-line change.

**Bottom left (stacked as in the reference)**
1. **Cash counter:** where the reference shows the highlighted player's score. A square portrait slot (plain placeholder for now) on the left, then the cash amount with a dollar sign (for example `$11,235`) in white over a red brush-stroke smear. Show ONLY the player's own counter, no other players' rows.
2. **Cash popups:** small `+$50` texts that pop out to the right of the counter and drift up and fade, like the `+10` popups in the reference.
3. **Wave number:** large red hand-drawn number in the bottom-left corner, same size, color, and style as the `25` in the reference.
4. **Armor and health bars:** to the right of the wave number, like the reference. Top: the armor bar split into 3 plate segments with blue tops (empty segments dim gray). Below: the white health bar.
5. **Spare plates:** a small plate shape (simple drawn shape, no emoji) with `x3` next to it, to the right of the bars, showing spare plates carried.

**Bottom right**
1. **Grenades:** small grenade count above the ammo, as in the reference.
2. **Ammo:** large magazine number, a thin vertical divider, then a smaller zero-padded reserve count (`13 | 062`), over a red brush-stroke smear.
3. **Weapon name:** in white under the ammo (for example `M4`).

**Do NOT include** (from the reference): any perk icons, the `2x` power-up badge, the circular icons/ability slots on the right edge, the circular equipment icon beside the ammo, other players' portraits and scores, or the "AFTER" label.

**Also keep**
- A small minimal crosshair and hit marker in the center (not styled after the Game Reference images).
- The debug overlay, now hidden by default and toggled with F3.

No emojis anywhere in the UI.

## Tech Stack

- Three.js (rendering)
- Vite (build tool)
- TypeScript (strict mode)
- Rapier via `@dimforge/rapier3d-compat` (physics, character controller, debris)
- Grid-based A* for enemy pathfinding (walls block grid cells; breached/collapsed walls open them)
- Howler.js (audio)

## Project Structure

```
src/
  main.ts            // boot, game loop
  core/              // GameState, EventBus, time, input
  world/             // map, lighting, grid
  player/            // controller, camera, weapons, armor, repair tool
  build/             // build mode, placement, structures
  destruction/       // segment HP, damage states, debris, rubble
  enemies/           // AI, spawner, wave director
  combat/            // damage, projectiles, explosions
  economy/           // cash wallet, prices, armor crate
  ui/                // HUD, build menu, wave summary
  assets/            // models, textures, sounds, fonts
References/          // reference images (read-only, never ship these)
```

## Architecture Rules

- Systems communicate through the **EventBus** (e.g., `phaseChanged`, `segmentDamaged`, `segmentDestroyed`, `enemyKilled`, `waveCleared`, `coreDestroyed`, `cashEarned`, `armorChanged`). Avoid systems importing and calling each other directly.
- All damage goes through one function: `applyDamage(target, amount, type, position)`. Damage types: `ballistic`, `explosive`.
- Game phases are managed by a single state machine: `BUILD -> FIGHT -> AFTERMATH -> BUILD`, plus `WON` and `LOST`.
- Physics runs on a fixed 60 Hz step, separate from the render loop.
- Tunable numbers (HP, damage, armor, prices, cash rewards, timers, wave budgets) live in one config file: `src/core/config.ts`.
- The HUD only listens to events; it never reads or changes game state directly.
- Keep files small and focused. One class or system per file where practical.

## Performance Rules

- Target 60 FPS on a MacBook Air.
- Pool explosions, debris, bullets, decals, cash popups, and enemies. Do not create and destroy objects every frame.
- Cap active debris pieces at about 60.
- Use instanced meshes for repeated geometry (wall segments, rocks).
- One directional sun light with a small shadow map. No expensive post-processing beyond the retro filter.

## Art and Audio Rules

- Before M8, use placeholder geometry (boxes, cylinders, simple shapes), but give it the Visual Style colors and materials so the game already reads as 2000s.
- Explosions: sprite fireball, smoke puffs, debris chunks, screen shake.
- Sound: loud, punchy, compressed weapon sounds; crack-rumble-debris layering for destruction.
- Do not use emojis anywhere in the UI.

## Milestones

Work on one milestone at a time. Each must be tested and working before moving on.

1. **M1 Foundations:** Vite + TS + Three.js + Rapier setup, desert map, lighting, game loop, phase state machine
2. **M2 Player controller:** FPS movement, mouse look, jump, crouch, sprint, armor plates + health (replaces the original shield)
3. **M3 Rifle and grenades:** hitscan rifle, frag grenades, `applyDamage`, explosion effects
4. **M4 Build mode:** first-person placement with ghost preview, grid placement, walls, outpost core, MG nest, cash wallet, armor crate
5. **M5 Destruction:** segment damage states, debris, rubble, nav grid updates, repair tool
6. **M6 Enemies:** riflemen, sappers, breach targeting, pathfinding, cash rewards on kill
7. **M7 Waves and MG nest:** wave director, spawns, mountable MG, aftermath, win/loss
8. **M8 Art and retro pass:**
    - Replace placeholder art with low-poly models and textures per "Visual Style", matched against the Game Reference images (Dust Ridge buildings, walls with plaster-over-brick damage states, crates, barrels, sandbags, watchtower, enemies, rifle view model)
    - Retro render filter, with the HUD rendered at native resolution on top
    - Core sound set: rifle, reload, grenade, explosion layers, wall hits, MG, plate apply, cash earned
    - Compare screenshots side by side with the reference images and adjust until they match
9. **M9 Tune and playtest:** balance and performance

## Completed Milestones

M1 Foundations, M2 Player controller, M3 Rifle and grenades, HUD overhaul, M4 Build mode (edge-based walls with lips and joints), Sound system, M5 Destruction, M6 Enemies, Aim down sights, Reload animation, M7 Waves and MG nest

## Current Milestone

M8 Art and retro pass
