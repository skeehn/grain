import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { LearningLedger } from '../src/learning/index.js';
import { randomUUID } from 'crypto';

describe('verified learning ledger', () => {
  test('requires independent passing evidence before promotion', () => {
    const ledger = new LearningLedger(join(process.env.GRAIN_HOME!, `learning-${randomUUID()}.jsonl`));
    const entry = ledger.propose('procedure', 'Run focused tests before the full suite', 'run-a');
    expect(() => ledger.promote(entry.id)).toThrow();
    expect(() => ledger.validate(entry.id, { runId: 'run-a', verifier: 'tests', outcome: 'passed' })).toThrow();
    ledger.validate(entry.id, { runId: 'run-b', verifier: 'bun-test', outcome: 'passed' });
    expect(ledger.promote(entry.id).status).toBe('promoted');
  });

  test('deduplicates active candidate statements', () => {
    const ledger = new LearningLedger(join(process.env.GRAIN_HOME!, `learning-${randomUUID()}.jsonl`));
    const first = ledger.propose('fact', 'The repository uses Bun', 'run-a');
    expect(ledger.propose('fact', ' the repository uses bun ', 'run-b').id).toBe(first.id);
  });
});
