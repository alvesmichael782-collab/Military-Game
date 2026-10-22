/**
 * Dev-only stand-in for PeerJS that links tabs of one browser over a BroadcastChannel, for automated
 * multiplayer tests on a machine where WebRTC cannot reach itself. Used only with `?loopback` in a dev build
 * (see NetSession.ts). Implements just the slice of the Peer and DataConnection API that NetSession uses.
 */
type Handler = (...args: never[]) => void;

interface Wire {
  kind: 'connect' | 'accept' | 'data' | 'close';
  from: string;
  to: string;
  conn: string;
  data?: unknown;
}

const CHANNEL = 'last-stand-fortress-loopback';

class Emitter {
  private readonly handlers = new Map<string, Set<{ fn: Handler; once: boolean }>>();

  on(event: string, fn: Handler): this {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add({ fn, once: false });
    return this;
  }

  once(event: string, fn: Handler): this {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add({ fn, once: true });
    return this;
  }

  protected emit(event: string, ...args: unknown[]): void {
    for (const entry of [...(this.handlers.get(event) ?? [])]) {
      if (entry.once) this.handlers.get(event)?.delete(entry);
      (entry.fn as (...a: unknown[]) => void)(...args);
    }
  }
}

export class LoopbackConnection extends Emitter {
  open = false;

  constructor(
    private readonly peer: LoopbackPeer,
    readonly id: string,
    readonly remote: string,
  ) {
    super();
  }

  send(data: unknown): void {
    if (this.open) this.peer.post({ kind: 'data', from: this.peer.id, to: this.remote, conn: this.id, data });
  }

  close(): void {
    if (!this.open) return;
    this.peer.post({ kind: 'close', from: this.peer.id, to: this.remote, conn: this.id });
    this.closed();
  }

  /** Called by the peer. */
  deliver(wire: Wire): void {
    if (wire.kind === 'accept' && !this.open) {
      this.open = true;
      this.emit('open');
    } else if (wire.kind === 'data') this.emit('data', wire.data);
    else if (wire.kind === 'close') this.closed();
  }

  markOpen(): void {
    this.open = true;
    queueMicrotask(() => this.emit('open'));
  }

  private closed(): void {
    if (!this.open) return;
    this.open = false;
    this.peer.forget(this.id);
    this.emit('close');
  }
}

export class LoopbackPeer extends Emitter {
  readonly id: string;
  private readonly channel = new BroadcastChannel(CHANNEL);
  private readonly connections = new Map<string, LoopbackConnection>();
  private destroyed = false;

  constructor(id?: string | object) {
    super();
    this.id = typeof id === 'string' ? id : `loop-${Math.random().toString(36).slice(2, 10)}`;
    this.channel.onmessage = (e: MessageEvent<Wire>) => this.receive(e.data);
    setTimeout(() => this.emit('open', this.id), 50);
  }

  connect(remote: string): LoopbackConnection {
    const conn = new LoopbackConnection(this, `${this.id}:${Math.random().toString(36).slice(2, 8)}`, remote);
    this.connections.set(conn.id, conn);
    this.post({ kind: 'connect', from: this.id, to: remote, conn: conn.id });
    setTimeout(() => {
      if (!conn.open && !this.destroyed) this.emit('error', { type: 'peer-unavailable' });
    }, 3000);
    return conn;
  }

  reconnect(): void {}

  destroy(): void {
    if (this.destroyed) return;
    for (const conn of [...this.connections.values()]) conn.close();
    this.destroyed = true;
    this.channel.close();
  }

  post(wire: Wire): void {
    if (!this.destroyed) this.channel.postMessage(wire);
  }

  forget(conn: string): void {
    this.connections.delete(conn);
  }

  private receive(wire: Wire): void {
    if (this.destroyed || wire.to !== this.id) return;
    if (wire.kind === 'connect') {
      const conn = new LoopbackConnection(this, wire.conn, wire.from);
      this.connections.set(conn.id, conn);
      this.post({ kind: 'accept', from: this.id, to: wire.from, conn: wire.conn });
      this.emit('connection', conn);
      conn.markOpen();
      return;
    }
    this.connections.get(wire.conn)?.deliver(wire);
  }
}
