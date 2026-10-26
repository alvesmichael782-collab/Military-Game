import { createBrushSmear } from './BrushSmear';
import { setFixedDigits } from './digits';
import './SummaryPanel.css';

/**
 * One line of the stats list: a label and a HUD-made value string (digits, "$", ",", "/"). A `minor` line is a
 * smaller, indented breakdown of the line above it.
 */
export type SummaryRow = readonly [label: string, value: string, minor?: boolean];

/**
 * A centered block of HUD text, for the wave summary and the win and lose screens: a big title over a red
 * brush smear, a short list of stats, and a footer line. White text with soft shadows, no box behind it.
 */
export class SummaryPanel {
  private readonly root = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly stats = document.createElement('dl');
  private readonly footer = document.createElement('div');

  constructor(parent: HTMLElement, className: string, smearSeed: number) {
    this.root.className = `hud-summary ${className}`;
    this.root.hidden = true;
    const head = document.createElement('div');
    head.className = 'hud-summary__head';
    const smear = createBrushSmear({
      width: 520,
      height: 92,
      color: '#9a161b',
      seed: smearSeed,
      fadeLeft: 0.16,
      fadeRight: 0.12,
      streaks: 26,
      coreOpacity: 0.9,
      coreStart: 0.06,
    });
    this.title.className = 'hud-summary__title';
    head.append(smear, this.title);
    this.stats.className = 'hud-summary__stats';
    this.footer.className = 'hud-summary__footer';
    this.root.append(head, this.stats, this.footer);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(title: string, rows: readonly SummaryRow[], footer: string): void {
    this.title.textContent = title;
    this.stats.replaceChildren(
      ...rows.map(([label, value, minor], i) => {
        const row = document.createElement('div');
        row.className = minor ? 'hud-summary__row hud-summary__row--minor' : 'hud-summary__row';
        row.style.setProperty('--row', String(i));
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        setFixedDigits(dd, value);
        row.append(dt, dd);
        return row;
      }),
    );
    this.setFooter(footer);
    // Restart the entrance animation each time it opens.
    this.root.hidden = true;
    void this.root.offsetWidth;
    this.root.hidden = false;
  }

  setFooter(text: string): void {
    setFixedDigits(this.footer, text);
  }

  hide(): void {
    this.root.hidden = true;
  }
}
