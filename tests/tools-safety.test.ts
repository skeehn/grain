import { describe, expect, test } from 'bun:test';
import { executeBash } from '../src/tools/bash.js';

describe('bounded shell inspection', () => {
  test('rejects searches that escape the workspace before starting a shell', async () => {
    const result = await executeBash(
      { command: 'grep -r "ohmygit" /Users/kstephenkeehn --include="*.md"' },
      '/Users/kstephenkeehn/conductor/repos/grain',
    );
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('outside the workspace');
  });

  test('allows focused relative commands', async () => {
    const result = await executeBash({ command: 'printf grain' }, process.cwd());
    expect(result.is_error).not.toBe(true);
    expect(result.content).toContain('grain');
  });
});
