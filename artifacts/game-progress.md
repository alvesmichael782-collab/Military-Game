# M9 Tune and playtest: progress

Started 2026-10-12. Re-read this after any interruption.

## Constraints (from the M9 brief)
- No new features, weapons, enemy types or HUD elements. Balance changes in `src/core/config.ts` only, unless it is a bug.
- PlaytestLog listens to existing events; add events (or fields) only where data is missing.
- All debug keys and overlays behind `config.debug.enabled` (on for now).
- Deliverables: `src/core/PlaytestLog.ts` (F8 + auto download on game over), `BALANCE.md`, `PERF.md`, stress test (`?stress` or a debug key), bug sweep, `PLAYTEST.md`, list of files and config values changed.

## Status (M9 complete, awaiting the user's 5 playtest runs)
- [x] 1 Playtest log (verified by scratchpad logtest.mjs: console summaries + auto JSON on game over; MG-kill inference still to verify with a real mount in the bug sweep)
- [x] 2 Balance: BALANCE.md written; all changes in config.ts; measured in game + 10-wave bot run (won, 0 errors)
- [x] 3 Perf: PERF.md done (stress 60 FPS on MacBook Air M1, uncapped 2.2 ms; leak checks flat over 10 waves and 6 min/1,910 collapses)
- [x] 4 Bug sweep: bugsweep.mjs 13/13 pass (deaths in each state, restart, phases, nest destroyed mounted, collapse under player, satchels at core/crate, cash, pointer lock). F8/F9 added to ALWAYS_PREVENT. Final 10-wave run on final code: won, 0 errors, 19 audio warnings once each. npm run build passes.
- [x] 5 PLAYTEST.md

## Decisions
- Cash events got a `reason` field (CashEarnReason / CashSpendReason); Purse and CashWallet take it. MatchStats no longer counts refunds as cash earned.
- MG kills: ballistic player kill while mounted (rifle cannot fire mounted). Player damage source from damageDealt (source+type) right after playerDamaged.
- PlaytestLog, F8, console logging and all test keys are behind config.debug.enabled. Enter (start wave / skip aftermath / restart) is not debug.
- Per-wave record = BUILD n + FIGHT n + AFTERMATH n; printed when it closes (next BUILD or game over).
- Test harness in session scratchpad: common.mjs, bot.mjs (fastPhases, startBot kills via applyDamage, waitPhase), logtest.mjs. Dev handle __game now also exposes applyDamage.

## Config values changed
- rifle.damage 20 -> 25; sapper.hp 60 -> 50 (TTK 4 body/2 head, sapper 2)
- rifleman.damage 8 -> 10; rifleman.spread.perTenMeters 0.35 -> 0.2 (survival 25 m ~5 s)
- destruction.damageMultipliers.ballistic 0.15 -> 0.12 (keeps rifle/enemy wall damage per bullet unchanged)
- satchel.damage 350 -> 270 (breach, leaves 30 HP)
- mg.heatPerShot 0.025 -> 0.03; mg.coolRate 0.3 -> 0.2 (sustained ~4.4 rps)
- economy.prices.wall 100 -> 125; repair.cashPerHp.wall 0.17 -> 0.21; economy.prices.armorPlate 250 -> 300; economy.waveClearBonus.perWave 50 -> 25
- phases.buildDuration 60 -> 75 (run length 23.6 -> 26.1 min with full timers)

## Files created or changed
New: src/core/PlaytestLog.ts, src/core/FrameProfiler.ts, src/core/StressTest.ts, src/world/ShadowDepth.ts, BALANCE.md, PERF.md, PLAYTEST.md, artifacts/game-progress.md
Changed: src/core/config.ts, src/core/EventBus.ts, src/core/GameLoop.ts, src/core/Input.ts, src/core/Physics.ts, src/core/MatchStats.ts, src/main.ts, src/ui/DebugOverlay.ts, src/economy/CashWallet.ts, src/economy/Purse.ts, src/economy/KillRewards.ts, src/economy/WaveRewards.ts, src/economy/ArmorCrate.ts, src/build/BuildTool.ts, src/player/RepairTool.ts, src/player/PlayerHealth.ts, src/player/PlayerArmor.ts, src/enemies/EnemyManager.ts, src/destruction/Debris.ts, src/world/PropMaterials.ts, src/world/props/Clutter.ts, CLAUDE.md
