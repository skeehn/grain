import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  workspace: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunId?: string;
  lastError?: string;
}

interface ScheduleFile { schemaVersion: 1; jobs: ScheduledJob[]; }

function schedulePath(): string {
  return join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'schedules.json');
}

function readStore(): ScheduleFile {
  const path = schedulePath();
  if (!existsSync(path)) return { schemaVersion: 1, jobs: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ScheduleFile;
    return parsed?.schemaVersion === 1 && Array.isArray(parsed.jobs) ? parsed : { schemaVersion: 1, jobs: [] };
  } catch { return { schemaVersion: 1, jobs: [] }; }
}

function writeStore(store: ScheduleFile): void {
  const path = schedulePath(); mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

const ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *',
};

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some(part => {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    let start = min; let end = max;
    if (range !== '*') {
      const bounds = range.split('-').map(Number);
      start = bounds[0]; end = bounds.length === 2 ? bounds[1] : bounds[0];
    }
    return Number.isInteger(start) && Number.isInteger(end) && start >= min && end <= max && start <= end
      && value >= start && value <= end && (value - start) % step === 0;
  });
}

export function normalizeCron(expression: string): string {
  const cron = ALIASES[expression.trim().toLowerCase()] || expression.trim();
  const fields = cron.split(/\s+/);
  if (fields.length !== 5) throw new Error('Cron must have five fields: minute hour day month weekday');
  const probes: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  fields.forEach((field, index) => {
    if (![probes[index][0], probes[index][1]].some(value => fieldMatches(field, value, ...probes[index]))) {
      // Check every value so expressions such as "7" do not fail because neither boundary matches.
      if (!Array.from({ length: probes[index][1] - probes[index][0] + 1 }, (_, offset) => probes[index][0] + offset)
        .some(value => fieldMatches(field, value, ...probes[index]))) throw new Error(`Invalid cron field: ${field}`);
    }
  });
  return fields.join(' ');
}

export function cronMatches(expression: string, date: Date): boolean {
  const [minute, hour, day, month, weekday] = normalizeCron(expression).split(' ');
  const dayOfMonth = fieldMatches(day, date.getDate(), 1, 31);
  const dayOfWeek = fieldMatches(weekday, date.getDay(), 0, 6);
  // Vixie cron treats day-of-month and day-of-week as OR when both are
  // restricted; when either starts with *, the other field controls.
  const calendarDay = day.startsWith('*') ? dayOfWeek : weekday.startsWith('*') ? dayOfMonth : dayOfMonth || dayOfWeek;
  return fieldMatches(minute, date.getMinutes(), 0, 59)
    && fieldMatches(hour, date.getHours(), 0, 23)
    && fieldMatches(month, date.getMonth() + 1, 1, 12)
    && calendarDay;
}

export class ScheduleStore {
  list(): ScheduledJob[] { return readStore().jobs.sort((a, b) => a.name.localeCompare(b.name)); }

  add(input: { name: string; cron: string; prompt: string; workspace: string }): ScheduledJob {
    if (!input.name.trim() || !input.prompt.trim() || !input.workspace.trim()) throw new Error('Job name, prompt, and workspace are required');
    const store = readStore();
    if (store.jobs.some(job => job.name === input.name.trim())) throw new Error(`Scheduled job already exists: ${input.name.trim()}`);
    const now = new Date().toISOString();
    const job: ScheduledJob = { id: randomUUID(), name: input.name.trim(), cron: normalizeCron(input.cron), prompt: input.prompt.trim(),
      workspace: input.workspace, enabled: true, createdAt: now, updatedAt: now };
    store.jobs.push(job); writeStore(store); return job;
  }

  remove(idOrName: string): boolean {
    const store = readStore(); const before = store.jobs.length;
    store.jobs = store.jobs.filter(job => job.id !== idOrName && job.name !== idOrName);
    if (store.jobs.length !== before) writeStore(store);
    return store.jobs.length !== before;
  }

  setEnabled(idOrName: string, enabled: boolean): ScheduledJob {
    return this.update(idOrName, job => { job.enabled = enabled; });
  }

  markRun(id: string, result: { runId?: string; error?: string }, at = new Date()): ScheduledJob {
    return this.update(id, job => { job.lastRunAt = at.toISOString(); job.lastRunId = result.runId; job.lastError = result.error; });
  }

  due(at = new Date()): ScheduledJob[] {
    const minute = at.toISOString().slice(0, 16);
    return this.list().filter(job => job.enabled && cronMatches(job.cron, at) && job.lastRunAt?.slice(0, 16) !== minute);
  }

  private update(idOrName: string, mutate: (job: ScheduledJob) => void): ScheduledJob {
    const store = readStore(); const job = store.jobs.find(item => item.id === idOrName || item.name === idOrName);
    if (!job) throw new Error(`Unknown scheduled job: ${idOrName}`);
    mutate(job); job.updatedAt = new Date().toISOString(); writeStore(store); return job;
  }
}
