import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { LearningLedger } from '../src/learning/index.js';
import { randomUUID } from 'crypto';
import { appendFileSync } from 'fs';

describe('verified learning ledger', () => {
  test('requires two independent passing runs before promotion', () => {
    const ledger = new LearningLedger(join(process.env.GRAIN_HOME!, `learning-${randomUUID()}.jsonl`));
    const entry = ledger.propose('procedure', 'Run focused tests before the full suite', 'run-a');
    expect(() => ledger.promote(entry.id)).toThrow();
    expect(() => ledger.validate(entry.id, { runId: 'run-a', verifier: 'tests', outcome: 'passed' })).toThrow();
    expect(ledger.validate(entry.id, { runId: 'run-b', verifier: 'bun-test', outcome: 'passed' }).status).toBe('evaluated');
    expect(() => ledger.promote(entry.id)).toThrow('two independent');
    expect(ledger.validate(entry.id, { runId: 'run-c', verifier: 'integration-test', outcome: 'passed' }).status).toBe('validated');
    expect(ledger.promote(entry.id).status).toBe('promoted');
  });

  test('high-risk procedures cannot auto-promote without user review', () => {
    const ledger = new LearningLedger(join(process.env.GRAIN_HOME!, `learning-${randomUUID()}.jsonl`));
    const entry = ledger.propose('procedure', 'Install a global executable script', 'run-a');
    ledger.validate(entry.id, { runId: 'run-b', verifier: 'test', outcome: 'passed' });
    ledger.validate(entry.id, { runId: 'run-c', verifier: 'test', outcome: 'passed' });
    expect(() => ledger.promote(entry.id)).toThrow('user review');
    expect(ledger.promote(entry.id, { userReviewed: true }).status).toBe('promoted');
  });

  test('deduplicates active candidate statements', () => {
    const ledger = new LearningLedger(join(process.env.GRAIN_HOME!, `learning-${randomUUID()}.jsonl`));
    const first = ledger.propose('fact', 'The repository uses Bun', 'run-a');
    expect(ledger.propose('fact', ' the repository uses bun ', 'run-b').id).toBe(first.id);
  });

  test('isolates malformed and dangling events without losing valid learnings', () => {
    const ledger = new LearningLedger(join(process.env.GRAIN_HOME!, `learning-${randomUUID()}.jsonl`));
    const first = ledger.propose('procedure', 'Keep valid learning one', 'run-a');
    appendFileSync(ledger.path, '{broken\n');
    appendFileSync(ledger.path, `${JSON.stringify({ type: 'promoted', id: 'missing-entry' })}\n`);
    const second = ledger.propose('procedure', 'Keep valid learning two', 'run-b');
    expect(ledger.list().map(entry => entry.id)).toEqual([first.id, second.id]);
  });
});
