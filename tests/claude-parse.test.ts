import { describe, expect, test } from 'bun:test';
import { isClaudeSuccess, normalizeClaudeResult } from '../src/plugins/claude-code.js';

describe('Claude CLI result compatibility', () => {
  test('accepts modern JSON event arrays by selecting terminal result', () => {
    expect(normalizeClaudeResult([{ type: 'assistant' }, { type: 'result', subtype: 'success', result: 'OK' }]).result).toBe('OK');
    expect(() => normalizeClaudeResult([{ type: 'assistant' }])).toThrow('no terminal result');
  });
  test('rejects billing errors wrapped in nominal success envelopes', () => {
    expect(isClaudeSuccess({ subtype: 'success', is_error: false, result: 'Credit balance is too low' }, 'completed')).toBe(false);
    expect(isClaudeSuccess({ subtype: 'success', is_error: false, result: 'done' }, 'completed')).toBe(true);
  });
});
