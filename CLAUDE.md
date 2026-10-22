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
- Player: first-person movement, armor plates plus health, hitscan guns and a knife (see "Weapons and Loadout"), frag grenades, repair tool
- Build mode: first-person placement (aim at the ground, ghost preview, place), 2 m snap grid, one wall type, outpost core, one MG nest, the weapon crate and the consumables crate (see "Crate Shops")
- Destruction: wall segments with 4 damage states (intact, damaged, breached, collapsed), debris, rubble
- Enemies: riflemen and sappers
- Waves: 10 waves, build -> fight -> aftermath loop; win after wave 10, lose if the core is destroyed
- Start screen and co-op multiplayer, 1-4 players (see "Start Screen and Multiplayer")
- Cash economy: earned from kills, spent on building, repairs, armor plates, and weapons
- The HUD from `UI-Model.jpg` (see HUD Spec) and a retro render filter

Do NOT add: non-first-person cameras (top-down, third-person, spectator), vehicles, tanks, extra wall tiers, extra enemy types, perks, power-ups, menus beyond the basics, or any feature not listed above unless explicitly asked.

## Player Health and Armor Plates

There is no shield. The player has **armor plates** and **health**.

- Armor bar holds up to 3 plates (`config.armor.maxPlates`), 50 armor each (`config.armor.armorPerPlate`).
- Damage drains armor first, one plate segment at a time, then health.
- Armor does NOT regenerate. The player restores it by applying plates.
- The player carries spare plates (start with 3, carry up to 5, in config). Hold V to apply one plate (about 1 second each, can't shoot while plating, chains if V stays held).
- Spare plates are bought with cash at the consumables crate (see "Crate Shops"). Cost per plate is in config (`economy.prices.armorPlate`).
- Health is 100, does not regenerate during a fight, and refills to full at the start of each build phase.
- Events: `armorChanged`, `plateApplied`, `platePurchased`, `playerDamaged`, `playerDied`.

## Weapons and Loadout

Every weapon is one data file in `src/player/weapons/defs/` (stats, price, fire mode, recoil pattern, ADS sights, reload key times, view model pose, hand grips, sound IDs) plus its converted model. Adding a weapon needs only a new def file and its model; defs are found automatically. Source models live in `Models/Weapons/` and are converted with `npm run convert:weapons` (`scripts/convert-weapons/`) into `src/assets/models/weapons/<id>.glb` and `src/assets/textures/weapons/<id>.png` (color texture only, 512 px, 256 px for small items; models over about 8,000 triangles are simplified). The MG nest gun (`Models/Weapons/AR's/MG`) is not part of this.

**Slots:** slot 1 (gun), slot 2 (gun), slot 3 (melee), on keys 1, 2, 3 (`config.keybinds.slot1..3`, rebindable). The player spawns with only the starting pistol (`config.weapons.startingWeapon`) in slot 1.

**Buying a gun** (`src/player/weapons/Loadout.ts`):
- Already carried: that gun's magazine and reserve are refilled (at its `refillPrice`); nothing moves.
- One gun carried: the new gun goes into slot 1, the old one moves to slot 2.
- Both gun slots full: the new gun replaces the gun in hand, in that slot; the other stays. With the knife in hand, it replaces the gun in the slot used last.
- The new gun is drawn.

**Buying a knife** always puts it in slot 3 (replacing any knife there) and draws it. Pressing 3 with no knife does nothing.

**Switching:** holster the current weapon, then draw the next (per weapon `holsterTime` + `drawTime`, about 0.4-0.6 s). Each gun keeps its own magazine and reserve. Switching cancels reload and ADS. No switching while mounted on the MG, building, repairing, or plating. The HUD's weapon name and ammo follow the weapon in hand; the knife hides the ammo numbers. Events: `weaponEquipped`, `weaponPurchased`, `loadoutChanged`.

**Weapon crate:** a buildable shop (see "Crate Shops"). Its menu lists every weapon by section (`category` in each def: pistols, SMGs, assault rifles, melee; cheapest first in each), and buying goes through the CashWallet and the rules above (a carried gun's row refills it instead).

**Knife:** tap to slash (alternating sides), hold to stab; hits through `applyDamage` with source `player` and type `melee`. Walls take `config.destruction.damageMultipliers.melee` of it (very little). No ADS.

**Moving parts** are animated only where the model has them as separate meshes, or as a rigid piece rigged to its own bone (the converter splits out the triangles bound to that bone, see `parts.*.bones` in `scripts/convert-weapons/weapons.mjs`). Today: magazines, and the SG-09 slide (cycles per shot, locks back on empty, released by the empty reload). Guns without a magazine part use hand-only reloads; the revolver uses tilt-and-load.

## Cash Economy

The player earns **cash**, never "points" or "salvage". Cash is always shown with a dollar sign.

- Earned from kills (rifleman $100, sapper $200, headshot bonus +$50) and a wave-clear bonus. All values in config.
- In multiplayer every player has their own cash. A kill pays only the player who made it; the wave-clear bonus pays every player in full; each player pays for what they build, repair and buy. Removing a structure refunds whoever built it.
- Spent on walls, repairs, the MG nest, the two crates, armor plates and grenades from the consumables crate, and weapons and ammo from the weapon crate.
- Events: `cashEarned`, `cashSpent`.

## Crate Shops

There is no fixed armor crate. Both shops are buildable structures (build tool, after the MG nest): one cell, price and limit in config (`economy.prices.weaponCrate` / `consumablesCrate`, `build.maxWeaponCrates` / `maxConsumablesCrates`), not damageable, F removes them. Code: `src/build/ShopCrate.ts` (structure and models), `src/economy/CrateShop.ts` (shared shop logic), `WeaponShop.ts`, `ConsumablesShop.ts`, `src/ui/shop/` (menu and silhouettes).

- **Weapon crate:** olive crate stenciled "ARMS". Sells weapons (see "Weapons and Loadout").
- **Consumables crate:** bare wood crate stenciled "SUPPLY". Sells armor plates and frag grenades, one per click, up to what the player can carry (`armor.maxSpares`, `grenade.maxCount`; prices `economy.prices.armorPlate` / `grenade`). A new consumable is one entry in `ConsumablesShop.ts`.
- **Opening:** in any phase, look at a crate within its `useRange` and press E (context-sensitive with repairs and the MG nest; closest target wins). The menu frees the mouse but does NOT pause the game. E, Esc or Tab closes it and captures the mouse again (the pause menu must not flash up while the browser re-captures it). It also closes on death, game over, or leaving the window.
- **Menu:** a column on the left: crate name and cash, one tab per section (no tabs for a single section), and one full-width row per item: a white silhouette (weapons rendered side-on from their models at startup, consumables drawn shapes), name, a detail line, and the price. The whole row is the buy button. Only the row directly under the mouse is highlighted (nothing is highlighted otherwise): it turns white with the silhouette and all text black. Click buys; A/D or left/right switch sections. A row that cannot be bought shows the reason in red in place of the detail line and shakes when tried; a purchase flashes the row red. Square corners, HUD fonts and colors, no emojis.
- **Events:** `shopPromptChanged`, `shopOpened` / `shopChanged` (the full catalog), `shopClosed`, `shopBuyRequested`, `shopCloseRequested`, `shopPurchased`, then `platePurchased`, `grenadePurchased` or `weaponPurchased`. The menu never reads game state.

## Start Screen and Multiplayer

**Start screen** (`src/ui/start/`): the title and SINGLE PLAYER / MULTIPLAYER on the left over the live map (a slow orbit around the core, through the retro filter), in the pause menu's style (bevelled panels, khaki text, one red accent, HUD fonts). The game loads behind it. Multiplayer opens a panel: callsign (saved), CREATE LOBBY, or JOIN with a 5-character code. The lobby shows the code (COPY), the squad (4 slots, HOST / YOU, LOADING / READY) and START for the host once everyone has loaded. After a single player game, Enter restarts straight into a new one; after a multiplayer game it goes back to the menu.

**Networking** (`src/net/`): co-op for up to 4 players over WebRTC data channels with PeerJS (its public broker only introduces the peers; the host's peer id is built from the lobby code). Star layout, host-authoritative world. `NetSession` (lobby, batched messages, one flush per frame), `NetGame` (coordinator), `protocol.ts` (every message), `EventRelay` (host events clients replay), `EnemySync` (host snapshots, client interpolation), `RemotePlayers` (teammates), `StructureSync` (structures). Rates and limits in `config.multiplayer`.
- **Host** runs everything as in single player: phases, the wave director, enemy AI, satchels, structure HP, the core. Waves grow by `extraPlayerBudget` per extra player.
- **Clients** run their own player (movement, aim, weapons, cash, shops, build tool) and follow the host: `GameState.follow`, `EnemyManager.setReplica` (soldiers posed from snapshots, hitboxes kept, no AI), `WaveDirector.disable`. Their hits on enemies, structures and the core go to the host through the damage router (`setDamageRouter` in `combat/Damage.ts`), which applies them with that player's id, so kill credit is right. Builds, removals, rubble clears and repairs are requests to the host (`StructureCommands`); HP changes come back as differences.
- **Every machine** sends its player's state (`playerSendRate`), shots (`allyFired`: flash, tracer, positioned sound), impacts and grenades. Other players' grenades and the host's satchels are mirrored as `harmless` copies; only the owner's copy deals damage.
- **Teammates** are soldier bodies in `allyUniform` with name tags, a capsule on the player layer (enemies see, shoot and bump them; players' bullets pass through: no friendly fire), and enemy targets (`EnemyContext.players`; riflemen pick the nearest seen player). Enemy hits on a teammate are worked out on the host and sent to that player's machine.
- **Down, not out:** a player at 0 health is down ("YOU ARE DOWN") until the next build phase, then back at full health at their spawn. The game is lost when every player is down at once, or the core falls.
- **Votes:** Enter starts the wave (build) or skips the summary (aftermath) only once every player has pressed it (`readyChanged`, shown in the phase banner and summary).
- The pause menu never pauses in multiplayer. The MG takes one gunner at a time. If the host leaves, clients get a "Connection lost" screen with a way back to the menu; a client leaving just disappears for the others.
- Kill and kill-related events carry player ids (`net/PlayerId.ts`: host `p0`, clients `p1`-`p3`; always `p0` in single player).
- Testing: WebRTC may not connect two tabs on one machine (VPN, firewall). Dev builds with `?loopback` link tabs of one browser over a BroadcastChannel instead (`net/LoopbackPeer.ts`, stripped from production builds).

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

**Damage Feedback** (allowed HUD elements for damage the player takes; all values in `config.damageFeedback`)
- Every `playerDamaged` event carries where the hit came from (`position`: the shooter's eye position for bullets, the blast center for grenades and satchels), `armorDamage` and `healthDamage`, and `attacker` (the enemy that fired, or null for blasts). `armorBroken` fires when armor goes from above 0 to 0.
- **Directional indicators** (`src/ui/hud/DamageIndicators.ts`): early-2000s style flat bars curving along an invisible ring around the screen center (radius about 18% of screen height), each spanning about 52 degrees of the ring and thinning toward its ends. Drawn as a low-res sprite scaled up with hard pixel edges: flat, semi-transparent color, no outline, no glow, a fade in hard steps. Not run through the retro filter. It points at where the hit came from and keeps tracking as the player turns or moves (ahead = top, behind = bottom). Blue when the armor took the hit, red when any of it reached health. Opacity and thickness scale with damage; holds about 0.5 s, fades over about 1.5 s. Repeat hits from one attacker refresh and strengthen its wedge; other attackers and every blast get their own. Up to 8, pooled.
- **Camera jolt** (`src/player/HitJolt.ts`): an additive camera offset like ScreenShake (never moves the aim), pushing the view the way the shot travelled with a little pitch, yaw and roll, scaled by damage, recovering in about 0.2 s. Weaker while aiming down sights or mounted on the MG.
- **Armor shatter** (`src/ui/hud/ArmorShatter.ts`): when the last plate breaks, a procedural broken-glass crack pattern over the whole screen radiating from the side of the breaking hit (bright impact point, branching cracks, a few light blue shards with white highlights). Snaps in with a short blue-white flash, holds about 0.4 s, fades over about 1 s. A few layouts are generated at startup. Sound hook `player.armor.shatter`.
- **Low health** (`src/ui/hud/LowHealthOverlay.ts`, levels from `src/core/LowHealthLevels.ts`): below 50% health, dark procedural blood splatter and smears creep in from the edges and corners with a dark red vignette, and the 3D scene blurs toward the edges (in the retro filter's pass, never the HUD). Below 25% it gets clearly worse: blood reaches further in, the vignette darkens, the blur grows toward the center, colors desaturate, and it pulses with a heartbeat (about 1 per second, sound hook `player.heartbeat`). Scales smoothly and fades out when health rises.
- All of these sit under the HUD's numbers and bars, so those stay readable. Debug: Shift+K deals a test hit from a random direction.

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
  economy/           // cash wallet, prices, crate shops
  net/               // multiplayer: session, sync, teammates
  ui/                // HUD, build menu, wave summary
  assets/            // models, textures, sounds, fonts
References/          // reference images (read-only, never ship these)
```

## Architecture Rules

- Systems communicate through the **EventBus** (e.g., `phaseChanged`, `segmentDamaged`, `segmentDestroyed`, `enemyKilled`, `waveCleared`, `coreDestroyed`, `cashEarned`, `armorChanged`). Avoid systems importing and calling each other directly.
- All damage goes through one function: `applyDamage(target, amount, type, position)`. Damage types: `ballistic`, `explosive`, `melee`.
- Game phases are managed by a single state machine: `BUILD -> FIGHT -> AFTERMATH -> BUILD`, plus `WON` and `LOST`.
- Physics runs on a fixed 60 Hz step, separate from the render loop.
- Tunable numbers (HP, damage, armor, prices, cash rewards, timers, wave budgets) live in one config file: `src/core/config.ts`. The exception is per-weapon stats, which live in each weapon's def file (see "Weapons and Loadout").
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

M1 Foundations, M2 Player controller, M3 Rifle and grenades, HUD overhaul, M4 Build mode (edge-based walls with lips and joints), Sound system, M5 Destruction, M6 Enemies, Aim down sights, Reload animation, M7 Waves and MG nest, M8 Art and retro pass, M9 Tune and playtest
