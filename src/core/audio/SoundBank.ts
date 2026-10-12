import { Howl, Howler } from 'howler';
import { config } from '../config';
import { SOUNDS, type SoundDef } from './sounds';

/** Sound files found under src/assets/sounds at build time, keyed by path, so Vite bundles them. */
const files = import.meta.glob<string>('../../assets/sounds/**/*.{mp3,ogg,wav,m4a}', {
  eager: true,
  query: '?url',
  import: 'default',
});
const ROOT = '../../assets/sounds/';

/** Fade used when a sound is cut off early, in milliseconds, so it never clicks. */
const STOP_FADE_MS = 12;

export interface PlayOptions {
  /** Where in the world the sound comes from. Plays it positioned, even for a '2d' sound. */
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  /** Multiplies the entry's volume. */
  readonly volume?: number;
  /** Multiplies the playback rate (pitch). */
  readonly rate?: number;
  /** Seconds into the file to start from. */
  readonly offset?: number;
  /** Fade in over this many milliseconds, for a start that is not at the top of the file. */
  readonly fadeIn?: number;
}

/** Identifies one playing copy of a sound, for `stop`. 0 means nothing was played. */
export type SoundHandle = number;

interface Instance {
  readonly handle: SoundHandle;
  readonly howl: Howl;
  readonly id: number;
}

interface Entry {
  readonly def: SoundDef;
  readonly variants: Howl[];
  /** Index of the last variant played, so the next one differs. */
  last: number;
  /** Oldest first. */
  readonly playing: Instance[];
}

/** Files grouped by path without extension: one variant can come in several formats. */
function variantsOnDisk(): Map<string, string[]> {
  const variants = new Map<string, string[]>();
  for (const [path, url] of Object.entries(files)) {
    const name = path.slice(ROOT.length, path.lastIndexOf('.'));
    const list = variants.get(name) ?? [];
    list.push(url);
    variants.set(name, list);
  }
  return variants;
}

/** `*` matches any run of characters within a path segment, `?` exactly one. */
function patternOf(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${body}$`);
}

/** A random value in [-1, 1]. */
function jitter(): number {
  return Math.random() * 2 - 1;
}

/**
 * Every sound in the game, played by id (see `SOUNDS`): picks a variant (never the same one twice in a row),
 * applies the entry's pitch and volume jitter and its bus volume, caps how many copies play at once, and
 * can place the sound in the world. Missing ids or files log one warning each and play nothing.
 */
export class SoundBank {
  private readonly entries = new Map<string, Entry>();
  private readonly warned = new Set<string>();
  private nextHandle = 1;
  private _lastPlayed = '';

  constructor(definitions: Readonly<Record<string, SoundDef>> = SOUNDS) {
    Howler.volume(config.audio.buses.master);
    // Plays are skipped while the context is not running, so it must never suspend itself when idle.
    Howler.autoSuspend = false;

    const onDisk = variantsOnDisk();
    for (const [id, def] of Object.entries(definitions)) {
      const entry: Entry = { def, variants: [], last: -1, playing: [] };
      const pattern = patternOf(def.files);
      const names = [...onDisk.keys()].filter((name) => pattern.test(name)).sort();
      if (names.length === 0) this.warnOnce(id, `no files for "${id}" (src/assets/sounds/${def.files}); it stays silent`);
      for (const name of names) {
        const howl = new Howl({ src: onDisk.get(name) ?? [], preload: true });
        howl.once('loaderror', (_soundId, error) => {
          this.warnOnce(`${id}:${name}`, `could not load ${name} for "${id}": ${String(error)}`);
          const index = entry.variants.indexOf(howl);
          if (index >= 0) entry.variants.splice(index, 1);
        });
        entry.variants.push(howl);
      }
      this.entries.set(id, entry);
    }
    this.unlockOnFirstInput();
  }

  /** The id of the last sound asked for, for the debug overlay. */
  get lastPlayed(): string {
    return this._lastPlayed;
  }

  /** Sound copies playing right now. */
  get activeCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) count += this.prune(entry).playing.length;
    return count;
  }

  /** True if the id exists and has at least one file to play. */
  has(id: string): boolean {
    return (this.entries.get(id)?.variants.length ?? 0) > 0;
  }

  play(id: string, options?: PlayOptions): SoundHandle {
    const entry = this.entries.get(id);
    if (!entry) {
      this.warnOnce(id, `unknown sound "${id}"`);
      return 0;
    }
    this._lastPlayed = id;
    // Before the first click the browser keeps audio locked; sounds asked for then are dropped, not queued.
    if (entry.variants.length === 0 || Howler.ctx?.state !== 'running') return 0;

    const { def, playing } = this.prune(entry);
    while (playing.length >= def.maxInstances) {
      const oldest = playing.shift();
      if (oldest) this.fadeOut(oldest);
    }

    const howl = this.pickVariant(entry);
    const soundId = howl.play();
    if (def.loop) howl.loop(true, soundId);
    const volume = def.volume * config.audio.buses[def.bus] * (1 + jitter() * def.volumeJitter) * (options?.volume ?? 1);
    const level = Math.min(1, Math.max(0, volume));
    howl.rate(Math.min(4, Math.max(0.5, (def.rate ?? 1) * (1 + jitter() * def.pitchJitter) * (options?.rate ?? 1))), soundId);
    if (options?.offset) howl.seek(options.offset, soundId);
    if (options?.fadeIn) howl.fade(0, level, options.fadeIn, soundId);
    else howl.volume(level, soundId);

    const position = options?.position;
    if (position || def.spatial === '3d') {
      if (!position) this.warnOnce(`${id}:position`, `"${id}" is a 3d sound but was played without a position`);
      else this.place(howl, soundId, def, position);
    }

    const handle = this.nextHandle++;
    playing.push({ handle, howl, id: soundId });
    return handle;
  }

  /** Stop one playing copy with a short fade. Does nothing if it already ended. */
  stop(handle: SoundHandle, fadeMs = STOP_FADE_MS): void {
    if (handle === 0) return;
    for (const entry of this.entries.values()) {
      const index = entry.playing.findIndex((instance) => instance.handle === handle);
      if (index < 0) continue;
      const [instance] = entry.playing.splice(index, 1);
      this.fadeOut(instance, fadeMs);
      return;
    }
  }

  /** Move the listener to the camera. Call once per rendered frame. */
  setListener(
    position: { x: number; y: number; z: number },
    forward: { x: number; y: number; z: number },
    up: { x: number; y: number; z: number },
  ): void {
    // Howler makes its audio context on first use; until then there is no listener to move.
    if (!Howler.ctx) return;
    Howler.pos(position.x, position.y, position.z);
    Howler.orientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }

  private pickVariant(entry: Entry): Howl {
    const count = entry.variants.length;
    let index = Math.floor(Math.random() * count);
    // Never the same variant twice in a row: skip ahead past the last one.
    if (count > 1 && index === entry.last) index = (index + 1 + Math.floor(Math.random() * (count - 1))) % count;
    entry.last = index;
    return entry.variants[index];
  }

  private place(howl: Howl, soundId: number, def: SoundDef, position: { x: number; y: number; z: number }): void {
    howl.pannerAttr(
      {
        panningModel: 'equalpower',
        distanceModel: 'inverse',
        refDistance: def.refDistance ?? 1,
        rolloffFactor: 1,
      },
      soundId,
    );
    howl.pos(position.x, position.y, position.z, soundId);
  }

  private fadeOut(instance: Instance, fadeMs = STOP_FADE_MS): void {
    const { howl, id } = instance;
    if (!howl.playing(id)) return;
    howl.once('fade', () => howl.stop(id), id);
    howl.fade(howl.volume(id) as number, 0, fadeMs, id);
  }

  /** Drop copies that have finished. */
  private prune(entry: Entry): Entry {
    const playing = entry.playing;
    let kept = 0;
    for (const instance of playing) if (instance.howl.playing(instance.id)) playing[kept++] = instance;
    playing.length = kept;
    return entry;
  }

  private unlockOnFirstInput(): void {
    const done = (): void => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    const unlock = (): void => {
      const context = Howler.ctx;
      if (!context || context.state === 'running') {
        done();
        return;
      }
      context.resume().then(done, () => undefined);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[audio] ${message}`);
  }
}
