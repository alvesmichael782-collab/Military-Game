/** Prefix for every setting this game saves in the browser. */
const PREFIX = 'lastStandFortress.';

/**
 * A saved setting, or null when there is none or it cannot be read (private window, blocked storage, bad JSON).
 * The caller validates the shape; nothing here trusts what comes back.
 */
export function readSetting(name: string): unknown {
  try {
    const text = window.localStorage.getItem(PREFIX + name);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** Save a setting. Failing to save is fine: the game keeps the value until the page closes. */
export function writeSetting(name: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // Storage blocked or full.
  }
}
