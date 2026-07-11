import { describe, expect, test } from 'bun:test';
import { summarizeTrials } from '../scripts/benchmark-report.js';

describe('benchmark report', () => {
  test('calculates pass, flake, and success-cost metrics without hiding failures', () => {
    const result = summarizeTrials([
      { harness: 'grain', model: 'm', task_id: 'a', trial: 1, passed: true, cost_usd: 1, duration_ms: 10 },
      { harness: 'grain', model: 'm', task_id: 'a', trial: 2, passed: false, cost_usd: 2, duration_ms: 20 },
      { harness: 'grain', model: 'm', task_id: 'b', trial: 1, passed: true, cost_usd: 3, duration_ms: 30 },
    ])[0];
    expect(result.pass_rate).toBeCloseTo(2 / 3);
    expect(result.flaky_rate).toBe(0.5);
    expect(result.total_cost_usd).toBe(6);
    expect(result.cost_per_success_usd).toBe(3);
  });
});
