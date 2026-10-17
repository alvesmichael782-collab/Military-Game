import { config } from './config';
import type { EventBus, GameEvents } from './EventBus';
import { readSetting, writeSetting } from './storage';

const STORAGE_NAME = 'uiScale';

/**
 * The UI size picked in the pause menu: 1x to 5x (`config.ui.scales`), saved in the browser.
 * Emits `uiScaleChanged` on every change.
 */
export class UiSettings {
  private _scaleLevel: number = config.ui.defaultScale;

  constructor(private readonly events: EventBus<GameEvents>) {
    const saved = readSetting(STORAGE_NAME);
    if (UiSettings.isLevel(saved)) this._scaleLevel = saved;
  }

  /** Number of UI size choices. */
  static get scaleLevels(): number {
    return config.ui.scales.length;
  }

  private static isLevel(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= UiSettings.scaleLevels;
  }

  /** 1-based: 3 is 3x. */
  get scaleLevel(): number {
    return this._scaleLevel;
  }

  setScaleLevel(level: number): void {
    if (!UiSettings.isLevel(level) || level === this._scaleLevel) return;
    this._scaleLevel = level;
    writeSetting(STORAGE_NAME, level);
    this.announce();
  }

  /** Emit the current UI size. Call once after the HUD is built. */
  announce(): void {
    this.events.emit('uiScaleChanged', { level: this._scaleLevel, scale: config.ui.scales[this._scaleLevel - 1] });
  }
}
