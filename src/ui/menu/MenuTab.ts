/** One tab of the pause menu. Add a tab by writing one of these and listing it in `PauseMenu`. */
export interface MenuTab {
  /** Shown on the tab button. */
  readonly title: string;
  /** The tab's content, built once. */
  readonly element: HTMLElement;
  /** The tab was switched away from, or the menu closed: drop anything half done. */
  leave?(): void;
}
