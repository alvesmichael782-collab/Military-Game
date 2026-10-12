/**
 * Writes `text` with every digit in a fixed-width cell, so counters keep their width as values change.
 * The stand-in HUD font has no tabular figures; CSS `font-variant-numeric` alone does nothing for it.
 * Only for HUD-generated strings (digits, "$", ","), never for outside text.
 */
export function setFixedDigits(element: HTMLElement, text: string): void {
  element.innerHTML = text.replace(/\d/g, '<span class="hud-digit">$&</span>');
}
