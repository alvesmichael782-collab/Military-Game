const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

/** True when the player has asked the OS for less motion. HUD feedback then fades instead of moving. */
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery.matches;
}

/** Ease-out curve shared by HUD feedback animations: fast start, soft landing. */
export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** A quick scale "pop" that confirms a value changed. Skipped under reduced motion. */
export function pop(element: Element, from = 1.14, duration = 260): void {
  if (prefersReducedMotion()) return;
  element.animate([{ transform: `scale(${from})` }, { transform: 'scale(1)' }], { duration, easing: EASE_OUT });
}

let uiScale = 1;

/** Apply the UI size from the pause menu (`config.ui.scales`) to everything sized in reference pixels. */
export function setUiScale(scale: number): void {
  uiScale = scale;
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

/** One reference pixel in CSS pixels right now. Must match `--rp` in hud.css; WAAPI keyframes need plain pixels. */
export function referencePixel(): number {
  return Math.min((window.innerHeight / 1080) * uiScale, window.innerWidth / 1200);
}
