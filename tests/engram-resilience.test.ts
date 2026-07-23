import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeEngram, resetEngramTransportState } from '../src/tools/engram.js';
import { engramRetrieve } from '../src/agent/context.js';

const originalFetch = globalThis.fetch;
const originalBin = process.env.GRAIN_ENGRAM_BIN;
const originalHttp = process.env.GRAIN_ENGRAM_HTTP;

beforeEach(() => {
  resetEngramTransportState();
  process.env.GRAIN_ENGRAM_HTTP = 'http://memory.test';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBin === undefined) delete process.env.GRAIN_ENGRAM_BIN;
  else process.env.GRAIN_ENGRAM_BIN = originalBin;
  if (originalHttp === undefined) delete process.env.GRAIN_ENGRAM_HTTP;
  else process.env.GRAIN_ENGRAM_HTTP = originalHttp;
  resetEngramTransportState();
});

describe('Engram resilience', () => {
  test('re-probes HTTP after a transient startup miss', async () => {
    process.env.GRAIN_ENGRAM_BIN = join(tmpdir(), 'definitely-missing-engram');
    let online = false;
    globalThis.fetch = (async input => {
      const url = String(input);
      if (!online) throw new Error('server still starting');
      if (url.endsWith('/health')) return new Response('ok');
      return Response.json([{ id: 'n1', body: 'durable fact', score: 0.9, tags: [] }]);
    }) as typeof fetch;

    expect((await executeEngram({ action: 'search', query: 'fact' })).content).toContain('No results');
    online = true;
    await Bun.sleep(1_050);
    expect((await executeEngram({ action: 'search', query: 'fact' })).content).toContain('durable fact');
  });

  test('falls back to the configured CLI with project and result limits intact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grain-engram-cli-'));
    const bin = join(dir, 'engram');
    writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(bin, 0o755);
    process.env.GRAIN_ENGRAM_BIN = bin;
    globalThis.fetch = (async input => {
      if (String(input).endsWith('/health')) return new Response('ok');
      throw new Error('HTTP endpoint wedged');
    }) as typeof fetch;

    const result = await executeEngram({ action: 'search', query: 'needle', top_k: 7, project: '/repo/a' });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain('search\nneedle\n--top-k\n7\n--project\n/repo/a');
  });

  test('agent retrieval is project-scoped through the shared transport', async () => {
    process.env.GRAIN_ENGRAM_BIN = join(tmpdir(), 'definitely-missing-engram');
    const urls: string[] = [];
    globalThis.fetch = (async input => {
      const url = String(input); urls.push(url);
      if (url.endsWith('/health')) return new Response('ok');
      return Response.json([{ id: 'n1', body: 'project fact', score: 1, tags: [] }]);
    }) as typeof fetch;

    expect(await engramRetrieve('memory query', '/repo/a')).toContain('project fact');
    expect(urls.some(url => url.includes('project=%2Frepo%2Fa'))).toBe(true);
  });
});
