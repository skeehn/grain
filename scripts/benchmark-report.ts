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
  if (!path) throw new Error('Usage: bun scripts/benchmark-report.ts <trials.json>');
  const rows = JSON.parse(readFileSync(path, 'utf8')) as TrialResult[];
  console.log(JSON.stringify(summarizeTrials(rows), null, 2));
}
