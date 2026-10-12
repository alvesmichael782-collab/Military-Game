import { config } from './config';

/** A rebindable control from `config.keybinds`. */
export type Action = keyof typeof config.keybinds;

/** Keys whose browser default (help page, page scroll, focus change) must never fire in game. */
const ALWAYS_PREVENT = new Set(['F1', 'F3', 'F4', 'F6', 'Space', 'Tab']);

/**
 * Central input state. Keys are keyed by `KeyboardEvent.code` (layout independent, e.g. "KeyW").
 * Tracks held keys, keys pressed this frame, mouse movement while the pointer is locked,
 * and pointer lock state. Call `endFrame()` once per rendered frame to clear per-frame data.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private _mouseDeltaX = 0;
  private _mouseDeltaY = 0;
  private _wheelSteps = 0;
  private _pointerLocked = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      // Leave Cmd shortcuts (quit, close tab, etc.) to the browser.
      if (!e.metaKey && (this._pointerLocked || ALWAYS_PREVENT.has(e.code))) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    // Drop held keys when focus is lost so nothing gets stuck down.
    target.addEventListener('blur', () => this.down.clear());

    // Mouse buttons share the key sets as "Mouse0" (left), "Mouse1" (middle), "Mouse2" (right).
    // Only while captured, so the click that captures the mouse never fires a shot.
    document.addEventListener('mousedown', (e) => {
      if (!this._pointerLocked) return;
      const code = `Mouse${e.button}`;
      this.pressed.add(code);
      this.down.add(code);
    });
    document.addEventListener('mouseup', (e) => this.down.delete(`Mouse${e.button}`));

    document.addEventListener('mousemove', (e) => {
      if (!this._pointerLocked) return;
      this._mouseDeltaX += e.movementX;
      this._mouseDeltaY += e.movementY;
    });
    // One step per wheel notch (or trackpad swipe event), down/toward the user positive.
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this._pointerLocked) return;
        e.preventDefault();
        if (e.deltaY !== 0) this._wheelSteps += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = document.pointerLockElement !== null;
      if (!this._pointerLocked) this.down.clear();
    });
  }

  /** `code` is a `KeyboardEvent.code` or a mouse button ("Mouse0" is the left button). */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** True while the key or mouse button bound to `action` in `config.keybinds` is held. */
  isActionDown(action: Action): boolean {
    return this.down.has(config.keybinds[action]);
  }

  /** True only on the frame the key or mouse button bound to `action` went down. */
  wasActionPressed(action: Action): boolean {
    return this.pressed.has(config.keybinds[action]);
  }

  /** Horizontal mouse movement this frame, in pixels. Only counts while the pointer is locked. */
  get mouseDeltaX(): number {
    return this._mouseDeltaX;
  }

  /** Vertical mouse movement this frame, in pixels. Only counts while the pointer is locked. */
  get mouseDeltaY(): number {
    return this._mouseDeltaY;
  }

  /** Mouse wheel notches this frame: positive scrolled down, negative up. Only counts while the pointer is locked. */
  get wheelSteps(): number {
    return this._wheelSteps;
  }

  get pointerLocked(): boolean {
    return this._pointerLocked;
  }

  /** Capture the mouse. Must be called from a user gesture such as a click. */
  requestPointerLock(element: HTMLElement): void {
    // Raw (unaccelerated) movement where supported, plain lock otherwise.
    // Rejections (e.g. clicking again right after Esc) are expected and ignored.
    element.requestPointerLock({ unadjustedMovement: true })?.catch(() => {
      element.requestPointerLock()?.catch(() => {});
    });
  }

  exitPointerLock(): void {
    if (this._pointerLocked) document.exitPointerLock();
  }

  endFrame(): void {
    this.pressed.clear();
    this._mouseDeltaX = 0;
    this._mouseDeltaY = 0;
    this._wheelSteps = 0;
  }
}
