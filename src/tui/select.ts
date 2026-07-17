import chalk from 'chalk';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string) => color ? chalk.hex('#817D73')(s) : s;
const grain = (s: string) => color ? chalk.hex('#D6A85F')(s) : s;
const invert = (s: string) => color ? chalk.bgHex('#2A2E36').hex('#E7E0D2')(s) : `> ${s}`;

export interface SelectItem<T> { label: string; hint?: string; value: T; current?: boolean }
export interface SelectOptions<T> { title: string; items: SelectItem<T>[]; filterable?: boolean; visible?: number }

/**
 * Interactive raw-mode list picker (arrow / Ctrl-P-N to move, type to filter,
 * Enter to pick, Esc to cancel). Self-contained modal: it takes over the
 * keyboard only for its own lifetime, then restores the terminal — so it
 * composes with the readline-based prompt instead of replacing it.
 * Resolves to the chosen value, or null on cancel / non-TTY.
 */
export function interactiveSelect<T>(opts: SelectOptions<T>): Promise<T | null> {
  const { title, items, filterable = true } = opts;
  const visible = Math.max(4, Math.min(opts.visible ?? 10, (process.stdout.rows || 24) - 4));
  if (!process.stdin.isTTY || !process.stdout.isTTY || items.length === 0) return Promise.resolve(null);

  return new Promise<T | null>(resolve => {
    let filter = '';
    let selected = 0;
    let top = 0;
    let linesDrawn = 0;
    const out = process.stdout;

    const filtered = () => {
      const q = filter.toLowerCase();
      return q ? items.filter(i => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(q)) : items;
    };

    const clear = () => { if (linesDrawn > 0) out.write(`\x1b[${linesDrawn}A\x1b[J`); linesDrawn = 0; };

    const render = () => {
      clear();
      const list = filtered();
      if (selected >= list.length) selected = Math.max(0, list.length - 1);
      if (selected < top) top = selected;
      if (selected >= top + visible) top = selected - visible + 1;
      const window = list.slice(top, top + visible);
      const rows: string[] = [];
      rows.push(`${grain('▚')} ${title}${filterable ? dim(`   ${filter ? `/${filter}` : 'type to filter'}`) : ''}`);
      for (let i = 0; i < window.length; i++) {
        const item = window[i];
        const idx = top + i;
        const mark = item.current ? grain(' ●') : '  ';
        const text = `${item.label}${item.hint ? dim(`  ${item.hint}`) : ''}`;
        rows.push(idx === selected ? invert(` ${text} `) + mark : ` ${text}${mark}`);
      }
      if (list.length === 0) rows.push(dim('  no matches'));
      rows.push(dim(`  ↑↓ move · enter select · esc cancel${list.length > visible ? ` · ${selected + 1}/${list.length}` : ''}`));
      out.write(rows.join('\n') + '\n');
      linesDrawn = rows.length;
    };

    const cleanup = () => {
      clear();
      process.stdin.off('data', onKey);
      try { process.stdin.setRawMode(false); } catch { /* stdin closed */ }
      process.stdin.pause();
      out.write('\x1b[?25h');
    };

    const finish = (value: T | null) => { cleanup(); resolve(value); };

    const onKey = (data: Buffer) => {
      const key = data.toString('utf8');
      const list = filtered();
      if (key === '\x1b[A' || key === '\x10') { selected = selected <= 0 ? list.length - 1 : selected - 1; render(); return; } // up / Ctrl-P
      if (key === '\x1b[B' || key === '\x0e') { selected = selected >= list.length - 1 ? 0 : selected + 1; render(); return; } // down / Ctrl-N
      if (key === '\r' || key === '\n') { finish(list[selected]?.value ?? null); return; }
      if (key === '\x1b' || key === '\x03' || key === '\x04') { finish(null); return; } // esc / Ctrl-C / Ctrl-D
      if (key === '\x7f' || key === '\b') { filter = filter.slice(0, -1); selected = 0; render(); return; } // backspace
      if (filterable && key >= ' ' && key.length === 1) { filter += key; selected = 0; render(); return; }
    };

    out.write('\x1b[?25l'); // hide cursor
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onKey);
    render();
  });
}
