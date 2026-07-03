import { describe, test, expect } from 'bun:test';
import { CodexPlugin } from '../src/plugins/codex.js';

// parseJSONL is private; exercised via the instance for parsing correctness.
const parse = (jsonl: string) => (new CodexPlugin() as any).parseJSONL(jsonl);

const line = (obj: unknown) => JSON.stringify(obj);

describe('CodexPlugin.parseJSONL — file_change items', () => {
  test('extracts paths from file_change changes array', () => {
    const jsonl = [
      line({ type: 'thread.started', thread_id: 'th_1' }),
      line({ type: 'item.completed', item: { type: 'agent_message', text: 'Edited files.' } }),
      line({
        type: 'item.completed',
        item: {
          type: 'file_change',
          changes: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
        },
      }),
    ].join('\n');

    const out = parse(jsonl);
    expect(out.filesModified).toEqual(['src/a.ts', 'src/b.ts']);
    expect(out.summary).toContain('src/a.ts');
    expect(out.summary).toContain('src/b.ts');
  });

  test('keeps backward compat with file_edit + path shape', () => {
    const jsonl = [
      line({ type: 'item.completed', item: { type: 'file_edit', path: 'legacy.ts' } }),
      line({
        type: 'item.completed',
        item: { type: 'file_change', changes: [{ path: 'new.ts' }] },
      }),
    ].join('\n');

    const out = parse(jsonl);
    expect(out.filesModified).toEqual(['legacy.ts', 'new.ts']);
  });

  test('file_change with missing or empty changes does not crash', () => {
    const jsonl = [
      line({ type: 'item.completed', item: { type: 'file_change' } }),
      line({ type: 'item.completed', item: { type: 'file_change', changes: [] } }),
      line({ type: 'item.completed', item: { type: 'file_change', changes: [{}, { path: 'ok.ts' }] } }),
    ].join('\n');

    const out = parse(jsonl);
    expect(out.filesModified).toEqual(['ok.ts']);
  });

  test('items without an item payload are ignored', () => {
    const out = parse(line({ type: 'item.completed' }));
    expect(out.filesModified).toEqual([]);
  });
});
