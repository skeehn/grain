import { readFileSync } from 'fs';

export interface TrialResult {
  harness: string;
  model: string;
  task_id: string;
  trial: number;
  passed: boolean;
  cost_usd: number;
  duration_ms: number;
}

export interface HarborEvaluation {
  n_trials: number;
  n_errors: number;
  metrics?: Array<{ mean?: number }>;
  exception_stats?: Record<string, string[]>;
}

export interface HarborJobResult {
  id?: string;
  finished_at?: string | null;
  n_total_trials: number;
  stats: {
    n_completed_trials: number;
    n_errored_trials: number;
    n_running_trials: number;
    n_pending_trials: number;
    n_cancelled_trials: number;
    n_retries?: number;
    evals: Record<string, HarborEvaluation>;
  };
}

export interface HarborVerification {
  ok: boolean;
  job_id: string | null;
  total_trials: number;
  evaluated_trials: number;
  minimum_mean_reward: number | null;
  errors: string[];
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Harbor's CLI can exit zero even when individual trials fail. Treat its
 * result.json as the release authority and fail closed on malformed or
 * incomplete results.
 */
export function verifyHarborResult(input: unknown, minimumReward = 1): HarborVerification {
  const errors: string[] = [];
  const root = input && typeof input === 'object' ? input as Partial<HarborJobResult> : {};
  const stats = root.stats && typeof root.stats === 'object' ? root.stats : undefined;
  const total = root.n_total_trials;

  if (!finiteNonNegative(total) || total === 0) errors.push('n_total_trials must be a positive number');
  if (!stats) errors.push('stats is missing');

  const completed = stats?.n_completed_trials;
  const errored = stats?.n_errored_trials;
  const running = stats?.n_running_trials;
  const pending = stats?.n_pending_trials;
  const cancelled = stats?.n_cancelled_trials;

  for (const [name, value] of Object.entries({ completed, errored, running, pending, cancelled })) {
    if (!finiteNonNegative(value)) errors.push(`stats.n_${name}_trials must be a non-negative number`);
  }
  if (finiteNonNegative(total) && finiteNonNegative(completed) && completed !== total) {
    errors.push(`completed trials ${completed} do not match total trials ${total}`);
  }
  if (finiteNonNegative(errored) && errored > 0) errors.push(`${errored} trial(s) errored`);
  if (finiteNonNegative(running) && running > 0) errors.push(`${running} trial(s) still running`);
  if (finiteNonNegative(pending) && pending > 0) errors.push(`${pending} trial(s) still pending`);
  if (finiteNonNegative(cancelled) && cancelled > 0) errors.push(`${cancelled} trial(s) cancelled`);
  if (!root.finished_at) errors.push('job has no finished_at timestamp');

  const evals = stats?.evals && typeof stats.evals === 'object' ? stats.evals : {};
  const entries = Object.entries(evals);
  if (entries.length === 0) errors.push('no evaluation results were recorded');

  let evaluatedTrials = 0;
  const means: number[] = [];
  for (const [name, evaluation] of entries) {
    if (!evaluation || typeof evaluation !== 'object') {
      errors.push(`evaluation ${name} is malformed`);
      continue;
    }
    if (!finiteNonNegative(evaluation.n_trials)) errors.push(`evaluation ${name} has invalid n_trials`);
    else evaluatedTrials += evaluation.n_trials;
    if (!finiteNonNegative(evaluation.n_errors)) errors.push(`evaluation ${name} has invalid n_errors`);
    else if (evaluation.n_errors > 0) errors.push(`evaluation ${name} has ${evaluation.n_errors} error(s)`);

    const exceptions = Object.entries(evaluation.exception_stats ?? {})
      .filter(([, trials]) => Array.isArray(trials) && trials.length > 0);
    for (const [type, trials] of exceptions) {
      errors.push(`evaluation ${name} recorded ${trials.length} ${type} exception(s)`);
    }

    const metricMeans = (evaluation.metrics ?? [])
      .map(metric => metric?.mean)
      .filter((mean): mean is number => typeof mean === 'number' && Number.isFinite(mean));
    if (metricMeans.length === 0) errors.push(`evaluation ${name} has no finite mean reward`);
    for (const mean of metricMeans) {
      means.push(mean);
      if (mean < minimumReward) errors.push(`evaluation ${name} mean reward ${mean} is below ${minimumReward}`);
    }
  }
  if (finiteNonNegative(total) && evaluatedTrials !== total) {
    errors.push(`evaluated trials ${evaluatedTrials} do not match total trials ${total}`);
  }

  return {
    ok: errors.length === 0,
    job_id: typeof root.id === 'string' ? root.id : null,
    total_trials: finiteNonNegative(total) ? total : 0,
    evaluated_trials: evaluatedTrials,
    minimum_mean_reward: means.length ? Math.min(...means) : null,
    errors,
  };
}

export function summarizeTrials(rows: TrialResult[]) {
  const groups = new Map<string, TrialResult[]>();
  for (const row of rows) {
    const key = `${row.harness}\0${row.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return [...groups].map(([key, trials]) => {
    const [harness, model] = key.split('\0');
    const byTask = new Map<string, TrialResult[]>();
    for (const trial of trials) {
      if (!byTask.has(trial.task_id)) byTask.set(trial.task_id, []);
      byTask.get(trial.task_id)!.push(trial);
    }
    const flaky = [...byTask.values()].filter(task => new Set(task.map(row => row.passed)).size > 1).length;
    const passed = trials.filter(row => row.passed);
    const sortedCost = passed.map(row => row.cost_usd).sort((a, b) => a - b);
    const median = sortedCost.length ? sortedCost[Math.floor(sortedCost.length / 2)] : null;
    return { harness, model, trials: trials.length, tasks: byTask.size,
      pass_rate: trials.length ? passed.length / trials.length : 0,
      flaky_tasks: flaky, flaky_rate: byTask.size ? flaky / byTask.size : 0,
      total_cost_usd: trials.reduce((sum, row) => sum + row.cost_usd, 0),
      cost_per_success_usd: passed.length ? trials.reduce((sum, row) => sum + row.cost_usd, 0) / passed.length : null,
      median_success_cost_usd: median,
      median_duration_ms: trials.length ? trials.map(row => row.duration_ms).sort((a, b) => a - b)[Math.floor(trials.length / 2)] : null };
  });
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: bun scripts/benchmark-report.ts <trials-or-harbor-result.json> [--min-reward N]');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (Array.isArray(parsed)) {
    console.log(JSON.stringify(summarizeTrials(parsed as TrialResult[]), null, 2));
  } else {
    const flagIndex = process.argv.indexOf('--min-reward');
    const minimumReward = flagIndex >= 0 ? Number(process.argv[flagIndex + 1]) : 1;
    if (!Number.isFinite(minimumReward)) throw new Error('--min-reward must be a finite number');
    const verification = verifyHarborResult(parsed, minimumReward);
    console.log(JSON.stringify(verification, null, 2));
    if (!verification.ok) process.exitCode = 1;
  }
}
