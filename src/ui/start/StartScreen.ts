import { config } from '../../core/config';
import { readSetting, writeSetting } from '../../core/storage';
import { cleanName, NetError, NetSession, normalizeCode } from '../../net/NetSession';
import { createBrushSmear } from '../hud/BrushSmear';
import '../hud/hud.css';
import '../menu/PauseMenu.css';
import './StartScreen.css';

export type StartChoice = { mode: 'solo' } | { mode: 'multiplayer'; session: NetSession };

/** Set before reloading after a single player game, so "restart" goes straight back into one. */
const AUTOSTART_KEY = 'lastStandFortress.autostart';
const NAME_SETTING = 'callsign';

/** Ask for a single player restart: the next page load skips the menu. */
export function requestSoloRestart(): void {
  try {
    window.sessionStorage.setItem(AUTOSTART_KEY, 'solo');
  } catch {
    // Without session storage the restart simply shows the menu.
  }
}

function takeAutostart(): boolean {
  try {
    const solo = window.sessionStorage.getItem(AUTOSTART_KEY) === 'solo';
    window.sessionStorage.removeItem(AUTOSTART_KEY);
    return solo;
  } catch {
    return false;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  return b;
}

/**
 * The first screen: the title over the live map, SINGLE PLAYER and MULTIPLAYER. Multiplayer opens a panel
 * to pick a callsign and create a lobby (which shows a code to share) or join one by its code. The lobby
 * lists the squad and who is still loading; the host starts the game once everyone has it loaded.
 *
 * Built in the pause menu's style (square bevelled panels, khaki text, one red accent) with the HUD's fonts.
 * The game loads behind it; `setLoaded` tells it the game is ready to start.
 */
export class StartScreen {
  private readonly root = el('div', 'menu start');
  private readonly items: HTMLButtonElement[];
  private readonly status = el('div', 'start__status');
  private readonly panel = el('div', 'start__panel menu__panel menu__raised');
  private loaded = false;
  private wantSolo = false;
  private session: NetSession | null = null;
  private busy = false;
  private resolve: (choice: StartChoice) => void = () => {};
  private readonly chosen: Promise<StartChoice>;

  // The multiplayer panel's two pages.
  private readonly setup = el('div', 'start__page');
  private readonly lobby = el('div', 'start__page');
  private readonly nameInput = el('input', 'start__input menu__sunken');
  private readonly codeInput = el('input', 'start__input start__input--code menu__sunken');
  private readonly createButton = button('menu__button menu__button--primary menu__raised start__wide', 'Create lobby');
  private readonly joinButton = button('menu__button menu__raised', 'Join');
  private readonly setupHint = el('div', 'menu__hint start__hint');
  private readonly codeText = el('div', 'start__code');
  private readonly copyButton = button('menu__button menu__raised start__copy', 'Copy');
  private readonly squadHeading = el('h3', 'menu__heading');
  private readonly squad = el('ol', 'start__squad');
  private readonly startButton = button('menu__button menu__button--primary menu__raised', 'Start');
  private readonly leaveButton = button('menu__button menu__raised', 'Leave');
  private readonly lobbyHint = el('div', 'menu__hint start__hint');

  constructor(parent: HTMLElement = document.body) {
    this.chosen = new Promise((resolve) => {
      this.resolve = resolve;
    });
    document.body.classList.add('in-start');
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    const side = el('div', 'start__side');
    const title = el('h1', 'start__title');
    title.append(el('span', 'start__title-top', 'Last Stand'), el('span', 'start__title-bottom', 'Fortress'));
    const list = el('nav', 'start__items');
    list.setAttribute('aria-label', 'Main menu');
    const solo = this.item('Single player', () => this.pickSolo());
    const multi = this.item('Multiplayer', () => this.openPanel());
    this.items = [solo, multi];
    list.append(solo, multi);
    this.status.textContent = 'Loading';
    side.append(title, list, this.status);

    this.buildSetup();
    this.buildLobby();
    this.panel.append(this.setup, this.lobby);
    this.panel.hidden = true;
    this.root.append(side, this.panel);
    parent.append(this.root);

    if (takeAutostart()) this.pickSolo();
  }

  /** The player's pick. Resolves once the game is loaded (and, in multiplayer, the host has started it). */
  choose(): Promise<StartChoice> {
    return this.chosen;
  }

  /** The game finished loading behind the menu. */
  setLoaded(): void {
    this.loaded = true;
    this.status.textContent = '';
    this.session?.markLoaded();
    if (this.wantSolo) this.finish({ mode: 'solo' });
    this.renderLobby();
  }

  /** Take the menu away (the game begins). */
  hide(): void {
    this.root.remove();
    document.body.classList.remove('in-start');
  }

  // ---- Main list ----

  private item(label: string, onClick: () => void): HTMLButtonElement {
    const b = button('start__item', '');
    const smear = createBrushSmear({
      width: 320,
      height: 56,
      color: '#8c1218',
      seed: label.length * 977,
      fadeLeft: 0.12,
      fadeRight: 0.35,
      streaks: 16,
      coreOpacity: 0.9,
      coreStart: 0.04,
    });
    smear.classList.add('start__item-smear');
    b.append(smear, el('span', 'start__item-label', label));
    b.addEventListener('click', onClick);
    return b;
  }

  private setCurrent(index: number): void {
    this.items.forEach((b, i) => b.classList.toggle('is-current', i === index));
  }

  private pickSolo(): void {
    if (this.session) return;
    this.setCurrent(0);
    this.panel.hidden = true;
    this.wantSolo = true;
    if (this.loaded) this.finish({ mode: 'solo' });
    else this.status.textContent = 'Loading';
  }

  private openPanel(): void {
    this.wantSolo = false;
    if (!this.loaded) this.status.textContent = 'Loading';
    this.setCurrent(1);
    this.panel.hidden = false;
    this.showPage(this.session ? 'lobby' : 'setup');
    if (!this.session) this.nameInput.focus();
  }

  private finish(choice: StartChoice): void {
    this.resolve(choice);
  }

  // ---- Multiplayer: callsign, create or join ----

  private buildSetup(): void {
    const nameLabel = el('label', 'menu__heading', 'Callsign');
    nameLabel.htmlFor = 'start-callsign';
    this.nameInput.id = 'start-callsign';
    this.nameInput.maxLength = config.multiplayer.maxNameLength;
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    const saved = readSetting(NAME_SETTING);
    this.nameInput.value = typeof saved === 'string' ? saved : '';
    this.nameInput.placeholder = 'Soldier';

    const hostHeading = el('h3', 'menu__heading', 'Host a game');
    const hostNote = el('p', 'start__note', `Opens a lobby with a code your friends can join. Up to ${config.multiplayer.maxPlayers} players.`);

    const joinLabel = el('label', 'menu__heading', 'Join a game');
    joinLabel.htmlFor = 'start-code';
    this.codeInput.id = 'start-code';
    this.codeInput.maxLength = config.multiplayer.codeLength + 2;
    this.codeInput.autocomplete = 'off';
    this.codeInput.spellcheck = false;
    this.codeInput.placeholder = 'Lobby code';
    this.codeInput.addEventListener('input', () => {
      const code = normalizeCode(this.codeInput.value);
      if (code !== this.codeInput.value) this.codeInput.value = code;
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.join();
    });
    const joinRow = el('div', 'start__row');
    joinRow.append(this.codeInput, this.joinButton);

    this.createButton.addEventListener('click', () => void this.create());
    this.joinButton.addEventListener('click', () => void this.join());

    this.setup.append(
      el('h2', 'start__panel-title', 'Multiplayer'),
      nameLabel,
      this.nameInput,
      hostHeading,
      hostNote,
      this.createButton,
      joinLabel,
      joinRow,
      this.setupHint,
    );
  }

  private callsign(): string {
    const name = cleanName(this.nameInput.value);
    writeSetting(NAME_SETTING, this.nameInput.value.trim());
    return name;
  }

  private async create(): Promise<void> {
    if (this.busy) return;
    await this.connect(() => NetSession.host(this.callsign()), 'Opening a lobby');
  }

  private async join(): Promise<void> {
    if (this.busy) return;
    const code = normalizeCode(this.codeInput.value);
    if (code.length !== config.multiplayer.codeLength) {
      this.setHint(this.setupHint, `Lobby codes are ${config.multiplayer.codeLength} characters`, true);
      this.codeInput.focus();
      return;
    }
    await this.connect(() => NetSession.join(code, this.callsign()), 'Joining');
  }

  private async connect(open: () => Promise<NetSession>, doing: string): Promise<void> {
    this.busy = true;
    this.createButton.disabled = true;
    this.joinButton.disabled = true;
    this.setHint(this.setupHint, doing, false);
    try {
      const session = await open();
      this.session = session;
      session.onLobbyChanged = () => this.renderLobby();
      session.onStart = () => this.finish({ mode: 'multiplayer', session });
      session.onClosed = (reason) => this.leaveLobby(reason);
      if (this.loaded) session.markLoaded();
      this.setHint(this.setupHint, '', false);
      this.showPage('lobby');
      this.renderLobby();
    } catch (error) {
      this.setHint(this.setupHint, error instanceof NetError ? error.message : 'Could not connect', true);
    } finally {
      this.busy = false;
      this.createButton.disabled = false;
      this.joinButton.disabled = false;
    }
  }

  // ---- Multiplayer: the lobby ----

  private buildLobby(): void {
    const codeRow = el('div', 'start__code-row');
    codeRow.append(this.codeText, this.copyButton);
    this.copyButton.addEventListener('click', () => {
      const code = this.session?.code ?? '';
      void navigator.clipboard?.writeText(code).then(
        () => {
          this.copyButton.textContent = 'Copied';
          setTimeout(() => (this.copyButton.textContent = 'Copy'), 1500);
        },
        () => {},
      );
    });
    this.startButton.addEventListener('click', () => {
      const session = this.session;
      if (!session || !session.isHost || !session.allLoaded || !this.loaded) return;
      session.start();
      this.finish({ mode: 'multiplayer', session });
    });
    this.leaveButton.addEventListener('click', () => this.leaveLobby(''));
    const footer = el('div', 'start__footer');
    footer.append(this.lobbyHint, this.leaveButton, this.startButton);
    this.lobby.append(
      el('h2', 'start__panel-title', 'Lobby'),
      el('h3', 'menu__heading', 'Lobby code'),
      codeRow,
      el('p', 'start__note', 'Send this code to your friends. They pick Multiplayer and join with it.'),
      this.squadHeading,
      this.squad,
      footer,
    );
  }

  private renderLobby(): void {
    const session = this.session;
    if (!session) return;
    this.codeText.textContent = session.code;
    this.copyButton.hidden = !navigator.clipboard;
    const max = config.multiplayer.maxPlayers;
    this.squadHeading.textContent = `Squad  ${session.players.length} / ${max}`;
    this.squad.replaceChildren();
    for (let i = 0; i < max; i++) {
      const player = session.players[i];
      const row = el('li', 'start__member');
      if (!player) {
        row.classList.add('is-open');
        row.append(el('span', 'start__member-name', 'Open slot'));
      } else {
        const name = el('span', 'start__member-name', player.name);
        const tags = el('span', 'start__member-tags');
        if (player.id === 'p0') tags.append(el('span', 'start__tag', 'Host'));
        if (player.id === session.localId) tags.append(el('span', 'start__tag start__tag--you', 'You'));
        const state = el('span', `start__member-state${player.loaded ? ' is-ready' : ''}`, player.loaded ? 'Ready' : 'Loading');
        row.append(name, tags, state);
      }
      this.squad.append(row);
    }
    this.startButton.hidden = !session.isHost;
    const canStart = session.isHost && session.allLoaded && this.loaded;
    this.startButton.disabled = !canStart;
    if (!session.isHost) this.setHint(this.lobbyHint, 'Waiting for the host to start', false);
    else if (!canStart) this.setHint(this.lobbyHint, 'Waiting for everyone to load', false);
    else this.setHint(this.lobbyHint, session.players.length === 1 ? 'You can start alone or wait for friends' : '', false);
  }

  private leaveLobby(reason: string): void {
    this.session?.leave();
    this.session = null;
    this.showPage('setup');
    this.setHint(this.setupHint, reason, reason !== '');
  }

  private showPage(page: 'setup' | 'lobby'): void {
    this.setup.hidden = page !== 'setup';
    this.lobby.hidden = page !== 'lobby';
  }

  private setHint(hint: HTMLElement, text: string, error: boolean): void {
    hint.textContent = text;
    hint.classList.toggle('is-error', error);
  }
}
