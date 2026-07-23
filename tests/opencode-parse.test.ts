import { describe, expect, test } from 'bun:test';
import { openCodeModelId, parseOpenCodeJSONL } from '../src/plugins/opencode.js';

describe('OpenCode JSONL conformance', () => {
  test('extracts text, session identity, and usage', () => {
    const parsed = parseOpenCodeJSONL([
      JSON.stringify({ type: 'text', sessionID: 's1', text: 'done', cost: 0.1, tokens: 12 }),
    ].join('\n'));
    expect(parsed).toMatchObject({ text: 'done', sessionId: 's1', cost: 0.1, tokens: 12 });
  });

  test('a semantic error fails even when the process exits zero', () => {
    const parsed = parseOpenCodeJSONL(JSON.stringify({ type: 'error', sessionID: 's2', error: { data: { message: 'Forbidden model' } } }));
    expect(parsed.error).toBe('Forbidden model'); expect(parsed.text).toBe('Forbidden model');
  });

  test('translates Grain provider/model pairs into OpenCode catalog IDs', () => {
    expect(openCodeModelId('openrouter', 'openrouter/free')).toBe('openrouter/openrouter/free');
    expect(openCodeModelId('openrouter', 'cohere/north-mini-code:free')).toBe('openrouter/cohere/north-mini-code:free');
    expect(openCodeModelId('openrouter', 'openrouter/cohere/north-mini-code:free')).toBe('openrouter/cohere/north-mini-code:free');
    expect(openCodeModelId('anthropic', 'claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
  });
});
