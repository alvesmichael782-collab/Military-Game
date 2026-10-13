# Last Stand Fortress: playtest guide (M9)

Play **5 full runs**, one per plan below. Each run takes about 20-35 minutes. After each run, send me the JSON file the game saves.

## Before you start

- Run `npm run dev` and open the address it prints in Chrome (the run log and the F3 frame readout need Chrome).
- Keep `config.debug.enabled` on (it is on now). That turns on the run log, F8, F3 and the test keys.
- **Don't use the test keys** (J, K, L, M, N, U, 7, 8, 9, 0, F9) during a run. They distort the numbers. Enter is fine: it starts a wave early and skips the wave summary.
- **The run log:** at game over, win or lose, the game saves `last-stand-run-<date>-<time>.json` to your Downloads folder by itself. Press **F8** to save it at any other moment, for example if you quit partway through. Each wave also prints a short summary to the browser console (Cmd+Option+J).
- **Performance:** press **F3** now and then to see the frame time. On a MacBook Air, `FRAME` should stay near 16.7 ms. If it doesn't, note the wave and what was on screen.

## The five runs

| Run | Plan | Try in particular |
| --- | --- | --- |
| 1 | **Normal game.** Play the way you'd naturally play. | Use the full build phase. Buy plates when you need them. This is the baseline. |
| 2 | **Walls only.** No MG nest at all. | Build a full ring early and keep repairing it. Do you have to choose between walls and plates? |
| 3 | **MG-heavy.** Build the nest before wave 2 and spend most fights on it. | Can you hold a wave from the MG alone? How often does it overheat? Do enemies flank its 120 degree arc? |
| 4 | **No repairs, aggressive.** Never repair. Fight outside the walls and push toward the spawns. | Do 3 riflemen at mid range drop your plates in about 4-5 seconds? Does dying feel fair, and can you tell what killed you? |
| 5 | **Sapper focus.** Leave sappers alone until they plant, then deal with the breach. | Does one satchel breach a wall rather than flatten it? How fast do sappers reach the core? Do enemies get stuck in rubble or around buildings? |

## What to watch for

- **Fun:** where did it drag, and where was it too hard? Note the wave number.
- **Cash:** were you ever broke? Did cash pile up unused (more than about $5,000 by wave 8-10)?
- **Time to kill:** 4 body shots or 2 headshots for a rifleman, 2 body shots for a sapper.
- **Enemies:** stuck anywhere, walking through walls, or standing still for a long time.
- **Bugs:** anything that looks or feels wrong. Note the wave, and take a screenshot if you can.
- **Run length:** the run log records it, but tell me if it felt too long or too short.

## Send back

1. The five `last-stand-run-*.json` files.
2. A line or two per run: what felt good, what felt off, and any bugs (with the wave number).
