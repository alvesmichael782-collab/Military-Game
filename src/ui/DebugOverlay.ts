import { config } from '../core/config';
import { Phase } from '../core/GameState';

export interface DebugOverlayState {
  phase: Phase;
  wave: number;
  totalWaves: number;
  timeRemaining: number;
  fps: number;
  /** Retro render filter on, and its internal resolution. */
  retro: boolean;
  retroSize: string;
  armor: number;
  maxArmor: number;
  spares: number;
  /** 0..1 through the plate being applied, 0 when not plating. */
  plateProgress: number;
  health: number;
  cash: number;
  coreHp: number;
  structures: number;
  /** Horizontal speed, in m/s. */
  speed: number;
  grounded: boolean;
  crouching: boolean;
  sprinting: boolean;
  /** Aiming down sights, how far the sights are up (0 hip, 1 aimed), and the camera's horizontal FOV in degrees at 4:3. */
  ads: boolean;
  adsAmount: number;
  fov: number;
  /** Live effect particles and grenades in the air, for performance checks. */
  particles: number;
  grenadesInAir: number;
  debugCamera: boolean;
  /** Surface under the player, the id of the last sound asked for, and sound copies playing now. */
  surface: string;
  lastSound: string;
  activeSounds: number;
  /** Debris chunks out, rubble piles on the field, and the structure under the crosshair (if any). */
  debris: number;
  rubble: number;
  aimed: { type: string; id: number; hp: number; maxHp: number; state: string } | null;
  /** Living enemies, whether their AI is frozen, path searches in the last second, sight raycasts last frame, armed satchels. */
  enemiesAlive: number;
  enemiesFrozen: boolean;
  pathRequestsPerSecond: number;
  sightChecksPerFrame: number;
  satchels: number;
  /** Wave director: budget points not sent yet (of the wave's total), enemies waiting to be sent, and the spawn points in use. */
  waveBudgetLeft: number;
  waveBudget: number;
  enemiesQueued: number;
  activeSpawnPoints: readonly number[];
  /** The MG: whether the player is on it, its heat (0..1) and whether it is locked from overheating. */
  mgMounted: boolean;
  mgHeat: number;
  mgOverheated: boolean;
  /** Show the centered "Click to play" prompt. */
  showClickPrompt: boolean;
}

/** "KeyQ" -> "Q", "Mouse2" -> "Right mouse". */
function keyName(code: string): string {
  const mouse = ['Left mouse', 'Middle mouse', 'Right mouse'];
  if (code.startsWith('Mouse')) return mouse[Number(code.slice(5))] ?? code;
  return code.replace(/^(Key|Digit)/, '');
}

const HELP =
  'WASD move   Shift sprint   Ctrl/C crouch   Space jump   Esc release mouse\n' +
  `Left mouse fire   ${config.ads.toggle ? 'Press' : 'Hold'} ${keyName(config.keybinds.aim)} aim   R reload   G grenade   Hold V apply armor plate   E use   Hold E repair\n` +
  'B build tool: scroll to pick, R rotate, left mouse place, F remove or clear rubble   Enter start wave\n' +
  'E (behind the MG nest gun) mount or dismount   Enter skip the wave summary\n' +
  'K: 25 damage   M: earn $50   U: refill ammo and grenades   N: end the wave (in a fight) or next phase   L: force loss\n' +
  'J: 25% damage to the structure under the crosshair\n' +
  '7: spawn rifleman   8: spawn sapper   9: kill all enemies   0: freeze or unfreeze enemy AI\n' +
  'F1: debug camera   F3: toggle this overlay   F4: enemy paths, breach targets and states   F6: retro filter on or off';

/** Spawn points by where they sit on the map (config.map.spawnPoints), e.g. "N" for the north one. */
function spawnName(index: number): string {
  const p = config.map.spawnPoints[index];
  if (!p) return String(index);
  return Math.abs(p.z) >= Math.abs(p.x) ? (p.z < 0 ? 'N' : 'S') : p.x > 0 ? 'E' : 'W';
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function aimedText(aimed: DebugOverlayState['aimed']): string {
  if (!aimed) return '-';
  return `${aimed.type.toUpperCase()} #${aimed.id} HP ${Math.ceil(aimed.hp)}/${aimed.maxHp} ${aimed.state.toUpperCase()}`;
}

function stanceOf(state: DebugOverlayState): string {
  if (state.crouching) return 'CROUCHING';
  if (state.sprinting) return 'SPRINTING';
  return 'STANDING';
}

/** Plain-text readout of game and player state, hidden by default and toggled with F3. Also shows the "Click to play" prompt. */
export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private lastText = '';

  constructor(parent: HTMLElement = document.body) {
    const root = document.createElement('div');
    this.root = root;
    Object.assign(root.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      padding: '6px 10px',
      background: 'rgba(0, 0, 0, 0.55)',
      color: '#f2e6c9',
      font: '13px/1.5 monospace',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      userSelect: 'none',
      display: 'none',
    });

    this.status = document.createElement('div');
    const help = document.createElement('div');
    help.textContent = HELP;
    help.style.opacity = '0.65';
    root.append(this.status, help);

    this.prompt = document.createElement('div');
    this.prompt.textContent = 'CLICK TO PLAY';
    Object.assign(this.prompt.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      padding: '10px 18px',
      background: 'rgba(0, 0, 0, 0.6)',
      color: '#f2e6c9',
      font: 'bold 20px monospace',
      letterSpacing: '2px',
      pointerEvents: 'none',
      userSelect: 'none',
    });

    parent.append(root, this.prompt);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  toggle(): void {
    this.root.style.display = this.visible ? 'none' : 'block';
  }

  update(state: DebugOverlayState): void {
    this.prompt.style.display = state.showClickPrompt ? 'block' : 'none';
    if (!this.visible) return;
    const timer = state.phase === Phase.WON || state.phase === Phase.LOST ? '--:--' : formatTime(state.timeRemaining);
    const text =
      `PHASE ${state.phase.padEnd(9)}  WAVE ${state.wave}/${state.totalWaves}  ` +
      `TIME ${timer}  FPS ${Math.round(state.fps)}  RETRO ${state.retro ? state.retroSize : 'off'}\n` +
      `ARMOR ${String(Math.ceil(state.armor)).padStart(3)}/${state.maxArmor}  SPARE PLATES ${state.spares}  ` +
      `HEALTH ${String(Math.ceil(state.health)).padStart(3)}  CASH $${state.cash}` +
      (state.plateProgress > 0 ? `  PLATING ${Math.floor(state.plateProgress * 100)}%` : '') +
      '\n' +
      `SPEED ${state.speed.toFixed(1).padStart(4)} m/s  ${state.grounded ? 'GROUNDED' : 'AIRBORNE'}  ${stanceOf(state)}` +
      (state.debugCamera ? '  [DEBUG CAMERA]' : '') +
      `\nADS ${state.ads ? 'AIMING' : 'HIP'} ${String(Math.round(state.adsAmount * 100)).padStart(3)}%  FOV ${state.fov.toFixed(1)}` +
      `\nPARTICLES ${String(state.particles).padStart(3)}  GRENADES IN AIR ${state.grenadesInAir}` +
      `  STRUCTURES ${state.structures}  CORE HP ${Math.ceil(state.coreHp)}` +
      `\nSURFACE ${state.surface.toUpperCase()}  LAST SOUND ${state.lastSound || '-'}  ACTIVE SOUNDS ${state.activeSounds}` +
      `\nDEBRIS ${String(state.debris).padStart(2)}  RUBBLE ${state.rubble}  AIMED ${aimedText(state.aimed)}` +
      `\nENEMIES ${String(state.enemiesAlive).padStart(2)}${state.enemiesFrozen ? ' [FROZEN]' : ''}  PATHS/S ${state.pathRequestsPerSecond}` +
      `  LOS/FRAME ${state.sightChecksPerFrame}  SATCHELS ${state.satchels}` +
      `\nWAVE BUDGET ${state.waveBudgetLeft}/${state.waveBudget}  QUEUED ${state.enemiesQueued}` +
      `  SPAWNS ${state.activeSpawnPoints.map(spawnName).join('+') || '-'}` +
      `\nMG ${state.mgMounted ? 'MOUNTED' : 'OFF'}  HEAT ${String(Math.round(state.mgHeat * 100)).padStart(3)}%` +
      (state.mgOverheated ? '  [OVERHEATED]' : '');
    // Only touch the DOM when the text actually changes.
    if (text !== this.lastText) {
      this.status.textContent = text;
      this.lastText = text;
    }
  }
}
