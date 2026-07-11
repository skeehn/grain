import type { ColorCapability, TerminalCapabilities } from './types.js';

function detectColor(env: NodeJS.ProcessEnv, tty: boolean): ColorCapability {
  if (!tty || env.NO_COLOR !== undefined || env.TERM === 'dumb') return 'none';
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 'truecolor';
  if (env.TERM?.includes('256color')) return 'ansi256';
  return 'ansi16';
}

export function detectTerminalCapabilities(input: {
  columns?: number; rows?: number; isTTY?: boolean; env?: NodeJS.ProcessEnv;
} = {}): TerminalCapabilities {
  const env = input.env || process.env;
  const tty = input.isTTY ?? Boolean(process.stdout.isTTY);
  const term = env.TERM || '';
  return {
    columns: Math.max(20, input.columns || process.stdout.columns || 80),
    rows: Math.max(8, input.rows || process.stdout.rows || 24),
    color: detectColor(env, tty),
    unicode: env.GRAIN_ASCII !== '1' && !/^(dumb|cons25)$/.test(term),
    mouse: tty && env.GRAIN_MOUSE !== '0',
    reducedMotion: env.GRAIN_REDUCED_MOTION === '1' || env.CI === 'true',
  };
}
