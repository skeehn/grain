import type { CellStyle, TerminalCapabilities, TuiFrame } from './types.js';

const sameStyle = (a: CellStyle, b: CellStyle) => a.foreground === b.foreground && a.background === b.background && a.bold === b.bold && a.dim === b.dim;
const sameCell = (a: TuiFrame['cells'][number] | undefined, b: TuiFrame['cells'][number]) => !!a && a.grapheme === b.grapheme && a.width === b.width && sameStyle(a.style, b.style);

function color(value: string | undefined, background: boolean, capabilities: TerminalCapabilities): string {
  if (!value || capabilities.color === 'none') return '';
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match || capabilities.color !== 'truecolor') return '';
  const raw = Number.parseInt(match[1], 16); const r = raw >> 16; const g = (raw >> 8) & 255; const b = raw & 255;
  return `\x1b[${background ? 48 : 38};2;${r};${g};${b}m`;
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
