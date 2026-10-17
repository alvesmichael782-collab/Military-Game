import type { EventBus, GameEvents } from '../../core/EventBus';
import { AmmoCounter } from './AmmoCounter';
import { ArmorBar } from './ArmorBar';
import { BuildPrompt } from './BuildPrompt';
import { CashCounter } from './CashCounter';
import { CashPopups } from './CashPopups';
import { EndScreen } from './EndScreen';
import { Crosshair } from './Crosshair';
import { GrenadeCount } from './GrenadeCount';
import { HealthBar } from './HealthBar';
import { HeatBar } from './HeatBar';
import { HitMarker } from './HitMarker';
import { InteractPrompt } from './InteractPrompt';
import { MountPrompt } from './MountPrompt';
import { PhaseBanner } from './PhaseBanner';
import { PromptKeys } from './PromptKeys';
import { RepairPrompt } from './RepairPrompt';
import { ShopPrompt } from './ShopPrompt';
import { SparePlates } from './SparePlates';
import { WaveNumber } from './WaveNumber';
import { WaveSummary } from './WaveSummary';
import { WeaponName } from './WeaponName';
import { setUiScale } from './motion';
import './hud.css';

/**
 * The player's HUD, laid out after UI-Model.jpg. An HTML layer over the canvas at native resolution,
 * driven only by EventBus events. Systems should `announce()` their state once after this is built.
 */
export class HudRoot {
  private readonly cash: CashCounter;
  private readonly crosshair: Crosshair;
  private readonly hitMarker: HitMarker;

  constructor(events: EventBus<GameEvents>, parent: HTMLElement = document.body) {
    const root = document.createElement('div');
    root.className = 'hud';
    // Everything sized in reference pixels (HUD and pause menu) follows the UI size picked in the menu.
    events.on('uiScaleChanged', ({ scale }) => setUiScale(scale));
    const keys = new PromptKeys(events);

    this.cash = new CashCounter(events, root);
    new CashPopups(events, this.cash.popupAnchor);
    new WaveNumber(events, root);
    new ArmorBar(events, root);
    new HealthBar(events, root);
    new SparePlates(events, root);

    const bottomRight = document.createElement('div');
    bottomRight.className = 'hud-br';
    root.append(bottomRight);
    new AmmoCounter(events, bottomRight);
    new HeatBar(events, bottomRight);
    new WeaponName(events, bottomRight);
    new GrenadeCount(events, bottomRight);

    this.crosshair = new Crosshair(events, root);
    this.hitMarker = new HitMarker(events, root);
    const prompts = document.createElement('div');
    prompts.className = 'hud-prompts';
    root.append(prompts);
    new BuildPrompt(events, prompts, keys);
    new InteractPrompt(events, prompts, keys);
    new MountPrompt(events, prompts, keys);
    new RepairPrompt(events, prompts, keys);
    new ShopPrompt(events, prompts, keys);
    new PhaseBanner(events, root, keys);
    new WaveSummary(events, root, keys);
    new EndScreen(events, root, keys);
    parent.append(root);
  }

  /** Advance time-based effects (cash roll, crosshair easing, hit marker). Call once per rendered frame. */
  update(dt: number): void {
    this.cash.update(dt);
    this.crosshair.update(dt);
    this.hitMarker.update(dt);
  }
}
