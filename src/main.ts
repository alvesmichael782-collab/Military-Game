import RAPIER from '@dimforge/rapier3d-compat';
import { PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { BuildTool } from './build/BuildTool';
import { loadMgGunModel } from './build/MgGunAsset';
import { OutpostCore } from './build/OutpostCore';
import type { Structure } from './build/Structure';
import { StructureManager } from './build/StructureManager';
import { CombatEffects } from './combat/CombatEffects';
import { applyDamage, bindDamageEvents } from './combat/Damage';
import { DamageableRegistry } from './combat/DamageableRegistry';
import { Explosions } from './combat/Explosion';
import { Grenades } from './combat/Grenades';
import { MachineGun } from './combat/MachineGun';
import { connectCombatSounds } from './core/audio/CombatSounds';
import { connectDestructionSounds } from './core/audio/DestructionSounds';
import { connectEnemySounds } from './core/audio/EnemySounds';
import { connectMgSounds } from './core/audio/MgSounds';
import { SoundBank } from './core/audio/SoundBank';
import { config } from './core/config';
import { DebugCamera } from './core/DebugCamera';
import { EventBus } from './core/EventBus';
import { FpsCounter } from './core/FpsCounter';
import { GameLoop } from './core/GameLoop';
import { GameState, Phase } from './core/GameState';
import { Input } from './core/Input';
import { MatchStats } from './core/MatchStats';
import { Physics } from './core/Physics';
import { RetroFilter } from './core/RetroFilter';
import { Groups } from './core/CollisionGroups';
import { Debris } from './destruction/Debris';
import { EnemyDebugView } from './enemies/EnemyDebugView';
import { EnemyManager } from './enemies/EnemyManager';
import { WaveDirector } from './enemies/WaveDirector';
import type { AimState } from './player/Aim';
import { Footsteps } from './player/Footsteps';
import { FPSCamera } from './player/FPSCamera';
import { GrenadeThrower } from './player/GrenadeThrower';
import { MgMount } from './player/MgMount';
import { PlayerArmor } from './player/PlayerArmor';
import { PlayerController } from './player/PlayerController';
import { PlayerHealth } from './player/PlayerHealth';
import { RepairTool } from './player/RepairTool';
import { ScreenShake } from './player/ScreenShake';
import { loadRifleModel } from './player/weapons/RifleAsset';
import { WeaponManager } from './player/weapons/WeaponManager';
import { ArmorCrate } from './economy/ArmorCrate';
import { CashWallet } from './economy/CashWallet';
import { connectKillRewards } from './economy/KillRewards';
import { connectWaveRewards } from './economy/WaveRewards';
import { DebugOverlay, type DebugOverlayState } from './ui/DebugOverlay';
import { HudRoot } from './ui/hud/HudRoot';
import { StructureHpBar } from './ui/StructureHpBar';
import { BuildGrid } from './world/BuildGrid';
import { createDustRidge } from './world/DustRidge';
import { createLighting } from './world/Lighting';
import { createMapProps } from './world/MapProps';
import { SpawnSmoke } from './world/SpawnSmoke';

function createRenderer(): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.render.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  // Cleared by hand so the view model can be drawn over the world with fresh depth.
  renderer.autoClear = false;
  document.body.append(renderer.domElement);
  return renderer;
}

async function boot(): Promise<void> {
  // The stencils on crates are drawn with the HUD font, so it must be loaded before the textures are painted.
  const [physics, rifleView] = await Promise.all([
    Physics.create(),
    loadRifleModel(),
    loadMgGunModel(),
    document.fonts.load('700 64px Oswald'),
  ]);
  const renderer = createRenderer();
  const canvas = renderer.domElement;
  const retro = new RetroFilter(renderer);
  const scene = new Scene();
  createLighting(scene);
  const map = createDustRidge(scene, physics.world);

  const events = new EventBus();
  bindDamageEvents(events);
  const state = new GameState(events);
  const input = new Input();
  const sounds = new SoundBank();
  connectCombatSounds(events, sounds);
  connectDestructionSounds(events, sounds);
  connectEnemySounds(events, sounds);
  connectMgSounds(events, sounds);
  const stats = new MatchStats(events);

  const grid = new BuildGrid();
  // Spawn pads are never buildable (their pad radius is 3 m), but enemies walk off them.
  for (const point of map.spawnPoints) grid.reserveArea(point, 3, 3);
  // Large rocks block walking, so enemy routes go around them.
  for (const rock of map.obstacles) grid.blockArea(rock.center, rock.halfSize, rock.halfSize);
  // Buildings and props: solid, and blocked on the grid so routes go around them.
  createMapProps(scene, physics.world, grid, map);
  const registry = new DamageableRegistry();
  const core = new OutpostCore(scene, physics.world, registry, grid, events);
  const corePosition = core.base;
  const spawn = new Vector3(
    corePosition.x + config.player.spawnOffset.x,
    0,
    corePosition.z + config.player.spawnOffset.z,
  );
  const player = new PlayerController(scene, physics.world, spawn);
  const footsteps = new Footsteps(physics.world, sounds, player.colliderHandle);
  const armor = new PlayerArmor(events);
  const health = new PlayerHealth(events, player, armor);
  // Yaw 0 looks down -Z, toward the core and the north spawn beyond it.
  const fpsCamera = new FPSCamera(0);
  const debugCamera = new DebugCamera(canvas);
  const overlay = new DebugOverlay();
  const hud = new HudRoot(events);
  const wallet = new CashWallet(events);
  const crate = new ArmorCrate(scene, physics.world, grid, wallet, events);
  const structures = new StructureManager(scene, physics.world, grid, registry, events);
  const buildTool = new BuildTool(scene, physics.world, grid, structures, wallet, events, player.colliderHandle);
  const repair = new RepairTool(physics.world, structures, wallet, events);
  const debris = new Debris(scene, physics.world, events);
  const structureBar = new StructureHpBar(scene, events);
  const fps = new FpsCounter();
  let debugView = false;

  registry.add(health);
  const effects = new CombatEffects(scene, events);
  const explosions = new Explosions(physics.world, registry, events);
  const grenades = new Grenades(scene, physics.world, explosions, events);
  const thrower = new GrenadeThrower(physics.world, grenades, events);
  const weapons = new WeaponManager(events, physics.world, registry, rifleView);
  const enemies = new EnemyManager(
    scene,
    physics.world,
    grid,
    registry,
    events,
    structures,
    explosions,
    {
      get position() {
        return player.position;
      },
      get velocity() {
        return player.velocity;
      },
      get crouching() {
        return player.crouching;
      },
      colliderHandle: player.colliderHandle,
      damageable: health,
    },
    core,
    map.spawnPoints,
  );
  const director = new WaveDirector(events, enemies, map.spawnPoints.length);
  const smoke = new SpawnSmoke(scene, events, map.spawnPoints);
  const mount = new MgMount(events, structures, player);
  const mg = new MachineGun(events, physics.world, registry);
  const enemyDebug = new EnemyDebugView(scene, enemies);
  connectKillRewards(events, wallet);
  connectWaveRewards(events, wallet);
  // Give the freshly built HUD its starting values.
  armor.announce();
  health.announce();
  wallet.announce();
  weapons.equipped.announce();
  thrower.announce();
  let playerActive = false;
  const shake = new ScreenShake(events, fpsCamera.camera);
  // Refreshed every frame; `eye` and `velocity` are live references.
  const aim = {
    eye: fpsCamera.camera.position,
    yaw: 0,
    pitch: 0,
    body: player,
    velocity: player.velocity,
  } satisfies AimState;
  const listenerForward = new Vector3();
  const debugRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  /** The structure under the crosshair, for the J key and the debug overlay. */
  const structureUnderCrosshair = (): Structure | null => {
    const eye = fpsCamera.camera.position;
    fpsCamera.camera.getWorldDirection(listenerForward);
    debugRay.origin = { x: eye.x, y: eye.y, z: eye.z };
    debugRay.dir = { x: listenerForward.x, y: listenerForward.y, z: listenerForward.z };
    const hit = physics.world.castRay(debugRay, config.debug.aimRange, true, undefined, Groups.bullet);
    return hit ? (structures.structureOf(hit.collider) ?? null) : null;
  };
  const aimedInfo = (target: Structure | null): DebugOverlayState['aimed'] =>
    target && { type: target.type, id: target.id, hp: target.hp, maxHp: target.maxHp, state: structures.stateOf(target) };

  events.on('phaseChanged', ({ from, to, wave }) => {
    console.info(`[phase] ${from ?? 'START'} -> ${to} (wave ${wave})`);
  });
  events.on('playerDamaged', ({ amount, armor: ap, health: hp }) => {
    console.info(`[player] took ${amount} damage, armor ${Math.ceil(ap)}, health ${Math.ceil(hp)}`);
  });
  events.on('plateApplied', ({ armor: ap, spares }) => {
    console.info(`[player] plate applied, armor ${ap}, spares ${spares}`);
  });
  events.on('playerDied', () => console.info('[player] died'));
  events.on('waveStarted', ({ wave, budget }) => console.info(`[waves] wave ${wave} started, budget ${budget}`));
  events.on('waveCleared', ({ wave }) => console.info(`[waves] wave ${wave} cleared`));
  // The win and lose screens need the mouse back.
  events.on('gameOver', () => input.exitPointerLock());

  canvas.addEventListener('click', () => {
    if (!debugView && !state.isOver) input.requestPointerLock(canvas);
  });
  // Ctrl-click is a right click on macOS; never open the context menu over the game.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    retro.resize();
    const aspect = window.innerWidth / window.innerHeight;
    fpsCamera.setAspect(aspect);
    debugCamera.setAspect(aspect);
    weapons.viewModel.setAspect(aspect);
  });

  const toggleDebugView = (): void => {
    debugView = !debugView;
    debugCamera.setEnabled(debugView);
    player.debugMesh.visible = debugView;
    if (debugView) {
      input.exitPointerLock();
      debugCamera.focus(player.position);
    }
  };

  const fixedUpdate = (dt: number): void => {
    state.update(dt);
    player.fixedUpdate(dt, fpsCamera.yaw);
    enemies.fixedUpdate(dt);
    physics.step();
    grenades.fixedUpdate(dt);
    debris.fixedUpdate(dt);
  };

  const render = (frameDt: number, alpha: number): void => {
    if (input.wasPressed('F1')) toggleDebugView();
    if (input.wasPressed('KeyK')) applyDamage(health, config.debug.testDamage, 'ballistic', player.position);
    if (input.wasPressed('KeyU')) {
      weapons.equipped.refill();
      thrower.refill();
    }
    if (input.wasPressed('KeyN')) {
      // In a fight: finish the wave as if the last enemy just died. Otherwise: the next phase.
      if (state.phase === Phase.FIGHT) director.endWave();
      else state.skipPhase();
    }
    if (input.wasPressed('KeyL')) state.lose();
    if (input.wasPressed('KeyM')) wallet.earn(config.debug.testCash);
    if (input.wasPressed('F3')) overlay.toggle();
    if (input.wasPressed('F4')) enemyDebug.toggle();
    if (input.wasPressed('F6')) retro.toggle();
    if (input.wasPressed('Digit7')) enemies.spawn('rifleman');
    if (input.wasPressed('Digit8')) enemies.spawn('sapper');
    if (input.wasPressed('Digit9')) enemies.killAll();
    if (input.wasPressed('Digit0')) enemies.toggleFreeze();
    if (input.wasPressed('Enter')) {
      if (state.phase === Phase.BUILD) state.startWaveEarly();
      else if (state.phase === Phase.AFTERMATH) state.skipAftermath();
      else if (state.isOver) window.location.reload();
    }
    if (input.wasPressed('KeyJ')) {
      const target = structureUnderCrosshair();
      // Explosive damage, scaled back so the structure loses exactly the set fraction of its max HP.
      const amount = target ? (target.maxHp * config.debug.structureDamageFraction) / config.destruction.damageMultipliers.explosive : 0;
      if (target) applyDamage(target, amount, 'explosive', fpsCamera.camera.position);
    }

    // Once the game is won or lost the player has no control (the end screen is up and the mouse is released).
    const playing = !debugView && input.pointerLocked && !health.isDead && !state.isOver;
    if (playing !== playerActive) {
      playerActive = playing;
      events.emit('playerControlChanged', { active: playing });
    }
    // On the MG the player stands still: no moving, building, repairing, rifle or grenades.
    const mounted = mount.mounted;
    player.pollInput(input, playing && !mounted);
    // Plating first, so holding V stops the rifle on the same frame.
    armor.handleInput(input, playing);
    armor.update(frameDt, !health.isDead);
    // The build tool replaces the rifle and grenades while it is out; repairing lowers them too.
    buildTool.handleInput(input, playing && !mounted);
    repair.handleInput(input, playing && !armor.isPlating && !mounted);
    // Mounting the MG takes the rifle out of hand too, which drops the aim.
    const armed = !buildTool.isActive && !repair.isRepairing && !mounted;
    weapons.handleInput(input, playing && !armor.isPlating && armed, player.sprintHeld);
    thrower.handleInput(input, playing && armed);
    crate.handleInput(input, playing);
    mount.handleInput(input, playing && !buildTool.isActive);
    mg.setTrigger(playing && mounted && !armor.isPlating && input.isDown('Mouse0'));
    const lookX = playing ? input.mouseDeltaX : 0;
    const lookY = playing ? input.mouseDeltaY : 0;
    if (playing) fpsCamera.look(lookX, lookY, weapons.ads.lookScale);
    input.endFrame();

    player.render(alpha, frameDt);
    footsteps.update(player);
    // Mounted, the camera rides behind the gun instead of the body.
    if (mount.mounted) mount.applyView(fpsCamera);
    else fpsCamera.update(frameDt, player.renderPosition, player);

    // Weapons fire from where the camera is now; their recoil shows from this frame on.
    aim.yaw = fpsCamera.yaw;
    aim.pitch = fpsCamera.pitch;
    weapons.update(frameDt, aim, lookX, lookY);
    fpsCamera.setRecoil(weapons.equipped.recoilPitch, weapons.equipped.recoilYaw);
    if (thrower.update(frameDt, aim)) weapons.onThrow();
    mg.update(frameDt, mount.nest, fpsCamera.camera.position, fpsCamera.yaw, fpsCamera.pitch);
    // Aiming down sights zooms, steadies the head and slows the body (from the next fixed step).
    const ads = weapons.ads;
    fpsCamera.setFov(ads.fov);
    fpsCamera.headBobScale = ads.headBobScale;
    player.setAim(ads.aiming, 1 + (weapons.equipped.stats.ads.moveSpeedMultiplier - 1) * ads.amount);
    shake.update(frameDt);
    fpsCamera.setShake(shake.pitch, shake.yaw, shake.roll);
    buildTool.update(aim);
    // E is shared by the armor crate, repairs and the MG: the closest one the player is looking at gets it.
    const canRepair = playing && !armor.isPlating && !mount.mounted;
    const crateDistance = playing && !mount.mounted ? crate.interactDistance(aim) : Infinity;
    let repairDistance = canRepair ? repair.interactDistance(aim) : Infinity;
    const mountDistance = playing && !buildTool.isActive ? mount.interactDistance(aim) : Infinity;
    // Looking at a damaged nest's gun from behind it: E mounts (repair it by aiming at its sandbags instead).
    if (mountDistance < Infinity && repair.candidate !== null && repair.candidate === mount.candidate && !repair.isRepairing) {
      repairDistance = Infinity;
    }
    const nearest = Math.min(crateDistance, repairDistance, mountDistance);
    crate.update(aim, playing && !mount.mounted && crateDistance <= nearest);
    repair.update(frameDt, aim, canRepair && repairDistance <= nearest);
    mount.update(aim, playing && mountDistance <= nearest);
    core.update(fpsCamera.camera);
    structures.update();
    structureBar.update(fpsCamera.camera);

    grenades.render(alpha);
    debris.render(alpha);
    director.update(frameDt);
    smoke.update(frameDt);
    enemies.update(frameDt, alpha);
    enemyDebug.update();
    effects.update(frameDt);

    fpsCamera.camera.getWorldDirection(listenerForward);
    sounds.setListener(fpsCamera.camera.position, listenerForward, fpsCamera.camera.up);

    if (debugView) debugCamera.update();
    retro.begin();
    renderer.render(scene, debugView ? debugCamera.camera : fpsCamera.camera);
    if (!debugView) {
      renderer.clearDepth();
      renderer.render(weapons.viewModel.scene, weapons.viewModel.camera);
    }
    retro.end();

    fps.tick(frameDt);
    hud.update(frameDt);
    overlay.update({
      phase: state.phase,
      wave: state.wave,
      totalWaves: config.waves.total,
      timeRemaining: state.timeRemaining,
      fps: fps.fps,
      retro: retro.enabled,
      retroSize: `${retro.size.width}x${retro.size.height}`,
      armor: armor.armor,
      maxArmor: armor.maxArmor,
      spares: armor.spares,
      plateProgress: armor.plateProgress,
      health: health.health,
      cash: wallet.cash,
      coreHp: core.health,
      structures: structures.count,
      speed: player.horizontalSpeed,
      grounded: player.grounded,
      crouching: player.crouching,
      sprinting: player.sprinting,
      ads: weapons.ads.aiming,
      adsAmount: weapons.ads.amount,
      fov: weapons.ads.fov,
      particles: effects.particleCount,
      grenadesInAir: grenades.activeCount,
      debugCamera: debugView,
      surface: footsteps.surface,
      lastSound: sounds.lastPlayed,
      activeSounds: sounds.activeCount,
      debris: debris.activeCount,
      rubble: structures.rubbleCount,
      aimed: overlay.visible ? aimedInfo(structureUnderCrosshair()) : null,
      enemiesAlive: enemies.aliveCount,
      enemiesFrozen: enemies.frozen,
      pathRequestsPerSecond: enemies.pathRequestsPerSecond,
      sightChecksPerFrame: enemies.sightChecksPerFrame,
      satchels: enemies.satchels.activeCount,
      waveBudgetLeft: director.budgetLeft,
      waveBudget: director.budget,
      enemiesQueued: director.queued,
      activeSpawnPoints: director.activeSpawnPoints,
      mgMounted: mount.mounted,
      mgHeat: mg.heatLevel,
      mgOverheated: mg.isOverheated,
      showClickPrompt: !debugView && !input.pointerLocked && !state.isOver,
    });
  };

  // Dev-only handle for automated playtests and console poking. Stripped from production builds.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __game: { retro, director, smoke, mount, mg, stats, repair, debris, sounds, footsteps, state, player, health, armor, wallet, hud, events, grid, core, crate, structures, buildTool, fpsCamera, input, scene, physics, RAPIER, weapons, thrower, grenades, enemies, explosions, effects, renderer },
    });
  }

  state.start();
  new GameLoop(fixedUpdate, render).start();
}

boot().catch((error: unknown) => {
  console.error(error);
  const message = document.createElement('pre');
  message.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
  Object.assign(message.style, { color: '#f66', font: '14px monospace', padding: '16px' });
  document.body.append(message);
});
