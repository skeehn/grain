import { describe, test, expect } from 'bun:test';
import { CodexPlugin } from '../src/plugins/codex.js';

// parseJSONL is private; exercised via the instance for parsing correctness.
const parse = (jsonl: string) => (new CodexPlugin() as any).parseJSONL(jsonl);

const sample = [
  JSON.stringify({ type: 'thread.started', thread_id: 'th_123' }),
  JSON.stringify({ type: 'turn.started' }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Did the task.' } }),
  JSON.stringify({ type: 'item.completed', item: { type: 'file_edit', path: 'src/a.ts' } }),
  JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 10_000, cached_input_tokens: 4_000, output_tokens: 2_000 },
  }),
].join('\n');

describe('CodexPlugin.parseJSONL', () => {
  test('extracts summary, files, thread id, and usage', () => {
    const out = parse(sample);
    expect(out.summary).toContain('Did the task.');
    expect(out.summary).toContain('src/a.ts');
    expect(out.filesModified).toEqual(['src/a.ts']);
    expect(out.threadId).toBe('th_123');
    expect(out.usage.input_tokens).toBe(10_000);
  });

  test('computes cost with cached-token discount', () => {
    const out = parse(sample);
    // (10000-4000)/1000*0.003 + 4000/1000*0.0003 + 2000/1000*0.015 = 0.018 + 0.0012 + 0.03
    expect(out.cost).toBeCloseTo(0.0492, 6);
  });

  test('skips malformed lines instead of throwing', () => {
    const out = parse('not json\n' + sample + '\n{broken');
    expect(out.summary).toContain('Did the task.');
  });

  test('empty input yields fallback summary and nulls', () => {
    const out = parse('');
    expect(out.summary).toBe('Codex completed (no output captured)');
    expect(out.cost).toBeNull();
    expect(out.threadId).toBeNull();
    expect(out.filesModified).toEqual([]);
  });
});
