import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, type Scene } from 'three';
import type { OutpostCore } from '../build/OutpostCore';
import { Structure } from '../build/Structure';
import type { StructureManager } from '../build/StructureManager';
import { applyDamage, setDamageRouter } from '../combat/Damage';
import type { DamageableRegistry } from '../combat/DamageableRegistry';
import type { DamageType } from '../combat/DamageType';
import type { Grenades } from '../combat/Grenades';
import { config } from '../core/config';
import type { EventBus, ExplosionKind, GameEvents } from '../core/EventBus';
import { Phase, type GameState } from '../core/GameState';
import type { CashWallet } from '../economy/CashWallet';
import { Enemy } from '../enemies/Enemy';
import type { PlayerTarget } from '../enemies/EnemyContext';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { FPSCamera } from '../player/FPSCamera';
import type { MgMount } from '../player/MgMount';
import type { PlayerController } from '../player/PlayerController';
import type { PlayerHealth } from '../player/PlayerHealth';
import { WEAPON_DEFS } from '../player/weapons/defs';
import type { BuildGrid } from '../world/BuildGrid';
import { packEnemies, EnemyReplica } from './EnemySync';
import { relayHostEvents, replayEvent } from './EventRelay';
import type { NetSession } from './NetSession';
import { localPlayerId } from './PlayerId';
import type { GameMessage, PlayerState, V3 } from './protocol';
import { round2, round3, v3 } from './protocol';
import { RemotePlayers } from './RemotePlayers';
import { StructureSync } from './StructureSync';

export interface NetGameSystems {
  session: NetSession;
  events: EventBus<GameEvents>;
  scene: Scene;
  world: RAPIER.World;
  registry: DamageableRegistry;
  state: GameState;
  grid: BuildGrid;
  structures: StructureManager;
  core: OutpostCore;
  enemies: EnemyManager;
  grenades: Grenades;
  mount: MgMount;
  health: PlayerHealth;
  wallet: CashWallet;
  player: PlayerController;
  camera: FPSCamera;
  /** The enemies' target list, the local player first. Teammates are added to it. */
  targets: PlayerTarget[];
}

const scratch = new Vector3();
const scratchNormal = new Vector3();
const scratchEnd = new Vector3();

function toVector(v: V3, out: Vector3 = new Vector3()): Vector3 {
  return out.set(v[0], v[1], v[2]);
}

/**
 * Multiplayer, once the game has begun. The host runs the world (enemies, waves, phases, structure HP) and
 * tells the clients; every machine runs its own player (movement, aim, shooting, cash) and tells the others.
 *
 * Clients send their hits on enemies, structures and the core to the host (see the damage router), which
 * applies them for that player, so a kill is credited to (and paid on the machine of) whoever made it.
 * Enemy hits on a client's player are worked out on the host and sent to that client.
 *
 * Also runs the votes to start a wave or skip the summary (everyone must press the key), and on the host,
 * the loss once every player is down. Players who are down get up at the next build phase.
 */
export class NetGame {
  readonly remotes: RemotePlayers;
  readonly structureSync: StructureSync;
  private readonly replica: EnemyReplica | null;
  /** This machine runs the world. */
  readonly isHost: boolean;
  /** Re-emitting another machine's event: do not send it back out. */
  private replaying = false;
  private stateTimer = 0;
  private enemyTimer = 0;
  private readonly votes = new Set<string>();
  /** This player's state, filled in place before each send. */
  private readonly state: PlayerState = [0, 0, 0, 0, 0, 0, 1, 0, 0];

  constructor(private readonly sys: NetGameSystems) {
    const { session, events } = sys;
    this.isHost = session.isHost;
    this.remotes = new RemotePlayers(
      sys.scene,
      sys.world,
      events,
      sys.targets,
      (id) => sys.structures.byId(id),
      this.isHost ? sys.registry : null,
      (id, amount, type, from, attacker, blast) => this.hurtAlly(id, amount, type, from, attacker, blast),
    );
    for (const p of session.players) if (p.id !== session.localId) this.remotes.add(p.id, p.name);
    this.structureSync = new StructureSync(session, events, sys.structures, sys.grid, sys.wallet, sys.state);
    sys.mount.setTakenCheck((nestId) => this.remotes.mountedOn(nestId) !== undefined);

    session.setMessageHandler((message, from) => this.receive(message, from));
    if (this.isHost) {
      this.replica = null;
      sys.state.setMultiplayer('host');
      this.connectHost();
    } else {
      this.replica = new EnemyReplica(sys.enemies);
      sys.state.setMultiplayer('client');
      sys.enemies.setReplica(true);
      setDamageRouter((target, amount, type, position, info) => this.route(target, amount, type, position, info.source ?? 'environment', info.headshot ?? false));
      session.onClosed = (reason) => events.emit('connectionLost', { reason });
    }
    this.connectLocalPlayer();
  }

  /** Players in the game, this one included. */
  get playerCount(): number {
    return this.sys.session.players.length;
  }

  /** The player pressed the start key: vote to start the wave now (build phase) or skip the summary (aftermath). */
  vote(): void {
    const phase = this.sys.state.phase;
    if (phase !== Phase.BUILD && phase !== Phase.AFTERMATH) return;
    if (this.isHost) this.addVote(localPlayerId());
    else this.sys.session.send({ t: 'vote' });
  }

  /** Teammates, enemy snapshots, this player's state and the outgoing batch. Call once per frame, before enemies draw. */
  update(dt: number): void {
    const sys = this.sys;
    const m = config.multiplayer;
    this.remotes.update(dt, sys.camera.camera);
    this.replica?.update();
    // Another player got onto the same gun at the same moment: the one with the lower id keeps it.
    const nest = sys.mount.nest;
    if (nest) {
      const other = this.remotes.mountedOn(nest.id);
      if (other && other.id < localPlayerId()) sys.mount.release();
    }

    this.stateTimer -= dt;
    if (this.stateTimer <= 0) {
      this.stateTimer += 1 / m.playerSendRate;
      if (this.stateTimer < 0) this.stateTimer = 0;
      this.sendState();
    }
    if (this.isHost) {
      this.enemyTimer -= dt;
      if (this.enemyTimer <= 0) {
        this.enemyTimer += 1 / m.enemySendRate;
        if (this.enemyTimer < 0) this.enemyTimer = 0;
        sys.session.send({ t: 'enemies', d: packEnemies(sys.enemies) });
      }
      this.checkAllDown();
    }
    sys.session.flush();
  }

  /** Leave the session (going back to the menu). */
  leave(): void {
    setDamageRouter(null);
    this.sys.session.leave();
  }

  // ---- Wiring ----

  /** What this machine's own player does that the others need to see. */
  private connectLocalPlayer(): void {
    const { events, session } = this.sys;
    events.on('weaponFired', ({ weapon, muzzle, end }) => {
      session.send({ t: 'shot', id: localPlayerId(), w: weapon, m: v3(muzzle), e: end ? v3(end) : null });
    });
    events.on('mgFired', ({ muzzle, end }) => session.send({ t: 'shot', id: localPlayerId(), w: 'mg', m: v3(muzzle), e: v3(end) }));
    events.on('bulletImpact', ({ point, normal, surface }) => {
      if (!this.replaying) session.send({ t: 'impact', p: v3(point), n: [round3(normal.x), round3(normal.y), round3(normal.z)], s: surface });
    });
    // The player's grenades, and on the host the grenadiers' too.
    events.on('grenadeThrown', ({ position, velocity, fuse }) =>
      session.send({ t: 'grenade', id: localPlayerId(), p: v3(position), v: v3(velocity), f: round3(fuse) }),
    );
    events.on('playerDied', () => events.emit('playerDowned', { down: true }));
    events.on('phaseChanged', ({ to }) => {
      if (to === Phase.BUILD) this.revive();
    });
  }

  /** The host tells the clients about the world as it changes. */
  private connectHost(): void {
    const { events, session, state } = this.sys;
    relayHostEvents(events, (name, payload) => session.send({ t: 'event', n: name, p: payload }));
    events.on('phaseChanged', ({ to, wave }) => {
      session.send({ t: 'phase', to, w: wave, r: state.timeRemaining });
      this.votes.clear();
      this.announceVotes();
    });
    events.on('phaseTimer', ({ phase, seconds }) => session.send({ t: 'timer', ph: phase, s: seconds }));
    events.on('gameOver', ({ result, reason, wave }) => session.send({ t: 'over', res: result, why: reason, w: wave }));
    events.on('coreDamaged', ({ hp }) => session.send({ t: 'core', hp }));
    events.on('satchelArmed', ({ position, yaw, fuse, dropped }) => session.send({ t: 'satchel', p: v3(position), y: round3(yaw), f: fuse, d: dropped }));
    events.on('mortarFired', ({ position, impact, flightTime }) => session.send({ t: 'mortar', p: v3(position), i: v3(impact), f: round3(flightTime) }));
    session.onPeerLeft = (id, name) => {
      this.remotes.remove(id);
      this.votes.delete(id);
      session.send({ t: 'left', id });
      events.emit('peerLeft', { id, name });
      this.announceVotes();
      this.checkVotes();
    };
  }

  private sendState(): void {
    const { player, camera, health, mount, session } = this.sys;
    const s = this.state;
    const feet = player.position;
    s[0] = round2(feet.x);
    s[1] = round2(feet.y);
    s[2] = round2(feet.z);
    s[3] = round3(camera.yaw);
    s[4] = round3(camera.pitch);
    s[5] = player.crouching ? 1 : 0;
    s[6] = health.isDead ? 0 : 1;
    s[7] = player.sprinting ? 1 : 0;
    s[8] = mount.nest?.id ?? 0;
    // A fresh array each time: the message sits in the outbox until the frame's flush.
    session.send({ t: 'state', id: localPlayerId(), s: [...s] as PlayerState });
  }

  // ---- Messages ----

  private receive(message: GameMessage, from: string): void {
    if (this.structureSync.handle(message, from)) return;
    if (this.isHost) this.receiveOnHost(message, from);
    else this.receiveOnClient(message);
  }

  private receiveOnHost(message: GameMessage, from: string): void {
    const { session } = this.sys;
    switch (message.t) {
      case 'state':
        this.remotes.get(from)?.receive(message.s);
        session.sendExcept(from, { ...message, id: from });
        break;
      case 'shot':
        this.showShot(from, message.w, message.m, message.e);
        session.sendExcept(from, { ...message, id: from });
        break;
      case 'impact':
        this.showImpact(message.p, message.n, message.s);
        session.sendExcept(from, message);
        break;
      case 'grenade':
        this.showGrenade(message.p, message.v, message.f);
        session.sendExcept(from, { ...message, id: from });
        break;
      case 'hit':
        this.applyHit(message, from);
        break;
      case 'vote':
        this.addVote(from);
        break;
      default:
        break;
    }
  }

  private receiveOnClient(message: GameMessage): void {
    const sys = this.sys;
    switch (message.t) {
      case 'state':
        if (message.id) this.remotes.get(message.id)?.receive(message.s);
        break;
      case 'shot':
        if (message.id) this.showShot(message.id, message.w, message.m, message.e);
        break;
      case 'impact':
        this.showImpact(message.p, message.n, message.s);
        break;
      case 'grenade':
        this.showGrenade(message.p, message.v, message.f);
        break;
      case 'hurt': {
        const attacker = message.att >= 0 ? sys.enemies.bySlot(message.att) : undefined;
        applyDamage(sys.health, message.a, message.ty, toVector(message.p, scratch), { source: 'enemy', attacker, blast: message.b });
        break;
      }
      case 'event':
        this.replaying = true;
        replayEvent(sys.events, message.n, message.p);
        this.replaying = false;
        break;
      case 'enemies':
        this.replica?.receive(message.d);
        break;
      case 'phase':
        sys.state.follow(message.to, message.w, message.r);
        break;
      case 'timer':
        sys.state.followTimer(message.ph, message.s);
        break;
      case 'over':
        sys.state.followGameOver(message.res, message.why, message.w);
        break;
      case 'satchel':
        sys.enemies.satchels.arm(toVector(message.p, scratch), message.y, message.f, message.d, true);
        break;
      case 'mortar':
        sys.enemies.mortarShells.fire(toVector(message.p, scratch), toVector(message.i, scratchEnd), message.f, true);
        break;
      case 'core': {
        const lost = sys.core.health - message.hp;
        if (lost > 0) sys.core.takeDamage(lost);
        break;
      }
      case 'ready':
        sys.events.emit('readyChanged', { ready: message.r, total: message.n, self: message.ids.includes(localPlayerId()) });
        break;
      case 'left': {
        const name = this.remotes.get(message.id)?.name ?? 'Soldier';
        this.remotes.remove(message.id);
        sys.events.emit('peerLeft', { id: message.id, name });
        break;
      }
      default:
        break;
    }
  }

  // ---- Damage ----

  /**
   * Client: hits on enemies, structures and the core go to the host, which deals them (and credits the kill).
   * Returns whether the hit should kill, for the hit marker, or null to deal it here (this player).
   */
  private route(target: unknown, amount: number, type: DamageType, position: Vector3, source: 'player' | 'enemy' | 'environment', headshot: boolean): boolean | null {
    const session = this.sys.session;
    const p = v3(position);
    if (target instanceof Enemy) {
      session.send({ t: 'hit', k: 'e', id: target.slot, a: amount, ty: type, src: source, p, h: headshot });
      // Count it down here too, so a second hit before the host's answer is not marked as another kill.
      const wasAlive = target.hp > 0;
      target.hp = Math.max(0, target.hp - amount);
      return wasAlive && target.hp <= 0;
    }
    if (target instanceof Structure) {
      session.send({ t: 'hit', k: 's', id: target.id, a: amount, ty: type, src: source, p, h: false });
      return false;
    }
    if (target === this.sys.core) {
      session.send({ t: 'hit', k: 'c', id: 0, a: amount, ty: type, src: source, p, h: false });
      return false;
    }
    return null;
  }

  /** Host: a client's player hit something. Deal it for them, so the kill is theirs. */
  private applyHit(message: Extract<GameMessage, { t: 'hit' }>, from: string): void {
    const sys = this.sys;
    const target = message.k === 'e' ? sys.enemies.bySlot(message.id) : message.k === 's' ? sys.structures.byId(message.id) : sys.core;
    if (!target) return;
    applyDamage(target, message.a, message.ty, toVector(message.p, scratch), { source: message.src, headshot: message.h, player: from });
  }

  /** Host: an enemy shot or blast hit a teammate. Their machine deals it to them. */
  private hurtAlly(id: string, amount: number, type: DamageType, from: Vector3, attacker: object | undefined, blast: ExplosionKind | undefined): void {
    const att = attacker instanceof Enemy ? attacker.slot : -1;
    this.sys.session.sendTo(id, { t: 'hurt', a: Math.round(amount * 100) / 100, ty: type, p: v3(from), att, ...(blast ? { b: blast } : {}) });
  }

  // ---- Showing what others did ----

  private showShot(id: string, weapon: string, muzzle: V3, end: V3 | null): void {
    this.remotes.get(id)?.onShot();
    const sound = weapon === 'mg' ? config.mg.sounds.fire : (WEAPON_DEFS.find((d) => d.id === weapon)?.sounds.fire ?? null);
    this.sys.events.emit('allyFired', {
      weapon,
      sound: sound ?? null,
      muzzle: toVector(muzzle, scratch),
      end: end ? toVector(end, scratchEnd) : null,
    });
  }

  private showImpact(point: V3, normal: V3, surface: Extract<GameMessage, { t: 'impact' }>['s']): void {
    this.replaying = true;
    this.sys.events.emit('bulletImpact', { point: toVector(point, scratch), normal: toVector(normal, scratchNormal), surface });
    this.replaying = false;
  }

  private showGrenade(position: V3, velocity: V3, fuse: number): void {
    this.sys.grenades.throw(toVector(position), toVector(velocity), 'player', true, fuse);
  }

  // ---- Votes, down and back up ----

  private addVote(id: string): void {
    if (this.votes.has(id)) return;
    this.votes.add(id);
    this.announceVotes();
    this.checkVotes();
  }

  /** Host: everyone pressed the key. */
  private checkVotes(): void {
    const state = this.sys.state;
    if (this.votes.size === 0 || this.votes.size < this.playerCount) return;
    if (state.phase === Phase.BUILD) state.startWaveEarly();
    else if (state.phase === Phase.AFTERMATH) state.skipAftermath();
  }

  private announceVotes(): void {
    const ids = [...this.votes];
    const total = this.playerCount;
    this.sys.session.send({ t: 'ready', r: ids.length, n: total, ids });
    this.sys.events.emit('readyChanged', { ready: ids.length, total, self: this.votes.has(localPlayerId()) });
  }

  /** Host: the fight is lost once every player is down. */
  private checkAllDown(): void {
    const { state, health } = this.sys;
    if (state.phase !== Phase.FIGHT || !health.isDead) return;
    for (const remote of this.remotes.all) if (remote.alive) return;
    state.lose('playerDied');
  }

  /** A new build phase: a player who was down gets up, at full health, back at their spawn point. */
  private revive(): void {
    const { health, player, events } = this.sys;
    if (!health.isDead) return;
    health.revive();
    player.teleport(this.spawnPoint());
    events.emit('playerDowned', { down: false });
  }

  /** This player's spawn: players stand side by side across the spawn point, in lobby order. */
  spawnPoint(out = new Vector3()): Vector3 {
    const players = this.sys.session.players;
    const index = Math.max(0, players.findIndex((p) => p.id === localPlayerId()));
    const core = this.sys.core.base;
    const offset = (index - (players.length - 1) / 2) * config.multiplayer.spawnSpacing;
    return out.set(core.x + config.player.spawnOffset.x + offset, 0, core.z + config.player.spawnOffset.z);
  }
}
