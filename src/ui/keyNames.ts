import type { Binding } from '../core/Keybinds';

const NAMES: Record<string, string> = {
  Mouse0: 'Left Mouse',
  Mouse1: 'Middle Mouse',
  Mouse2: 'Right Mouse',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
  Shift: 'Shift',
  Control: 'Ctrl',
  Alt: 'Alt',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  CapsLock: 'Caps Lock',
  ArrowLeft: 'Left Arrow',
  ArrowRight: 'Right Arrow',
  ArrowUp: 'Up Arrow',
  ArrowDown: 'Down Arrow',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  NumpadEnter: 'Num Enter',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
};

/** A key as the player reads it: "KeyE" -> "E", "Digit1" -> "1", "Mouse2" -> "Right Mouse", "" -> "". */
export function keyName(code: string): string {
  const named = NAMES[code];
  if (named !== undefined) return named;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  if (/^Mouse\d+$/.test(code)) return `Mouse ${Number(code.slice(5)) + 1}`;
  return code;
}

/** The key to show in a prompt for an action: its primary key, else its alternate, else "Unbound". */
export function bindingName(binding: Binding): string {
  const key = binding[0] || binding[1];
  return key ? keyName(key) : 'Unbound';
}
