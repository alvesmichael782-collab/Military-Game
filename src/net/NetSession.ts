import Peer, { type DataConnection } from 'peerjs';
import { config } from '../core/config';
import { LoopbackPeer } from './LoopbackPeer';
import type { GameMessage } from './protocol';

/** A player in the lobby. The host is always 'p0'; the others get the lowest free 'p1'..'p3' as they join. */
export interface LobbyPlayer {
  id: string;
  name: string;
  /** Finished loading the game, so the host may start. */
  loaded: boolean;
}

/** Lobby traffic, handled here. Everything in-game travels batched in `batch` and goes to `onMessage`. */
type WireMessage =
  | { t: 'hello'; name: string }
  | { t: 'lobby'; players: LobbyPlayer[]; you: string }
  | { t: 'loaded' }
  | { t: 'denied'; reason: string }
  | { t: 'start' }
  | { t: 'batch'; m: GameMessage[] };

export type NetRole = 'host' | 'client';

const HOST_ID = 'p0';

/** Error text for the menus. */
export class NetError extends Error {}

function randomCode(): string {
  const { codeAlphabet: alphabet, codeLength } = config.multiplayer;
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(codeLength));
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

/** Dev builds with `?loopback` link tabs of one browser instead of using WebRTC (automated tests). */
const LOOPBACK = import.meta.env.DEV && new URLSearchParams(window.location.search).has('loopback');

function createPeer(id?: string): Peer {
  if (LOOPBACK) return new LoopbackPeer(id) as unknown as Peer;
  return id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
}

function peerIdFor(code: string): string {
  return `${config.multiplayer.peerPrefix}${code.toLowerCase()}`;
}

/** Turn a typed code into the lobby code it means: upper case, no spaces or dashes. */
export function normalizeCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new NetError(message)), config.multiplayer.connectTimeout * 1000);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function brokerError(type: string): NetError {
  if (type === 'peer-unavailable') return new NetError('No lobby with that code');
  if (type === 'browser-incompatible') return new NetError('This browser cannot play online');
  return new NetError('Cannot reach the lobby server');
}

/**
 * One multiplayer session over WebRTC data channels (PeerJS; its public broker only introduces the peers,
 * then they talk directly). The host's peer id is made from the lobby code, so a friend joins by typing it.
 * Star layout: every client talks only to the host, which relays what the others need.
 *
 * In the lobby this handles joining, the player list, loading and the start. In game, messages are queued
 * with `send*` and go out together once per frame in `flush`, one batch per connection.
 */
export class NetSession {
  private _players: LobbyPlayer[] = [];
  private _localId = HOST_ID;
  private started = false;
  private closed = false;
  /** Host: one connection per client, by player id. Client: the host's, under 'p0'. */
  private readonly connections = new Map<string, DataConnection>();
  private readonly outbox = new Map<string, GameMessage[]>();

  /** The player list changed (someone joined, left or finished loading). */
  onLobbyChanged: () => void = () => {};
  /** Client: the host started the game. */
  onStart: () => void = () => {};
  /** In-game messages that came before anyone listened for them (the first frames after the start). */
  private early: [GameMessage, string][] = [];
  private messageHandler: ((message: GameMessage, from: string) => void) | null = null;
  /** Host: a client left. */
  onPeerLeft: (id: string, name: string) => void = () => {};
  /** Client: the link to the host is gone. */
  onClosed: (reason: string) => void = () => {};

  private constructor(
    readonly role: NetRole,
    readonly code: string,
    private readonly peer: Peer,
  ) {
    // Closing or reloading the tab hangs up at once, so the others hear of it now rather than after a timeout.
    window.addEventListener('pagehide', () => this.leave());
  }

  /** Open a lobby. Picks a fresh code (and another if that one is taken on the broker). */
  static async host(name: string): Promise<NetSession> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomCode();
      const peer = createPeer(peerIdFor(code));
      try {
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            peer.once('open', () => resolve());
            peer.once('error', (error) => reject(error.type === 'unavailable-id' ? error : brokerError(error.type)));
          }),
          'Cannot reach the lobby server',
        );
      } catch (error) {
        peer.destroy();
        if (error instanceof NetError) throw error;
        continue;
      }
      const session = new NetSession('host', code, peer);
      session._players = [{ id: HOST_ID, name, loaded: false }];
      peer.on('connection', (connection) => session.accept(connection));
      peer.on('disconnected', () => {
        // Lost the broker: friends can no longer join, but those in the game stay connected.
        if (!session.closed && !session.started) peer.reconnect();
      });
      return session;
    }
    throw new NetError('Could not open a lobby, try again');
  }

  /** Join the lobby with this code. Resolves once the host has let us in. */
  static async join(code: string, name: string): Promise<NetSession> {
    const peer = createPeer();
    const session = new NetSession('client', code, peer);
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          peer.once('error', (error) => reject(brokerError(error.type)));
          peer.once('open', () => {
            const connection = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
            connection.once('open', () => {
              session.connections.set(HOST_ID, connection);
              session.write(connection, { t: 'hello', name });
            });
            connection.on('data', (data) => {
              const message = data as WireMessage;
              if (message.t === 'denied') reject(new NetError(message.reason));
              else if (message.t === 'lobby' && session._players.length === 0) {
                session.receive(message, HOST_ID);
                resolve();
                return;
              }
              session.receive(message, HOST_ID);
            });
            connection.on('close', () => session.lost('The host left the game'));
            connection.on('error', () => session.lost('Lost the connection to the host'));
          });
        }),
        'No answer from that lobby',
      );
    } catch (error) {
      session.closed = true;
      peer.destroy();
      throw error;
    }
    return session;
  }

  get localId(): string {
    return this._localId;
  }

  get players(): readonly LobbyPlayer[] {
    return this._players;
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  /** Everyone in the lobby has the game loaded. */
  get allLoaded(): boolean {
    return this._players.every((p) => p.loaded);
  }

  nameOf(id: string): string {
    return this._players.find((p) => p.id === id)?.name ?? 'Soldier';
  }

  /**
   * Who handles in-game messages. `from` is the sender's player id (a client only ever hears from 'p0').
   * Anything that arrived before this is handed over at once, in order.
   */
  setMessageHandler(handler: (message: GameMessage, from: string) => void): void {
    this.messageHandler = handler;
    const early = this.early;
    this.early = [];
    for (const [message, from] of early) handler(message, from);
  }

  /** This machine finished loading the game. */
  markLoaded(): void {
    if (this.role === 'host') {
      const me = this._players.find((p) => p.id === HOST_ID);
      if (me) me.loaded = true;
      this.broadcastLobby();
    } else {
      const host = this.connections.get(HOST_ID);
      if (host) this.write(host, { t: 'loaded' });
    }
  }

  /** Host: start the game for everyone. No one can join after this. */
  start(): void {
    if (this.role !== 'host' || this.started) return;
    this.started = true;
    for (const connection of this.connections.values()) this.write(connection, { t: 'start' });
  }

  /** Client: to the host. Host: to every client. */
  send(message: GameMessage): void {
    for (const id of this.connections.keys()) this.queue(id, message);
  }

  /** Host: to one client. */
  sendTo(id: string, message: GameMessage): void {
    if (this.connections.has(id)) this.queue(id, message);
  }

  /** Host: to every client but `except` (relaying what that client sent). */
  sendExcept(except: string, message: GameMessage): void {
    for (const id of this.connections.keys()) if (id !== except) this.queue(id, message);
  }

  /** Send everything queued this frame. Call once per frame. */
  flush(): void {
    for (const [id, messages] of this.outbox) {
      if (messages.length === 0) continue;
      const connection = this.connections.get(id);
      if (connection?.open) this.write(connection, { t: 'batch', m: messages });
      this.outbox.set(id, []);
    }
  }

  /** Leave the lobby or game and drop every connection. */
  leave(): void {
    if (this.closed) return;
    this.closed = true;
    this.peer.destroy();
  }

  private queue(id: string, message: GameMessage): void {
    let list = this.outbox.get(id);
    if (!list) {
      list = [];
      this.outbox.set(id, list);
    }
    list.push(message);
  }

  private write(connection: DataConnection, message: WireMessage): void {
    if (!connection.open) return;
    try {
      void connection.send(message);
    } catch {
      // A closing channel throws; its close handler cleans up.
    }
  }

  /** Host: a new connection. It becomes a player once it says hello. */
  private accept(connection: DataConnection): void {
    let id: string | null = null;
    connection.on('data', (data) => {
      const message = data as WireMessage;
      if (id === null) {
        if (message.t !== 'hello') return;
        const refusal = this.started ? 'That game has already started' : this._players.length >= config.multiplayer.maxPlayers ? 'That lobby is full' : null;
        if (refusal) {
          this.write(connection, { t: 'denied', reason: refusal });
          setTimeout(() => connection.close(), 500);
          return;
        }
        id = this.freeId();
        this.connections.set(id, connection);
        this._players.push({ id, name: cleanName(message.name), loaded: false });
        this.broadcastLobby();
        return;
      }
      this.receive(message, id);
    });
    const gone = (): void => {
      if (id === null || !this.connections.has(id)) return;
      const leaving = id;
      const name = this.nameOf(leaving);
      this.connections.delete(leaving);
      this.outbox.delete(leaving);
      this._players = this._players.filter((p) => p.id !== leaving);
      this.broadcastLobby();
      this.onPeerLeft(leaving, name);
    };
    connection.on('close', gone);
    connection.on('error', gone);
  }

  private receive(message: WireMessage, from: string): void {
    switch (message.t) {
      case 'lobby':
        if (this.role !== 'client') return;
        this._players = message.players;
        this._localId = message.you;
        this.onLobbyChanged();
        break;
      case 'loaded': {
        const player = this._players.find((p) => p.id === from);
        if (player) player.loaded = true;
        this.broadcastLobby();
        break;
      }
      case 'start':
        if (this.role === 'client' && !this.started) {
          this.started = true;
          this.onStart();
        }
        break;
      case 'batch':
        for (const m of message.m) {
          if (this.messageHandler) this.messageHandler(m, from);
          else this.early.push([m, from]);
        }
        break;
      case 'hello':
      case 'denied':
        break;
    }
  }

  private broadcastLobby(): void {
    if (this.role !== 'host') return;
    for (const [id, connection] of this.connections) this.write(connection, { t: 'lobby', players: this._players, you: id });
    this.onLobbyChanged();
  }

  private freeId(): string {
    for (let i = 1; ; i++) {
      const id = `p${i}`;
      if (!this._players.some((p) => p.id === id)) return id;
    }
  }

  private lost(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.connections.clear();
    this.peer.destroy();
    this.onClosed(reason);
  }
}

/** A callsign as shown to everyone: trimmed, shortened, never empty. */
export function cleanName(text: string): string {
  const name = text.replace(/\s+/g, ' ').trim().slice(0, config.multiplayer.maxNameLength);
  return name.length > 0 ? name : 'Soldier';
}
