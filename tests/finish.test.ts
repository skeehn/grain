import { describe, expect, test } from 'bun:test';
import { executeFinish } from '../src/tools/finish.js';

describe('finish gate', () => {
  test('rejects completion without verification evidence', async () => {
    expect((await executeFinish({ result: 'done', evidence: [] })).is_error).toBe(true);
  });

  test('has no side effects and accepts evidence-backed completion', async () => {
    expect(await executeFinish({ result: 'done', evidence: ['bun test: 12 passed'] }))
      .toEqual({ content: 'TASK_COMPLETE: done' });
  });
});
