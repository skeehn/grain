import { describe, test, expect } from 'bun:test';

// cli.ts runs main() at import time — point argv at the harmless
// `--version` command before importing so nothing heavy executes.
const savedArgv = process.argv;
process.argv = ['bun', 'grain', '--version'];
const { parseArgs, validateInvocation } = await import('../src/cli.js');
process.argv = savedArgv;

const parse = (...args: string[]) => parseArgs(['bun', 'grain', ...args]);

describe('validateInvocation', () => {
  test('rejects an unknown --provider with a clear message', () => {
    const msg = validateInvocation(parse('--provider', 'notreal', '-p', 'hi'));
    expect(msg).toContain('Invalid provider "notreal"');
  });

  test('accepts a valid --provider', () => {
    expect(validateInvocation(parse('--provider', 'openrouter', '-p', 'hi'))).toBeNull();
  });

  test('rejects an empty print-mode task', () => {
    expect(validateInvocation(parse('-p', ''))).toContain('No task provided');
    // `-p` with no following value leaves prompt undefined in print mode.
    expect(validateInvocation(parse('-p'))).toContain('No task provided');
    // whitespace-only is still empty
    expect(validateInvocation(parse('-p', '   '))).toContain('No task provided');
  });

  test('accepts a real print-mode task', () => {
    expect(validateInvocation(parse('-p', 'fix the bug'))).toBeNull();
  });

  test('does not require a prompt in interactive (non-print) mode', () => {
    // Bare `grain` opens the workspace REPL; an empty prompt there is valid.
    expect(validateInvocation(parse())).toBeNull();
  });
});
