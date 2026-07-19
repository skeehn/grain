import { describe, expect, test } from 'bun:test';
import { RunJournal, listRuns } from '../src/kernel/index.js';

describe('run ordering regression', () => {
  test('latest run is chronological rather than lexicographic by UUID', () => {
    RunJournal.create({ run_id: 'z-older', task: 'older', cwd: '/tmp', provider: 'test', model: 'test', policy_profile: 'default' });
    const start = Date.now();
    while (Date.now() === start) { /* ensure distinct persisted timestamps */ }
    RunJournal.create({ run_id: 'a-newer', task: 'newer', cwd: '/tmp', provider: 'test', model: 'test', policy_profile: 'default' });

    expect(listRuns().slice(-2)).toEqual(['z-older', 'a-newer']);
    expect(listRuns().at(-1)).toBe('a-newer');
  });
});
