import { describe, expect, test } from 'bun:test';
import { summarizeTrials, verifyHarborResult } from '../scripts/benchmark-report.js';

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

describe('Harbor result verification', () => {
  const passing = {
    id: 'job-pass',
    finished_at: '2026-07-22T01:03:24Z',
    n_total_trials: 1,
    stats: {
      n_completed_trials: 1,
      n_errored_trials: 0,
      n_running_trials: 0,
      n_pending_trials: 0,
      n_cancelled_trials: 0,
      evals: {
        grain: { n_trials: 1, n_errors: 0, metrics: [{ mean: 1 }], exception_stats: {} },
      },
    },
  };

  test('accepts a finished independently verified job', () => {
    expect(verifyHarborResult(passing)).toEqual({
      ok: true,
      job_id: 'job-pass',
      total_trials: 1,
      evaluated_trials: 1,
      minimum_mean_reward: 1,
      errors: [],
    });
  });

  test('rejects Harbor exit-zero results containing trial exceptions', () => {
    const failed = structuredClone(passing);
    failed.id = 'job-error';
    failed.stats.n_errored_trials = 1;
    failed.stats.evals.grain.n_trials = 0;
    failed.stats.evals.grain.n_errors = 1;
    failed.stats.evals.grain.metrics = [{ mean: 0 }];
    failed.stats.evals.grain.exception_stats = { RuntimeError: ['trial-1'] };

    const result = verifyHarborResult(failed);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('1 trial(s) errored');
    expect(result.errors).toContain('evaluation grain recorded 1 RuntimeError exception(s)');
    expect(result.errors).toContain('evaluation grain mean reward 0 is below 1');
    expect(result.errors).toContain('evaluated trials 0 do not match total trials 1');
  });

  test('rejects unfinished, empty, or partial jobs', () => {
    const unfinished = structuredClone(passing);
    unfinished.finished_at = null;
    unfinished.stats.n_completed_trials = 0;
    unfinished.stats.n_running_trials = 1;
    unfinished.stats.evals = {} as typeof unfinished.stats.evals;
    const result = verifyHarborResult(unfinished);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('job has no finished_at timestamp');
    expect(result.errors).toContain('1 trial(s) still running');
    expect(result.errors).toContain('no evaluation results were recorded');
  });
});
