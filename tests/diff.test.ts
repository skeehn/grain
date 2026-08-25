import { describe, expect, test } from 'bun:test';
import { diffStats, unifiedDiff } from '../src/workspace/diff.js';

describe('unifiedDiff', () => {
  test('identical files produce an empty hunk list', () => {
    expect(unifiedDiff('a.ts', 'hello\n', 'hello\n')).toBe('--- a.ts\n+++ a.ts\n');
    expect(diffStats('hello\n', 'hello\n')).toEqual({ added: 0, removed: 0 });
  });

  test('inserts, deletes, and replacements use standard hunk headers', () => {
    const before = 'alpha\nbeta\ngamma\n';
    const after = 'alpha\nBETA\ngamma\ndelta\n';
    const diff = unifiedDiff('note.txt', before, after);
    expect(diff).toContain('--- note.txt');
    expect(diff).toContain('+++ note.txt');
    expect(diff).toContain('-beta');
    expect(diff).toContain('+BETA');
    expect(diff).toContain('+delta');
    expect(diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(diffStats(before, after)).toEqual({ added: 2, removed: 1 });
  });

  test('keeps surrounding context lines', () => {
    const before = ['keep', 'old', 'keep2'].join('\n');
    const after = ['keep', 'new', 'keep2'].join('\n');
    const diff = unifiedDiff('x.rs', before, after);
    expect(diff).toContain(' keep');
    expect(diff).toContain('-old');
    expect(diff).toContain('+new');
  });
});
