import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { LearningLedger, migrateLearningLedgerToEngram } from '../src/learning/index.js';
import { resetEngramClient } from '../src/engram/index.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; resetEngramClient(); });

describe('learning ledger migration', () => {
  test('imports with stable idempotency and resumes without deleting the ledger', async () => {
    const ledger = new LearningLedger(join(process.env.GRAIN_HOME!, `learning-${randomUUID()}.jsonl`));
    const entry = ledger.propose('procedure', 'Always verify the active diff', 'source-run', ['verification']);
    let writes = 0; const keys: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/health')) return new Response('ok');
      if (url.endsWith('/capabilities')) return Response.json({ api_version: 'v1' });
      writes++; keys.push(new Headers(init?.headers).get('idempotency-key') || '');
      const body = JSON.parse(String(init?.body));
      return Response.json({ memory: { ...body, id: `memory-${writes}`, content_hash: 'hash', created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(), retrieval_count: 0 } });
    }) as typeof fetch;
    resetEngramClient();
    const scope = `/repo/${randomUUID()}`;
    const first = await migrateLearningLedgerToEngram(scope, ledger);
    const second = await migrateLearningLedgerToEngram(scope, ledger);
    expect(first.imported).toContain(entry.id); expect(second.imported).toContain(entry.id);
    expect(writes).toBe(1); expect(keys).toEqual([`grain-learning:${entry.id}`]);
    expect(existsSync(ledger.path)).toBe(true);
  });
});
