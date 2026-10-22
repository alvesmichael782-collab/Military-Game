import type { EventBus, GameEvents } from '../../core/EventBus';
import { AllyTags } from './AllyTags';
import { AmmoCounter } from './AmmoCounter';
import { ArmorShatter } from './ArmorShatter';
import { ArmorBar } from './ArmorBar';
import { BuildPrompt } from './BuildPrompt';
import { CashCounter } from './CashCounter';
import { CashPopups } from './CashPopups';
import { DamageIndicators } from './DamageIndicators';
import { DownedBanner } from './DownedBanner';
import { EndScreen } from './EndScreen';
import { Crosshair } from './Crosshair';
import { GrenadeCount } from './GrenadeCount';
import { HealthBar } from './HealthBar';
import { HeatBar } from './HeatBar';
import { HitMarker } from './HitMarker';
import { LowHealthOverlay } from './LowHealthOverlay';
import { MountPrompt } from './MountPrompt';
import { NetNotices } from './NetNotices';
import { PhaseBanner } from './PhaseBanner';
import { PromptKeys } from './PromptKeys';
import { RepairPrompt } from './RepairPrompt';
import { ShopPrompt } from './ShopPrompt';
import { ViewTracker } from './ViewTracker';
import { SparePlates } from './SparePlates';
import { WaveNumber } from './WaveNumber';
import { WaveSummary } from './WaveSummary';
import { WeaponName } from './WeaponName';
import { setUiScale } from './motion';
import type { ShopIcons } from '../shop/ShopIcons';
import { ShopMenu } from '../shop/ShopMenu';
import './hud.css';

/**
 * The player's HUD, laid out after UI-Model.jpg. An HTML layer over the canvas at native resolution,
 * driven only by EventBus events. Systems should `announce()` their state once after this is built.
 */
export class HudRoot {
  private readonly cash: CashCounter;
  private readonly crosshair: Crosshair;
  private readonly hitMarker: HitMarker;
  private readonly lowHealth: LowHealthOverlay;
  private readonly shatter: ArmorShatter;
  private readonly indicators: DamageIndicators;
  private readonly notices: NetNotices;

  constructor(events: EventBus<GameEvents>, shopIcons: ShopIcons, parent: HTMLElement = document.body) {
    const root = document.createElement('div');
    root.className = 'hud';
    // Everything sized in reference pixels (HUD and pause menu) follows the UI size picked in the menu.
    events.on('uiScaleChanged', ({ scale }) => setUiScale(scale));
    const keys = new PromptKeys(events);

    // Damage feedback goes in first, so the numbers and bars drawn after it stay on top and readable.
    const view = new ViewTracker(events);
    this.lowHealth = new LowHealthOverlay(events, root);
    this.shatter = new ArmorShatter(events, root, view);
    this.indicators = new DamageIndicators(events, root, view);
    // Teammates' name tags sit under everything else too: they must never cover the player's own numbers.
    new AllyTags(events, root);

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
    new MountPrompt(events, prompts, keys);
    new RepairPrompt(events, prompts, keys);
    new ShopPrompt(events, prompts, keys);
    new PhaseBanner(events, root, keys);
    new DownedBanner(events, root);
    new WaveSummary(events, root, keys);
    new EndScreen(events, root, keys);
    // The crate shops' buy menu goes over everything else; it takes the mouse while open.
    new ShopMenu(events, root, keys, shopIcons);
    // A lost host ends the game: that screen goes over everything, menus included.
    this.notices = new NetNotices(events, root);
    parent.append(root);
  }

  /** Advance time-based effects (damage feedback, cash roll, crosshair easing, hit marker). Call once per rendered frame. */
  update(dt: number): void {
    this.lowHealth.update(dt);
    this.shatter.update(dt);
    this.indicators.update(dt);
    this.cash.update(dt);
    this.crosshair.update(dt);
    this.hitMarker.update(dt);
    this.notices.update(dt);
  }
}
