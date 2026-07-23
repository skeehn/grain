// Modal list overlay for the full-screen TUI.
//
// The standalone `interactiveSelect` takes over stdin, which the TUI already
// owns — so pickers live here instead: pure state plus a frame painter, driven
// by the same key stream as the composer.
import { putText } from './frame.js';
import type { GrainTheme } from './theme.js';
import type { TuiFrame } from './types.js';

export interface OverlayItem<T = unknown> {
  label: string;
  hint?: string;
  value: T;
  /** Renders dimmed with its `fix` shown — selectable, but the user is warned. */
  disabled?: boolean;
  fix?: string;
  group?: string;
  current?: boolean;
}

export interface OverlayState<T = unknown> {
  title: string;
  items: OverlayItem<T>[];
  filter: string;
  index: number;
  /** Called with the chosen value, or null when dismissed. */
  resolve: (value: T | null, item?: OverlayItem<T>) => void;
}

/** Case-insensitive subsequence match, so "cso" finds "claude · sonnet". */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const text = haystack.toLowerCase();
  let cursor = 0;
  for (const char of needle.toLowerCase()) {
    if (char === ' ') continue;
    cursor = text.indexOf(char, cursor);
    if (cursor < 0) return false;
    cursor++;
  }
  return true;
}

export function filterItems<T>(items: OverlayItem<T>[], filter: string): OverlayItem<T>[] {
  if (!filter.trim()) return items;
  const exact = items.filter(item => `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  if (exact.length) return exact;
  return items.filter(item => fuzzyMatch(`${item.label} ${item.hint ?? ''}`, filter));
}

export type OverlayKey = 'up' | 'down' | 'page-up' | 'page-down' | 'home' | 'end' | 'accept' | 'dismiss' | 'backspace';

/** Decode a raw terminal chunk into one overlay intent, or literal text. */
export function decodeOverlayKey(data: string): { key?: OverlayKey; text?: string } {
  switch (data) {
    case '\x1b[A': case '\x10': return { key: 'up' };
    case '\x1b[B': case '\x0e': return { key: 'down' };
    case '\x1b[5~': return { key: 'page-up' };
    case '\x1b[6~': return { key: 'page-down' };
    case '\x1b[H': case '\x01': return { key: 'home' };
    case '\x1b[F': case '\x05': return { key: 'end' };
    case '\r': case '\n': return { key: 'accept' };
    case '\x1b': case '\x03': case '\x04': return { key: 'dismiss' };
    case '\x7f': case '\b': return { key: 'backspace' };
    default:
      if (data.startsWith('\x1b')) return {};
      return { text: [...data].filter(char => char >= ' ').join('') };
  }
}

/** Apply one decoded key. Returns 'closed' when the overlay resolved. */
export function applyOverlayKey<T>(state: OverlayState<T>, data: string, pageSize = 8): 'open' | 'closed' {
  const { key, text } = decodeOverlayKey(data);
  const visible = filterItems(state.items, state.filter);
  const last = Math.max(0, visible.length - 1);
  const move = (next: number) => { state.index = Math.min(last, Math.max(0, next)); };
  switch (key) {
    case 'up': state.index = state.index <= 0 ? last : state.index - 1; return 'open';
    case 'down': state.index = state.index >= last ? 0 : state.index + 1; return 'open';
    case 'page-up': move(state.index - pageSize); return 'open';
    case 'page-down': move(state.index + pageSize); return 'open';
    case 'home': state.index = 0; return 'open';
    case 'end': state.index = last; return 'open';
    case 'backspace': state.filter = state.filter.slice(0, -1); state.index = 0; return 'open';
    case 'dismiss': state.resolve(null); return 'closed';
    case 'accept': {
      const chosen = visible[state.index];
      state.resolve(chosen ? chosen.value : null, chosen);
      return 'closed';
    }
    default:
      if (text) { state.filter += text; state.index = 0; }
      return 'open';
  }
}

function clip(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

/** Paint the overlay centred over an already-rendered frame. */
export function paintOverlay<T>(frame: TuiFrame, state: OverlayState<T>, theme: GrainTheme): void {
  const visible = filterItems(state.items, state.filter);
  const width = Math.min(frame.width - 4, Math.max(46, Math.floor(frame.width * 0.72)));
  const rows = Math.min(Math.max(6, frame.height - 8), Math.max(6, visible.length + 4));
  const left = Math.max(1, Math.floor((frame.width - width) / 2));
  const top = Math.max(1, Math.floor((frame.height - rows) / 2));
  const listHeight = rows - 4;
  if (state.index >= visible.length) state.index = Math.max(0, visible.length - 1);
  const start = Math.max(0, Math.min(state.index - Math.floor(listHeight / 2), Math.max(0, visible.length - listHeight)));

  const shell = { foreground: theme.text, background: theme.raised };
  const edge = { foreground: theme.line, background: theme.raised };
  for (let row = 0; row < rows; row++) {
    putText(frame, top + row, left, ' '.repeat(width), shell);
    putText(frame, top + row, left, '│', edge);
    putText(frame, top + row, left + width - 1, '│', edge);
  }

  putText(frame, top, left, `┌${'─'.repeat(width - 2)}┐`, edge);
  putText(frame, top, left + 2, ` ${clip(state.title, width - 6)} `, { foreground: theme.accent, background: theme.raised, bold: true });
  const query = state.filter ? `/${state.filter}` : 'type to filter';
  putText(frame, top + 1, left + 2, clip(query, width - 4),
    { foreground: state.filter ? theme.text : theme.muted, background: theme.raised });

  for (let row = 0; row < listHeight; row++) {
    const item = visible[start + row];
    const y = top + 2 + row;
    if (!item) continue;
    const selected = start + row === state.index;
    const background = selected ? theme.panel : theme.raised;
    const foreground = item.disabled ? theme.muted : selected ? theme.accent : theme.text;
    putText(frame, y, left + 1, ' '.repeat(width - 2), { background, foreground });
    const marker = selected ? '❯' : item.current ? '●' : ' ';
    putText(frame, y, left + 2, marker, { foreground: item.current ? theme.success : theme.accent, background, bold: true });
    const hint = item.disabled && item.fix ? item.fix : item.hint || '';
    // Give the label the room it needs; the hint takes what is left over.
    const labelWidth = Math.max(12, Math.min(item.label.length, width - 8 - Math.min(hint.length, 24)));
    const cursor = putText(frame, y, left + 4, clip(item.label, labelWidth), { foreground, background, bold: selected });
    if (hint) putText(frame, y, cursor + 2, clip(hint, left + width - cursor - 3), { foreground: theme.muted, background });
  }
  if (!visible.length) putText(frame, top + 2, left + 4, 'no matches', { foreground: theme.muted, background: theme.raised });

  const footer = `↑↓ move · enter select · esc cancel${visible.length ? `  ·  ${state.index + 1}/${visible.length}` : ''}`;
  putText(frame, top + rows - 2, left + 2, clip(footer, width - 4), { foreground: theme.muted, background: theme.raised });
  putText(frame, top + rows - 1, left, `└${'─'.repeat(width - 2)}┘`, edge);
  frame.cursor = { row: top + 1, column: left + 2 + Math.min(width - 6, query.length), visible: true };
}
