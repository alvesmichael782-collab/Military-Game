# Last Stand Fortress: balance check (M9)

Every number below is computed from `src/core/config.ts`, not guessed, and the key ones were also measured in the running game. The model reproduces the game's rules, read from the code:
- **Rifleman fire:** reaction time, 3-5 round bursts, spread that tightens with aim time and widens with range, aimed at the chest.
- **Hits on the player:** tested against the player's capsule.
- **Structures:** explosion falloff, damage multipliers and damage-state thresholds.
- **Waves:** the wave director's composition and squad timing.
- **MG:** heat and cooling, simulated at 600 steps a second.

"Before" is the config at the start of M9, "after" is the config now. "Measured" means a scripted run in headless Chrome against the live game.

## Summary

| Target | Before | After | Status |
| --- | --- | --- | --- |
| Rifleman TTK with the M4: about 4 body shots, 2 headshots | 5 body, 3 head | **4 body, 2 head** (measured: 25 per hit, dead on the 4th; headshot 50) | fixed |
| Sapper TTK: about 2 body shots | 3 | **2** (measured) | fixed |
| 3 full plates vs. 3 riflemen at mid range (25 m): about 4-5 s before health drops | 7.0 s (model median) | **4.8 s measured** (5 trials, 4.0-5.5 s); model 5.1 s | fixed |
| About 2 grenades breach an intact wall | 2 (3 to collapse) | 2 (measured: 300 -> 180 damaged -> 60 breached -> 0) | already on target |
| 1 satchel plus a little more collapses a wall | 1 satchel flattens it | **1 satchel breaches it at 30 HP** (measured); 1 more grenade or about 25 enemy rifle hits finish it | fixed |
| Rifle fire alone takes a long time on a wall | 100 rounds (3+ magazines, about 16 s of fire) | 100 rounds, unchanged on purpose | already on target |
| Wave 1 about 5-6 enemies | 5 | 5 | already on target |
| Wave 10 about 40-50, at most 20 alive | 42-45, cap 20 | 42-45, cap 20 | already on target |
| Sappers grow from wave 3 | 1 (w3) to 3-5 (w10) | same | already on target |
| Full run about 25-35 min including build phases | 23.6 min with full timers (model; bot floor 20.7) | **26.1 min** (bot floor 23.2) | fixed |
| Economy: by end of wave 5, about 20 walls + MG + repairs + plates affordable | yes, with $4,051 left over | yes, with $2,446 left over | on target |
| Economy: wave 10 tight, not hopeless, no huge pile | $17,073 unspent at the end (model) | $12,751 unspent (model) | **improved, still high; see note** |
| MG nest strong but can't hold a wave alone | about 0.76 kills/s sustained vs. 0.54 enemies/s arriving | **about 0.54 kills/s vs. 0.54 arriving** | fixed |

## Config changes applied

| Setting | Before | After | Why |
| --- | --- | --- | --- |
| `rifle.damage` | 20 | 25 | 4 body shots (100) and 2 headshots (2 x 50) kill a rifleman. |
| `sapper.hp` | 60 | 50 | 2 body shots (2 x 25). Grenades and the MG also kill sappers a little faster, which suits a fragile runner. |
| `rifleman.damage` | 8 | 10 | Together with the next row, 3 riflemen at 25 m strip 3 plates in about 5 s instead of 7. |
| `rifleman.spread.perTenMeters` | 0.35 | 0.2 | Riflemen lost too much accuracy at mid range (34% of rounds hit at 25 m). Close range barely changes: 3.9 s -> 3.4 s at 15 m. |
| `destruction.damageMultipliers.ballistic` | 0.15 | 0.12 | Keeps wall damage per bullet exactly as before after the damage changes: player rifle 3.0 per round, enemy rifle 1.2 per hit. |
| `satchel.damage` | 350 | 270 | One charge breaches an intact wall and leaves 30 HP, so walls need a satchel plus a little more. Still lethal at point blank (270 > 150 armor + 100 health). |
| `mg.heatPerShot` | 0.025 | 0.03 | Fewer rounds before overheating: 40 -> 34 from cold (3.2 s -> 2.7 s). |
| `mg.coolRate` | 0.3 | 0.2 | Short pauses no longer cool the gun almost as fast as it heats. Sustained fire falls from about 6.1 to about 4.4 rounds a second. |
| `economy.prices.wall` | 100 | 125 | More of the growing kill income goes back into walls and rebuilds. |
| `repair.cashPerHp.wall` | 0.17 | 0.21 | Keeps a full wall repair at about half the wall's price ($63 of $125). |
| `economy.prices.armorPlate` | 250 | 300 | Plates are bought every wave late in the game; makes armor a real spending choice. |
| `economy.waveClearBonus.perWave` | 50 | 25 | The bonus grew with the wave number on top of growing kill income ($750 at wave 10 -> $500). |
| `phases.buildDuration` | 60 | 75 | A full-timer run was 23.6 min, under the 25-35 min target; now about 26 min. |

Nothing outside `config.ts` changed for balance.

## Details

### Time to kill

| | Before | After |
| --- | --- | --- |
| Rifleman (100 HP), body / head | 5 / 3 | 4 / 2 |
| Sapper, body / head | 3 / 2 (60 HP) | 2 / 1 (50 HP) |
| MG vs rifleman / sapper, body | 4 / 3 | 4 / 2 |
| Grenade (120, full within 1 m, zero at 6 m): kills a sapper within | 3.5 m | 3.9 m |

Measured with the real rifle (single shots at a frozen enemy 10 m away): rifleman 75 -> 50 -> 25 -> dead; headshot 50; sapper 25 -> dead.

### Player survival

3 riflemen, player standing still in the open, 3 full plates (150 armor). Times are from when they spot the player to when the last armor goes.

| Range | Before (model median, 10-90%) | After (model median, 10-90%) | After, measured |
| --- | --- | --- | --- |
| 15 m | 3.9 s (3.6-4.3) | 3.4 s (2.6-3.8) | |
| 25 m | 7.0 s (5.8-8.4) | 5.1 s (4.1-5.8) | 4.8 s median (4.0, 4.0, 4.8, 5.4, 5.5) |
| 40 m | 18.8 s (14.6-23.9) | 9.8 s (7.7-12.2) | |

Moving, crouching or cover all make it longer. Longer-range fire is now noticeably more dangerous (40 m: 19 s -> 10 s). That's the cost of fixing mid range with a range-falloff change. If long range feels too punishing in playtests, set `perTenMeters` to 0.25 (25 m about 5.3 s, 40 m about 11 s).

### Walls and the core

| | Before | After |
| --- | --- | --- |
| Grenades to damage / breach / collapse a wall (300 HP) | 1 / 2 / 3 | 1 / 2 / 3 |
| One satchel on an intact wall | collapsed | breached, 30 HP left (measured) |
| Then to collapse it | | 1 grenade, or about 25 enemy rifle hits |
| Player rifle rounds to breach / collapse | 67 / 100 | 67 / 100 |
| Enemy rifle hits to collapse | 250 | 250 |
| Satchels to destroy the core (1,000 HP) | 3 | 4 |
| Enemy rifle hits to destroy the core | 125 | 100 |

The core takes damage as it comes, without the structure multipliers (`OutpostCore.takeDamage`). So the rifleman change makes rifle fire on an exposed core 20% deadlier, while the satchel change makes sappers 25% less deadly to it. I left the core's HP alone; the playtest logs record core HP per wave.

### Waves

| Wave | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Budget | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 |
| Sappers | 0 | 0 | 1 | 1-2 | 1-2 | 2-3 | 2-3 | 2-4 | 2-4 | 3-5 |
| Total enemies | 5 | 10 | 13 | 17-18 | 22-23 | 25-27 | 30-32 | 34-37 | 39-42 | 42-45 |

237-252 enemies over a full run, at most 20 alive at once (`waves.maxAlive`).

### Run length

Fight length was measured with a full 10-wave bot run against the live game. The bot played with real squads, spawn timing and the alive cap, kept a 32-wall ring rebuilt, and killed the nearest enemy within 75 m every 1.5 s. It kills almost on arrival, so its fight times are the floor the spawn schedule sets. The model adds about 25 s a wave for a human to walk out, fight and finish the last squad, and agrees with the bot plus about 20 s a wave.

| Wave | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fight, bot measured (floor) | 15 s | 25 s | 29 s | 37 s | 58 s | 48 s | 55 s | 76 s | 73 s | 78 s | 8.2 min |
| Fight, model (human) | 33 s | 42 s | 50 s | 61 s | 70 s | 66 s | 75 s | 82 s | 91 s | 98 s | 11.1 min |

| Whole run | Before (60 s build) | After (75 s build) |
| --- | --- | --- |
| Using the full build and aftermath timers (model fights) | 23.6 min | **26.1 min** |
| Same, with bot-speed fights (floor) | 20.7 min | 23.2 min |
| Quick player: starts each wave after about 30 s, skips the summaries | about 17 min | about 17 min |

Change: `phases.buildDuration` 60 -> 75. A full-timer run was just under the 25-35 minute target. The extra time goes where the economy needs it, to building and repairing. I didn't lengthen the fights by spacing squads out, because that would lower the arrival rate the MG balance above is set against. Players who press Enter early still get the short run they choose.

The bot run also served as an end-to-end check: it **won all 10 waves**, with **0 console errors**, and each of the 19 missing-sound warnings appeared exactly once.

### Economy

Income assumes the player kills 85% of each wave ("kills most enemies") with 25% headshots, plus the wave-clear bonus. The spending model is a player who keeps up:
- **Walls:** 8 before wave 1, then 3 a wave to 20 by wave 5, then 2 a wave to 30.
- **MG nest:** bought before wave 3.
- **Rebuilds:** one lost wall per sapper plus half a wall a wave, rebuilt.
- **Repairs:** (2 + 0.5 x wave) walls from half HP, plus MG repairs from wave 5.
- **Plates:** (1 + 0.3 x wave) bought each wave.

| Wave | Income before | Cash at end, before | Income after | Spend after | Cash at end, after |
| --- | --- | --- | --- | --- | --- |
| 1 | $778 | $1,089 | $753 | $1,469 | $784 |
| 2 | $1,306 | $1,569 | $1,256 | $1,012 | $1,029 |
| 3 | $1,728 | $1,533 | $1,653 | $1,993 | $689 |
| 4 | $2,251 | $2,632 | $2,151 | $1,411 | $1,429 |
| 5 | $2,779 | $4,051 | $2,654 | $1,637 | $2,446 |
| 6 | $3,249 | $5,852 | $3,099 | $1,742 | $3,802 |
| 7 | $3,777 | $8,094 | $3,602 | $1,848 | $5,556 |
| 8 | $4,284 | $10,705 | $4,084 | $2,016 | $7,623 |
| 9 | $4,812 | $13,756 | $4,587 | $2,122 | $10,088 |
| 10 | $5,266 | $17,073 | $5,016 | $2,353 | $12,751 |

- **By wave 5:** the full plan (20 walls, the MG, repairs, plates) is affordable, and it never dips below about $700 after a build phase. On target.
- **By wave 10:** kill income grows with wave size ($5,000 at wave 10) faster than this player's spending does. The model ends with about $12,750 unspent. The price changes cut that by about $4,300, but it is still more than "tight". Two things are unknown until you play:
  1. How much late waves really destroy. Late sappers carry 3 charges each, so rebuild costs may be much higher than this model assumes.
  2. How much you really spend.

  The playtest logs record cash earned and spent per wave by reason, so the next pass can use real numbers. **Your call:** if the logs confirm a pile, the remaining lever is the kill rewards. `CLAUDE.md` fixes them at $100 / $200 / +$50, so I didn't change them. Rifleman $100 -> $75 would remove about $5,000 over a run.

### MG nest

| | Before | After |
| --- | --- | --- |
| Rounds before overheating, from cold | 40 (3.2 s) | 34 (2.7 s) |
| Trigger held through overheats: average rounds/s | 6.1 | 4.4 |
| Best pulsed fire (bursts that stop short of overheating): rounds/s | 6.1 | 4.4 |
| Share of time actually firing | 48% | 33% |
| Kills per second at 50% hits (4 hits a rifleman) | 0.76 | 0.54 |
| Enemies arriving per second, waves 5 / 8 / 10 | 0.42 / 0.54 / 0.54 | same |

Before, the MG out-killed the arrival rate even at 50% accuracy, and pausing let it cool almost as fast as it heated, so it rarely had to break. Now it can match a late wave only with near-constant accurate fire. It spends two thirds of its time cooling, its 120 degree arc can't cover everything, and riflemen shoot the gunner. Strong, but it needs walls and the rifle. 50% accuracy is an assumption; the playtest logs count MG kills per wave.
