import { describe, expect, test } from 'bun:test';
import { localEngramCheck } from '../src/commands/doctor.js';

describe('Grain doctor Engram integrity', () => {
  test('passes when node and index counts agree', async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith('/health')
        ? new Response('ok')
        : Response.json({ nodes: 12, fts_docs: 12, vectors: 12 });
    }) as typeof fetch;
    expect(await localEngramCheck(fetcher)).toEqual({
      id: 'engram', status: 'pass', summary: 'local memory daemon is ready',
    });
  });

  test('warns when legacy indexes contain a different number of records', async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith('/health')
        ? new Response('ok')
        : Response.json({ nodes: 200, fts_docs: 210, vectors: 210 });
    }) as typeof fetch;
    const result = await localEngramCheck(fetcher);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('nodes 200, FTS 210, vectors 210');
    expect(result.detail).toContain('Back up the store');
  });

  test('keeps a healthy legacy server usable but warns when stats are unavailable', async () => {
    const fetcher = (async (input: string | URL | Request) => {
      return String(input).endsWith('/health') ? new Response('ok') : new Response('', { status: 404 });
    }) as typeof fetch;
    const result = await localEngramCheck(fetcher);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('index stats returned HTTP 404');
  });
});
