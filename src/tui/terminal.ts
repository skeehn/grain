import { stripVTControlCharacters } from 'node:util';
import { Chalk } from 'chalk';
import { detectTerminalCapabilities } from './capabilities.js';
import { resolveTheme, type GrainThemeName, type GrainThemeRole } from './theme.js';
import { graphemeWidth } from './frame.js';

export function terminalText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

export function asciiBlock(title: string, body: string, columns = 80): string {
  const width = Math.max(8, Math.min(76, columns - 1));
  const label = terminalText(title).replace(/\n/g, ' ').slice(0, width - 5);
  const lines: string[] = [];
  for (const source of terminalText(body).split('\n')) {
    let line = ''; let cells = 0;
    for (const char of source.replace(/\t/g, '  ')) {
      const size = graphemeWidth(char);
      if (cells + size > width - 4) { lines.push('| ' + line); line = ''; cells = 0; }
      line += char; cells += size;
    }
    lines.push('| ' + line);
  }
  return `+- ${label} ${'-'.repeat(Math.max(0, width - label.length - 5))}+\n${lines.join('\n')}\n+${'-'.repeat(width - 2)}+\n`;
}

export const WELCOME = [
  '   .----.     G R A I N',
  '  / o  o \\    your little work companion',
  '  |  __  |',
  '   \\____/     think. make. check. repeat.',
].join('\n');

/** Only the current input line is redrawn; answers belong to native scrollback. */
export class ScrollingTerminal {
  private ephemeral = false;
  private midLine = false;
  private escape: 'text' | 'esc' | 'csi' | 'string' | 'string-esc' = 'text';
  private theme = resolveTheme(undefined);
  private color = new Chalk({ level: ({ none: 0, ansi16: 1, ansi256: 2, truecolor: 3 } as const)[detectTerminalCapabilities().color] });
  constructor(private output: { write(text: string): unknown; columns?: number } = process.stdout) {}
  setTheme(name?: GrainThemeName): void { this.theme = resolveTheme(name); }

  clearPrompt(): void {
    if (this.ephemeral) this.output.write('\r\x1b[2K');
    this.ephemeral = false;
  }

  stream(text: string): void {
    this.clearPrompt();
    // Escape sequences may span provider chunks, including OSC clipboard commands.
    let clean = '';
    for (const char of text) {
      if (this.escape === 'string') { if (char === '\x07' || char === '\x9c') this.escape = 'text'; else if (char === '\x1b') this.escape = 'string-esc'; continue; }
      if (this.escape === 'string-esc') { this.escape = char === '\\' ? 'text' : 'string'; continue; }
      if (this.escape === 'csi') { if (char >= '@' && char <= '~') this.escape = 'text'; continue; }
      if (this.escape === 'esc') { this.escape = char === '[' ? 'csi' : 'X]P^_'.includes(char) ? 'string' : 'text'; continue; }
      if (char === '\x1b') { this.escape = 'esc'; continue; }
      if (char === '\x9b') { this.escape = 'csi'; continue; }
      if (char === '\x9d') { this.escape = 'string'; continue; }
      if (char === '\n' || char === '\t' || (char >= ' ' && !(char >= '\x7f' && char <= '\x9f'))) clean += char;
    }
    this.output.write(clean);
    if (clean) this.midLine = !clean.endsWith('\n');
  }

  line(text = '', role?: GrainThemeRole): void {
    this.clearPrompt();
    if (this.midLine) this.output.write('\n');
    const clean = terminalText(text);
    this.output.write((role ? this.color.hex(this.theme[role])(clean) : clean) + '\n');
    this.midLine = false;
  }

  block(title: string, body: string): void {
    this.line(asciiBlock(title, body, this.output.columns).trimEnd(), 'accent');
  }

  prompt(prefix: string, value = '', cursor = Array.from(value).length): void {
    this.clearPrompt();
    if (this.midLine) { this.output.write('\n'); this.midLine = false; }
    const room = Math.max(1, (this.output.columns || 80) - prefix.length - 2);
    const chars = Array.from(terminalText(value).replace(/\n/g, '~').replace(/\t/g, ' '));
    let start = Math.min(cursor, chars.length); let before = 0;
    while (start > 0 && before + graphemeWidth(chars[start - 1]) < room) before += graphemeWidth(chars[--start]);
    let visible = ''; let width = 0;
    for (const char of chars.slice(start)) {
      const size = graphemeWidth(char);
      if (width + size > room) break;
      visible += char; width += size;
    }
    this.output.write(this.color.hex(this.theme.accent)(prefix) + visible + '\r' + `\x1b[${prefix.length + before + 1}G`);
    this.ephemeral = true;
  }

  close(): void { this.clearPrompt(); this.line(); }
}
