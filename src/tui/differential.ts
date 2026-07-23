import type { CellStyle, TerminalCapabilities, TuiFrame } from './types.js';

const sameStyle = (a: CellStyle, b: CellStyle) => a.foreground === b.foreground && a.background === b.background && a.bold === b.bold && a.dim === b.dim;
const sameCell = (a: TuiFrame['cells'][number] | undefined, b: TuiFrame['cells'][number]) => !!a && a.grapheme === b.grapheme && a.width === b.width && sameStyle(a.style, b.style);

/** xterm-256 index for an RGB triple: 6×6×6 cube, or the 24-step grey ramp. */
export function ansi256Index(r: number, g: number, b: number): number {
  if (Math.max(r, g, b) - Math.min(r, g, b) < 12) {
    const level = Math.round((((r + g + b) / 3) - 8) / 247 * 23);
    return 232 + Math.min(23, Math.max(0, level));
  }
  const axis = (value: number) => Math.round(Math.min(255, Math.max(0, value)) / 255 * 5);
  return 16 + 36 * axis(r) + 6 * axis(g) + axis(b);
}

function color(value: string | undefined, background: boolean, capabilities: TerminalCapabilities): string {
  if (!value || capabilities.color === 'none') return '';
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return '';
  const raw = Number.parseInt(match[1], 16); const r = raw >> 16; const g = (raw >> 8) & 255; const b = raw & 255;
  if (capabilities.color === 'truecolor') return `\x1b[${background ? 48 : 38};2;${r};${g};${b}m`;
  // Most terminals report only 256-color support; without this fallback the
  // whole interface rendered as undifferentiated white-on-black.
  if (capabilities.color === 'ansi256') return `\x1b[${background ? 48 : 38};5;${ansi256Index(r, g, b)}m`;
  const basic = (r > 127 ? 1 : 0) | (g > 127 ? 2 : 0) | (b > 127 ? 4 : 0);
  return `\x1b[${(background ? 40 : 30) + basic}m`;
}

function styleAnsi(style: CellStyle, capabilities: TerminalCapabilities): string {
  if (capabilities.color === 'none') return '';
  return `\x1b[0m${style.bold ? '\x1b[1m' : ''}${style.dim ? '\x1b[2m' : ''}${color(style.foreground, false, capabilities)}${color(style.background, true, capabilities)}`;
}

export function diffFrames(previous: TuiFrame | undefined, next: TuiFrame, capabilities: TerminalCapabilities): string {
  let output = '';
  for (let row = 0; row < next.height; row++) {
    let column = 0;
    while (column < next.width) {
      const index = row * next.width + column; const cell = next.cells[index];
      if (cell.width === 0 || (previous?.width === next.width && previous.height === next.height && sameCell(previous.cells[index], cell))) { column++; continue; }
      output += `\x1b[${row + 1};${column + 1}H${styleAnsi(cell.style, capabilities)}`;
      let active = cell.style;
      while (column < next.width) {
        const currentIndex = row * next.width + column; const current = next.cells[currentIndex];
        if (current.width === 0) { column++; continue; }
        const unchanged = previous?.width === next.width && previous.height === next.height && sameCell(previous.cells[currentIndex], current);
        if (unchanged && column > 0) break;
        if (!sameStyle(active, current.style)) { output += styleAnsi(current.style, capabilities); active = current.style; }
        output += current.grapheme || ' '; column += Math.max(1, current.width);
      }
    }
  }
  if (capabilities.color !== 'none') output += '\x1b[0m';
  const cursor = next.cursor;
  output += cursor ? `\x1b[${cursor.row + 1};${cursor.column + 1}H${cursor.visible ? '\x1b[?25h' : '\x1b[?25l'}` : '\x1b[?25l';
  return output;
}

export class DifferentialRenderer {
  private previous?: TuiFrame;
  constructor(private readonly capabilities: TerminalCapabilities, private readonly write: (value: string) => void = value => process.stdout.write(value)) {}
  render(frame: TuiFrame): string { const patch = diffFrames(this.previous, frame, this.capabilities); this.write(patch); this.previous = frame; return patch; }
  invalidate(): void { this.previous = undefined; }
}
