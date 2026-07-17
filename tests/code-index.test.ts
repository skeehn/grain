import { describe, test, expect, beforeAll } from 'bun:test';
import { setCodeIndexRoot, buildIndex, codeDef, codeRefs, codeSearch } from '../src/tools/code-index.js';
import { join } from 'path';

// Index grain's own repo (this test file's repo root).
const REPO = join(import.meta.dir, '..');

describe('code index', () => {
  beforeAll(() => { setCodeIndexRoot(REPO); buildIndex(); });

  test('finds a known symbol definition at the right file', () => {
    const defs = codeDef('executeDelegate');
    expect(defs.length).toBeGreaterThan(0);
    expect(defs.some(d => d.file.endsWith('tools/delegate.ts'))).toBe(true);
    expect(defs[0].kind).toBe('function');
  });

  test('finds references to a symbol beyond its definition', () => {
    const refs = codeRefs('executeDelegate');
    // referenced from the registry executor map, not only defined
    expect(refs.some(r => r.file.endsWith('tools/index.ts'))).toBe(true);
  });

  test('ranked search surfaces relevant files for a natural query', () => {
    const hits = codeSearch('context compaction token budget');
    expect(hits.length).toBeGreaterThan(0);
    // the compaction logic should rank near the top
    expect(hits.slice(0, 8).some(h => h.file.includes('context'))).toBe(true);
  });

  test('symbol-name matches outrank incidental content mentions', () => {
    const hits = codeSearch('codeSearch');
    expect(hits[0].file).toContain('code-index'); // where codeSearch is defined
  });

  test('empty query returns nothing', () => {
    expect(codeSearch('')).toEqual([]);
  });
});
