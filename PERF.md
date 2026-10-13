# Last Stand Fortress: performance (M9)

All measurements are on the target machine, a **MacBook Air (M1, 8 GB)**, in Chrome (headless, Metal), at 1440 x 900 with the retro filter on, against the dev build.

## Stress test

Start it with **`?stress`** in the URL (for example `http://localhost:5173/?stress`), or toggle it with **F9** (debug only). It runs until toggled off (`src/core/StressTest.ts`) and keeps up:
- a ring of **60 walls** about 15 m around the core, rebuilt every 2 s as they fall;
- **20 enemies alive** (riflemen with a sapper every fourth), fighting normally;
- a **grenade blast every 0.4 s** and a **satchel every 1.5 s** against random ring walls, so walls are constantly cracking, breaching and collapsing (about 5 collapses a second);
- debris at its 60-chunk cap, rubble piles and smoke all the time;
- the player kept alive.

Press **F3** during the test (or any time) to see the frame split live: `FRAME`, `CPU` with `RENDER`, `PHYSICS`, `AI`, `PATHS` and `REST`, plus draw calls, triangles and heap.

## Results

600 frames after 20 s of build-up. Frame times are measured between frames. CPU times come from `src/core/FrameProfiler.ts`, averaged per frame:

| | Before fixes | After fixes |
| --- | --- | --- |
| Frame time, median / 95% / 99% / worst | 16.7 / 16.7 / 16.8 / 16.8 ms | 16.7 / 16.8 / 16.8 / 16.8 ms |
| Frames over 20 ms | 0 of 600 | 0 of 600 |
| CPU per frame, total | 3.89 ms | **3.22 ms** |
| Render (draw submission: shadows, world, view model, upscale) | 1.28 ms | **1.01 ms** |
| Physics (Rapier step, player controller, grenades, debris) | 1.35 ms | **0.87 ms** |
| AI (enemy thinking, movement, sight, wave director) | 0.75 ms | 0.74 ms |
| Path searches | 0.14 ms | 0.23 ms |
| Rest (HUD, effects, sound, input) | 0.37 ms | 0.37 ms |
| Draw calls / triangles per frame | 146 / 183k | 152 / 193k |
| JS heap | 88.5 MB | **65.5 MB** |
| Garbage allocated (sampled) | 15.4 MB/s | **6.0 MB/s** |

**60 FPS holds.** The frame is pinned to vsync with 13 ms to spare. To see the real headroom, I also ran it with the frame cap off: the whole stress frame, GPU included, takes **2.2 ms median, 3.1 ms at the 99th percentile, 3.7 ms worst**. That's roughly 5x headroom.

Normal play is lighter: with 20 enemies in a regular wave it's about 100 draw calls and 144k triangles (measured at the end of M8).

## What I fixed

| Problem | Where | Fix | Effect |
| --- | --- | --- | --- |
| Rapier's `World.step()` re-syncs its JS handle maps after every step, calling back into JS for every body and collider (about 1,000 colliders here) and allocating each time. | `src/core/Physics.ts` | Step through the public `physicsPipeline.step(...)` and run the full map sync once a second as a safety net. The game only adds and removes bodies through the World API, which keeps the maps current. | Physics 1.35 -> 0.87 ms; about 6.6 MB/s less garbage |
| three.js draws all shadow casters with one shared depth material. Its shader differs for instanced meshes, so it was re-derived many times a frame as the shadow pass alternated between plain and instanced casters. | new `src/world/ShadowDepth.ts`, `main.ts` | Instanced casters get their own shared depth materials, one plain and one for per-instance colors (the soldiers). | about 2 MB/s less garbage; part of render 1.28 -> 1.01 ms |
| Same flip in the main pass: the `pole` and `burlap` prop materials were shared by plain and instanced meshes. | `src/world/PropMaterials.ts` (`forInstances`), `src/world/props/Clutter.ts` | Instanced props use copies of their materials (same textures). | three no longer rebuilds program parameters each frame |
| `EventBus.emit` copied the handler set into a new array on every event, and several events fire every frame. | `src/core/EventBus.ts` | Dispatch from a cached handler array, rebuilt only when handlers change. Same semantics. | no allocation per event |
| The debug overlay's state object (and a template string) was built every frame even with the overlay hidden. | `src/main.ts`, `src/ui/DebugOverlay.ts` | Built only while the overlay is visible; the click prompt has its own call. | no per-frame object when hidden |
| Debris read position, rotation and velocity back from Rapier for every chunk every step, even resting ones, and built a new `Map` every frame. | `src/destruction/Debris.ts` | Sleeping chunks are skipped; the per-frame map is reused. | fewer Rapier reads and allocations |

## Checked and fine as is

- **Pooling:**
  - Enemies: a pool of 80 objects (40 per type), at most 40 active.
  - Grenades 6, satchels 16, decals 50 bullet holes and 12 scorch marks, particles 400 smoke and 400 glow, cash popups 10.
  - Debris: capped at 60 chunks and held exactly at 60 under stress.
  - Rubble: up to 600 piles.
  - Nothing is created or destroyed per frame.
- **Instancing:**
  - Walls (per damage look), rocks, props, soldiers (about 10 draw calls for all of them), debris and rubble.
  - Since M8, only live soldiers are drawn.
- **Shadows:** one directional sun, a single 2048 px map over the play area. It's cheap here (whole frame 2.2 ms uncapped), so I didn't shrink it; a smaller map would only blur the shadows.
- **Path searches and sight checks:** paths are capped at 4 searches and 3 ms a frame (measured 0.14-0.23 ms under stress); sight raycasts at 14 a frame.

## Leak check

**10 full waves** (the bot run from `BALANCE.md`, repeated on the final code: real waves, a 32-wall ring, the game won, 0 console errors, each missing-sound warning once). Measured at the start of each wave's aftermath, after garbage collection:

| Wave | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| JS heap (MB) | 62.1 | 62.0 | 62.2 | 62.3 | 62.4 | 62.4 | 58.3 | 58.3 | 58.3 | 58.4 |
| Geometries | 74 | 74 | 78 | 78 | 78 | 78 | 78 | 78 | 78 | 78 |
| Textures | 28 | 28 | 28 | 28 | 28 | 28 | 28 | 28 | 28 | 28 |
| Shader programs | 29 | 29 | 31 | 31 | 31 | 31 | 31 | 31 | 31 | 31 |
| Scene objects | 391 | 391 | 391 | 391 | 391 | 391 | 391 | 391 | 391 | 391 |
| Event handlers | 142 | 142 | 142 | 142 | 142 | 142 | 142 | 142 | 142 | 142 |

The step at wave 3 is the first satchel and its effects (4 geometries, 2 shaders), created once. Nothing grows after that. The final code compiles 31 shader programs, against 38 on the earlier snapshot run; I didn't track down which variants went away, and the count is steady within each run.

That bot killed sappers before they reached the walls, so it barely exercised destruction. **Destruction churn** was checked separately: 6 minutes of the stress test, sampled every 30 s after garbage collection:

| Time | 0:30 | 1:00 | 2:00 | 3:00 | 4:00 | 5:00 | 6:00 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Walls collapsed so far | 147 | 302 | 625 | 951 | 1267 | 1590 | 1910 |
| JS heap (MB) | 63.1 | 63.4 | 63.6 | 63.7 | 63.7 | 63.8 | 63.7 |
| Geometries | 80 | 80 | 80 | 80 | 80 | 80 | 80 |
| Textures | 28 | 29 | 29 | 29 | 29 | 29 | 29 |
| Shader programs | 33 | 33 | 33 | 33 | 33 | 33 | 33 |
| Scene objects | 391 | 391 | 391 | 391 | 391 | 391 | 391 |
| Rapier bodies | 218 | 217 | 218 | 219 | 219 | 219 | 219 |
| Rapier colliders | 1028 | 986 | 977 | 967 | 1018 | 1034 | 1029 |
| Event handlers | 141 | 141 | 141 | 141 | 141 | 141 | 141 |

The heap stays flat (63.1 -> 63.7 MB over 1,910 collapses, level from minute 3 on), and the GPU resources, scene objects, physics bodies and listeners don't grow. Colliders go up and down by a few dozen as walls and rubble come and go, with no trend. There were 0 console errors.

## Tools (debug only, behind `config.debug.enabled`)

- `?stress` / **F9**: the stress test.
- **F3**: the overlay, with the frame split, draw calls, triangles and heap.
- `src/core/FrameProfiler.ts`: the per-section timer the overlay and these numbers use. It costs about ten `performance.now()` calls a frame.
