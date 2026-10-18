import type { EventBus, GameEvents } from '../../core/EventBus';

/** The player's latest view, from the per-frame `playerView` event, for HUD elements that point at places in the world. */
export class ViewTracker {
  x = 0;
  z = 0;
  /** As `FPSCamera.yaw`: 0 looks down -Z, positive turns left. */
  yaw = 0;

  constructor(events: EventBus<GameEvents>) {
    events.on('playerView', ({ position, yaw }) => {
      this.x = position.x;
      this.z = position.z;
      this.yaw = yaw;
    });
  }
}

/**
 * Screen angle of the flat direction from the view to (`x`, `z`), in radians clockwise from straight up:
 * 0 is straight ahead, PI/2 to the right, PI behind. A point right at the eyes counts as straight ahead.
 */
export function viewAngleTo(view: ViewTracker, x: number, z: number): number {
  const dx = x - view.x;
  const dz = z - view.z;
  const ahead = -dx * Math.sin(view.yaw) - dz * Math.cos(view.yaw);
  const right = dx * Math.cos(view.yaw) - dz * Math.sin(view.yaw);
  return Math.atan2(right, ahead);
}
