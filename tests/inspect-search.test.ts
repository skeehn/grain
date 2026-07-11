import { describe, expect, test } from 'bun:test';
import { executeInspect } from '../src/tools/inspect.js';
import { executeSearch } from '../src/tools/search.js';
import { setToolCwd } from '../src/tools/index.js';

describe('consolidated inspect and search tools', () => {
  test('return range hashes and deterministic lexical evidence', async () => {
    setToolCwd(process.cwd());
    try {
      const inspected = await executeInspect({ kind: 'file', path: 'tests/fixtures/mcp-server.ts' });
      expect(inspected.content).toContain('sha256:');
      const searched = await executeSearch({ query: 'initialize', path: 'tests/fixtures' });
      expect(searched.content).toContain('tests/fixtures/mcp-server.ts:');
    } finally {
      // Compatibility tools still use a process-wide root. Restore the test
      // sandbox root so later suites remain confined to their temporary home.
      setToolCwd(process.env.GRAIN_HOME!);
    }
  });
});
