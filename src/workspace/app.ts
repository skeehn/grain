export type WorkspaceMode = 'ask' | 'plan' | 'execute';
export interface ComposerInput { command?: string; argument: string; attachments: string[]; }

/** Slash arguments are literal (cron uses @daily); pasted formatting survives. */
export function parseComposerInput(value: string): ComposerInput {
  const trimmed = value.trim();
  if (trimmed.startsWith('/')) {
    const [command, ...rest] = trimmed.slice(1).split(/\s+/);
    return { command: command.toLowerCase(), argument: rest.join(' '), attachments: [] };
  }
  const attachments: string[] = [];
  const text = value.replace(/(^|[ \t]+)@("[^"\n]+"|[^\s]+)([ \t]*)/gm, (_match, before: string, path: string, after: string) => {
    attachments.push(path.replace(/^"|"$/g, ''));
    return before && after ? ' ' : '';
  }).trim();
  return { argument: text, attachments };
}

/** Compatibility export: all interactive entry points share one implementation. */
export async function runWorkspace(options: import('../tui/app.js').TuiAppOptions = {}): Promise<void> {
  const { runTui } = await import('../tui/app.js');
  await runTui(options);
}
