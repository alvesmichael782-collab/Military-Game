import type RAPIER from '@dimforge/rapier3d-compat';
import type { DamageableRegistry } from '../../combat/DamageableRegistry';
import type { EventBus, GameEvents } from '../../core/EventBus';
import type { Input } from '../../core/Input';
import type { AimState } from '../Aim';
import { AimDownSights } from './AimDownSights';
import { AssaultRifle } from './AssaultRifle';
import type { RifleView } from './RifleAsset';
import { ViewModel } from './ViewModel';
import type { Weapon } from './Weapon';

/** Holds the equipped weapon, routes fire, reload and aim input to it, and drives its view model. */
export class WeaponManager {
  readonly equipped: Weapon;
  readonly viewModel: ViewModel;
  readonly ads: AimDownSights;
  /** The rifle is lowered while the build tool is out, the player is repairing, or they are on the MG. */
  private building = false;
  private repairing = false;
  private mounted = false;

  constructor(events: EventBus<GameEvents>, world: RAPIER.World, registry: DamageableRegistry, rifleView: RifleView) {
    this.equipped = new AssaultRifle(events, world, registry);
    this.viewModel = new ViewModel(rifleView);
    this.ads = new AimDownSights(events);
    events.on('weaponFired', () => this.viewModel.onFire());
    events.on('buildToolChanged', ({ active }) => this.setLowered(active, this.repairing, this.mounted));
    events.on('repairStarted', () => this.setLowered(this.building, true, this.mounted));
    events.on('repairStopped', () => this.setLowered(this.building, false, this.mounted));
    events.on('mgMounted', () => this.setLowered(this.building, this.repairing, true));
    events.on('mgDismounted', () => this.setLowered(this.building, this.repairing, false));
  }

  private setLowered(building: boolean, repairing: boolean, mounted: boolean): void {
    const was = this.building || this.repairing || this.mounted;
    this.building = building;
    this.repairing = repairing;
    this.mounted = mounted;
    const lowered = building || repairing || mounted;
    if (lowered === was) return;
    this.viewModel.setHolstered(lowered, mounted);
    if (lowered) {
      // Lowering mid-burst must not leave the trigger held, and puts any reload away unfinished.
      this.equipped.setTrigger(false);
      this.equipped.cancelReload();
    } else {
      this.equipped.equip();
    }
  }

  /**
   * Call once per rendered frame, before `input.endFrame()`. Left mouse fires, R reloads, the `aim` keybind aims.
   * `active` is false whenever the weapon is not in hand; `sprintHeld` is the raw sprint key, which cancels the aim.
   */
  handleInput(input: Input, active: boolean, sprintHeld: boolean): void {
    this.equipped.setTrigger(active && input.isDown('Mouse0'));
    if (active && input.wasPressed('KeyR')) this.equipped.reload();
    this.ads.handleInput(input, active, this.equipped.isReloading, sprintHeld);
  }

  /** A grenade was thrown: dip the rifle and drop the aim for a moment. */
  onThrow(): void {
    this.viewModel.onThrow();
    this.ads.onThrow();
  }

  /** Aim, fire, reload and animate. `lookX`/`lookY` are this frame's mouse movement, for view model sway. */
  update(dt: number, aim: AimState, lookX: number, lookY: number): void {
    const ads = this.equipped.stats.ads;
    this.ads.update(dt, ads);
    this.equipped.setAimAmount(this.ads.amount);
    this.equipped.update(dt, aim);
    this.viewModel.update(dt, aim.body, this.equipped.reloadElapsed, lookX, lookY, this.ads.amount, this.equipped.stats);
  }
}
