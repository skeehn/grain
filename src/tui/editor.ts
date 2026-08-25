export type EditorAction = 'submit' | 'cancel' | 'tab' | 'clear' | 'changed' | 'none';

/** `@path` token immediately before the cursor, if the user is attaching a file. */
export function mentionAtCursor(value: string, cursor: number): { start: number; query: string } | null {
  const before = value.slice(0, cursor);
  const match = /(?:^|[\s])@([^\s]*)$/u.exec(before);
  if (!match) return null;
  return { start: before.lastIndexOf('@'), query: match[1] };
}

/** Unicode-aware terminal composer with history and bracketed-paste support. */
export class LineEditor {
  private chars: string[] = [];
  private cursor = 0;
  private readonly history: string[] = [];
  private historyIndex = 0;
  private pendingInput = '';

  value(): string { return this.chars.join(''); }
  cursorIndex(): number { return this.cursor; }
  cursorColumn(): number { return this.chars.slice(0, this.cursor).join('').replace(/\n/g, '↵').length; }
  mention(): { start: number; query: string } | null { return mentionAtCursor(this.value(), this.cursor); }
  replaceMention(path: string): void {
    const mention = this.mention();
    if (!mention) return;
    const token = `@${path.replace(/^@/, '')} `;
    const chars = Array.from(token);
    this.chars.splice(mention.start, this.cursor - mention.start, ...chars);
    this.cursor = mention.start + chars.length;
  }
  displayValue(): string { return this.value().replace(/\n/g, '↵'); }
  setValue(value: string): void { this.chars = Array.from(value); this.cursor = this.chars.length; }
  clear(): void { this.chars = []; this.cursor = 0; }

  commit(): string {
    const value = this.value();
    if (value.trim() && this.history.at(-1) !== value) this.history.push(value);
    if (this.history.length > 200) this.history.shift();
    this.historyIndex = this.history.length;
    this.clear();
    return value;
  }

  feed(data: string): EditorAction {
    if (data.startsWith('\x1b[200~') && data.endsWith('\x1b[201~')) {
      this.insert(data.slice(6, -6).replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
      return 'changed';
    }
    if (data === '\x1b[A') return this.recall(-1);
    if (data === '\x1b[B') return this.recall(1);
    if (data === '\x1b[D') { this.cursor = Math.max(0, this.cursor - 1); return 'changed'; }
    if (data === '\x1b[C') { this.cursor = Math.min(this.chars.length, this.cursor + 1); return 'changed'; }
    if (data === '\x1b[H' || data === '\x01') { this.cursor = 0; return 'changed'; }
    if (data === '\x1b[F' || data === '\x05') { this.cursor = this.chars.length; return 'changed'; }
    if (data === '\x1b[3~') { if (this.cursor < this.chars.length) this.chars.splice(this.cursor, 1); return 'changed'; }
    if (data === '\x7f' || data === '\b') { if (this.cursor > 0) this.chars.splice(--this.cursor, 1); return 'changed'; }
    if (data === '\r') return 'submit';
    if (data === '\n') { this.insert('\n'); return 'changed'; }
    if (data === '\x03') return 'cancel';
    if (data === '\x0c') return 'clear';
    if (data === '\t') return 'tab';
    if (data === '\x1b') { this.clear(); return 'cancel'; }
    if (data.startsWith('\x1b')) return 'none';
    const printable = Array.from(data).filter(char => char === '\n' || char >= ' ').join('');
    if (printable) { this.insert(printable); return 'changed'; }
    return 'none';
  }

  /** Decode a terminal data chunk without losing controls batched with text. */
  feedAll(data: string): EditorAction[] {
    let input = this.pendingInput + data; this.pendingInput = ''; const actions: EditorAction[] = [];
    const escapes = ['\x1b[200~', '\x1b[201~', '\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D', '\x1b[H', '\x1b[F', '\x1b[3~'];
    while (input) {
      if (input.startsWith('\x1b[200~')) {
        const end = input.indexOf('\x1b[201~', 6);
        if (end < 0) { this.pendingInput = input; break; }
        actions.push(this.feed(input.slice(0, end + 6))); input = input.slice(end + 6); continue;
      }
      const escape = escapes.find(sequence => input.startsWith(sequence));
      if (escape) { actions.push(this.feed(escape)); input = input.slice(escape.length); continue; }
      if (input.startsWith('\x1b') && escapes.some(sequence => sequence.startsWith(input))) { this.pendingInput = input; break; }
      const control = input.search(/[\r\n\x03\x0c\t\x7f\b\x1b]/u);
      if (control === 0) { actions.push(this.feed(input[0])); input = input.slice(1); continue; }
      const length = control < 0 ? input.length : control;
      actions.push(this.feed(input.slice(0, length))); input = input.slice(length);
    }
    return actions.filter(action => action !== 'none');
  }

  private insert(value: string): void {
    const chars = Array.from(value); this.chars.splice(this.cursor, 0, ...chars); this.cursor += chars.length;
  }

  private recall(offset: number): EditorAction {
    if (!this.history.length) return 'none';
    this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + offset));
    this.setValue(this.historyIndex === this.history.length ? '' : this.history[this.historyIndex]);
    return 'changed';
  }
}
