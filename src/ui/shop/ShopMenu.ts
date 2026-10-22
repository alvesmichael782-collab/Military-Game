import type { EventBus, GameEvents, ShopCatalogEvent, ShopItem, ShopKind } from '../../core/EventBus';
import { createBrushSmear } from '../hud/BrushSmear';
import { formatCash } from '../hud/CashCounter';
import { setFixedDigits } from '../hud/digits';
import { EASE_OUT, prefersReducedMotion } from '../hud/motion';
import type { PromptKeys } from '../hud/PromptKeys';
import type { ShopIcons } from './ShopIcons';
import './ShopMenu.css';

/** A row on screen and the item it shows. */
interface Row {
  readonly button: HTMLButtonElement;
  readonly icon: HTMLImageElement;
  readonly name: HTMLSpanElement;
  readonly detail: HTMLSpanElement;
  readonly price: HTMLSpanElement;
  item: ShopItem;
}

/**
 * The crate shops' buy menu (weapon crate and consumables crate). Opens on `shopOpened` with the mouse freed: a
 * column on the left with the crate's name and cash, one tab per section, and one full-width row per item (white
 * silhouette, name, a detail line, price). The whole row is the buy button; the row under the mouse (and only that
 * one) turns white with everything on it black, and a click buys it. Keys: left/right (or strafe) pick a section,
 * E, Tab or Esc close. Purchases and closing go out as
 * `shopBuyRequested` / `shopCloseRequested`; the shop decides, and its `shopChanged` redraws the rows.
 */
export class ShopMenu {
  private readonly root = document.createElement('div');
  private readonly panel = document.createElement('section');
  private readonly title = document.createElement('h2');
  private readonly cash = document.createElement('span');
  private readonly tabs = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly hints = document.createElement('div');

  private shop: ShopKind | null = null;
  private catalog: ShopCatalogEvent | null = null;
  private section = 0;
  private rows: Row[] = [];
  /** The last section each shop showed, so it reopens where the player left it. */
  private readonly lastSection = new Map<ShopKind, string>();
  /** The row the last buy request came from, for the purchase and denial feedback. */
  private pending: Row | null = null;

  constructor(
    private readonly events: EventBus<GameEvents>,
    parent: HTMLElement,
    private readonly keys: PromptKeys,
    private readonly icons: ShopIcons,
  ) {
    this.root.className = 'shop';
    this.root.hidden = true;
    const scrim = document.createElement('div');
    scrim.className = 'shop__scrim';

    this.panel.className = 'shop__panel';
    this.panel.setAttribute('role', 'dialog');
    const header = document.createElement('header');
    header.className = 'shop__header';
    this.title.className = 'shop__title';
    const cashBox = document.createElement('div');
    cashBox.className = 'shop__cash';
    const smear = createBrushSmear({
      width: 160,
      height: 44,
      color: '#74141a',
      seed: 5150,
      fadeLeft: 0.25,
      fadeRight: 0.2,
      streaks: 14,
      coreOpacity: 0.85,
      coreStart: 0.06,
    });
    this.cash.className = 'shop__cash-amount';
    cashBox.append(smear, this.cash);
    header.append(this.title, cashBox);

    this.tabs.className = 'shop__tabs';
    this.tabs.setAttribute('role', 'tablist');
    this.list.className = 'shop__list';
    this.hints.className = 'shop__hints';
    this.panel.append(header, this.tabs, this.list, this.hints);
    this.root.append(scrim, this.panel);
    // Clicks never move focus onto a row, so Enter and Space cannot press a row the mouse has left.
    this.root.addEventListener('mousedown', (e) => e.preventDefault());
    parent.append(this.root);

    events.on('shopOpened', (catalog) => this.open(catalog));
    events.on('shopChanged', (catalog) => {
      if (catalog.shop === this.shop) this.update(catalog);
    });
    events.on('shopClosed', ({ shop }) => {
      if (shop === this.shop) this.close();
    });
    events.on('cashChanged', ({ cash }) => setFixedDigits(this.cash, formatCash(cash)));
    events.on('shopPurchased', ({ shop }) => {
      if (shop === this.shop && this.pending) this.flash(this.pending);
    });
    const deny = (): void => {
      if (this.shop !== null && this.pending) this.shake(this.pending);
    };
    events.on('actionDenied', deny);
    events.on('cashInsufficient', deny);
    keys.onChange(() => this.renderHints());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.shop !== null;
  }

  private open(catalog: ShopCatalogEvent): void {
    this.shop = catalog.shop;
    this.catalog = catalog;
    this.pending = null;
    const last = this.lastSection.get(catalog.shop);
    this.section = Math.max(0, catalog.sections.findIndex((s) => s.id === last));
    this.title.textContent = catalog.title;
    this.panel.setAttribute('aria-label', catalog.title);
    this.renderTabs();
    this.renderRows();
    this.renderHints();
    this.root.hidden = false;
    if (!prefersReducedMotion()) {
      this.panel.animate(
        [
          { opacity: 0, transform: 'translateX(calc(-24 * var(--rp)))' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 180, easing: EASE_OUT },
      );
    }
  }

  private close(): void {
    if (this.catalog && this.shop) this.lastSection.set(this.shop, this.catalog.sections[this.section]?.id ?? '');
    this.shop = null;
    this.catalog = null;
    this.pending = null;
    this.root.hidden = true;
  }

  /** New contents for the open menu: same sections, so only the rows' text changes. */
  private update(catalog: ShopCatalogEvent): void {
    const sameShape =
      this.catalog !== null &&
      catalog.sections.length === this.catalog.sections.length &&
      catalog.sections.every((s, i) => s.id === this.catalog?.sections[i].id && s.items.length === this.catalog.sections[i].items.length);
    this.catalog = catalog;
    if (!sameShape) {
      this.section = Math.min(this.section, catalog.sections.length - 1);
      this.renderTabs();
      this.renderRows();
      return;
    }
    catalog.sections[this.section].items.forEach((item, i) => this.fillRow(this.rows[i], item));
  }

  private requestClose(): void {
    if (this.shop) this.events.emit('shopCloseRequested', { shop: this.shop });
  }

  private buy(row: Row): void {
    if (!this.shop) return;
    this.pending = row;
    this.events.emit('shopBuyRequested', { shop: this.shop, item: row.item.id });
  }

  // ---- Drawing ----

  private renderTabs(): void {
    const sections = this.catalog?.sections ?? [];
    this.tabs.replaceChildren();
    // One section needs no tabs.
    this.tabs.hidden = sections.length < 2;
    sections.forEach((section, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'shop__tab';
      tab.textContent = section.name;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(i === this.section));
      tab.addEventListener('click', () => this.selectSection(i));
      this.tabs.append(tab);
    });
  }

  private renderRows(): void {
    const items = this.catalog?.sections[this.section]?.items ?? [];
    this.rows = items.map((item) => this.createRow(item));
    this.list.replaceChildren(...this.rows.map((r) => r.button));
    this.list.scrollTop = 0;
  }

  private createRow(item: ShopItem): Row {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shop__row';
    button.tabIndex = -1;
    const iconBox = document.createElement('span');
    iconBox.className = 'shop__icon';
    const icon = document.createElement('img');
    icon.alt = '';
    icon.draggable = false;
    iconBox.append(icon);
    const text = document.createElement('span');
    text.className = 'shop__text';
    const name = document.createElement('span');
    name.className = 'shop__name';
    const detail = document.createElement('span');
    detail.className = 'shop__detail';
    text.append(name, detail);
    const price = document.createElement('span');
    price.className = 'shop__price';
    button.append(iconBox, text, price);

    const row: Row = { button, icon, name, detail, price, item };
    this.fillRow(row, item);
    button.addEventListener('click', () => this.buy(row));
    return row;
  }

  private fillRow(row: Row, item: ShopItem): void {
    row.item = item;
    const src = this.icons.get(item.icon) ?? '';
    if (row.icon.getAttribute('src') !== src) row.icon.src = src;
    row.name.textContent = item.name;
    row.detail.textContent = item.error ?? item.detail;
    setFixedDigits(row.price, formatCash(item.price));
    row.button.classList.toggle('is-unavailable', item.error !== null);
    row.button.classList.toggle('is-unaffordable', !item.affordable);
    row.button.setAttribute('aria-label', `${item.action === 'refill' ? 'Refill' : 'Buy'} ${item.name}, ${formatCash(item.price)}`);
  }

  private renderHints(): void {
    const hint = (keys: string[], label: string, onClick?: () => void): HTMLElement => {
      const el = document.createElement(onClick ? 'button' : 'span');
      el.className = 'shop__hint';
      if (onClick) {
        (el as HTMLButtonElement).type = 'button';
        el.addEventListener('click', onClick);
      }
      for (const key of keys) {
        const cap = document.createElement('kbd');
        cap.textContent = key;
        el.append(cap);
      }
      el.append(label);
      return el;
    };
    const many = (this.catalog?.sections.length ?? 0) > 1;
    this.hints.replaceChildren(
      hint(['CLICK'], 'Buy'),
      ...(many ? [hint([this.keys.name('moveLeft'), this.keys.name('moveRight')], 'Section')] : []),
      hint([this.keys.name('interact') || 'E'], 'Close', () => this.requestClose()),
    );
  }

  // ---- Selection ----

  private selectSection(index: number): void {
    const count = this.catalog?.sections.length ?? 0;
    if (count === 0) return;
    const next = (index + count) % count;
    if (next === this.section) return;
    this.section = next;
    this.renderTabs();
    this.renderRows();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen || e.metaKey) return;
    const code = e.code;
    const k = this.keys;
    let handled = true;
    const close = code === 'Escape' || code === 'Tab' || k.matches('interact', code);
    // Held arrows keep stepping through sections; closing needs a fresh press.
    if (close && !e.repeat) this.requestClose();
    else if (close) handled = true;
    else if (code === 'ArrowLeft' || k.matches('moveLeft', code)) this.selectSection(this.section - 1);
    else if (code === 'ArrowRight' || k.matches('moveRight', code)) this.selectSection(this.section + 1);
    else handled = false;
    if (handled) e.preventDefault();
  }

  // ---- Feedback ----

  /** A bought row flashes red and settles back. */
  private flash(row: Row): void {
    if (prefersReducedMotion()) return;
    row.button.animate([{ boxShadow: 'inset 0 0 0 999px rgba(184, 20, 28, 0.85)' }, { boxShadow: 'inset 0 0 0 999px rgba(184, 20, 28, 0)' }], {
      duration: 380,
      easing: EASE_OUT,
    });
  }

  /** A refused row shakes, so its reason line gets read. */
  private shake(row: Row): void {
    if (prefersReducedMotion()) return;
    const x = (n: number): string => `translateX(calc(${n} * var(--rp)))`;
    row.button.animate(
      [{ transform: x(0) }, { transform: x(-7) }, { transform: x(7) }, { transform: x(-4) }, { transform: x(2) }, { transform: x(0) }],
      { duration: 280, easing: 'ease-out' },
    );
  }
}
