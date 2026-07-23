import { randomUUID } from 'crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
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
  timezone: string;
  misfirePolicy: 'skip' | 'run_once';
  maxRetries: number;
  retryBackoffMs: number;
  runRetentionDays: number;
  secretsPolicy: 'provider_only' | 'inherit';
  leaseOwner?: string;
  leaseUntil?: string;
}

interface ScheduleFile { schemaVersion: 2; jobs: ScheduledJob[]; }

function normalizeJob(job: Partial<ScheduledJob>): ScheduledJob {
  return { ...job, timezone: job.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    misfirePolicy: job.misfirePolicy || 'skip', maxRetries: job.maxRetries ?? 2,
    retryBackoffMs: job.retryBackoffMs ?? 5_000, runRetentionDays: job.runRetentionDays ?? 30,
    secretsPolicy: job.secretsPolicy || 'provider_only' } as ScheduledJob;
}

function defaultScheduleHome(): string {
  return process.env.GRAIN_HOME || join(homedir(), '.grain');
}

function readStore(path: string): ScheduleFile {
  if (!existsSync(path)) return { schemaVersion: 2, jobs: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { schemaVersion?: number; jobs?: Array<Partial<ScheduledJob>> };
    if ((parsed?.schemaVersion === 1 || parsed?.schemaVersion === 2) && Array.isArray(parsed.jobs)) {
      return { schemaVersion: 2, jobs: parsed.jobs.map(normalizeJob) };
    }
    throw new Error('unsupported schema');
  } catch (error: any) {
    throw new Error(`Schedule store is corrupt: ${path} (${error?.message || error})`);
  }
}

function writeStore(path: string, store: ScheduleFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(store, null, 2)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, path);
}

function withStoreLock<T>(path: string, operation: () => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`; const deadline = Date.now() + 5_000;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try { descriptor = openSync(lock, 'wx', 0o600); }
    catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > 30_000) unlinkSync(lock); } catch {}
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for schedule store lock: ${path}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return operation(); }
  finally { closeSync(descriptor); try { unlinkSync(lock); } catch {} }
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

function cronMatchesParts(expression: string, parts: { minute: number; hour: number; day: number; month: number; weekday: number }): boolean {
  const [minute, hour, day, month, weekday] = normalizeCron(expression).split(' ');
  const dayOfMonth = fieldMatches(day, parts.day, 1, 31);
  const dayOfWeek = fieldMatches(weekday, parts.weekday, 0, 6);
  // Vixie cron treats day-of-month and day-of-week as OR when both are
  // restricted; when either starts with *, the other field controls.
  const calendarDay = day.startsWith('*') ? dayOfWeek : weekday.startsWith('*') ? dayOfMonth : dayOfMonth || dayOfWeek;
  return fieldMatches(minute, parts.minute, 0, 59)
    && fieldMatches(hour, parts.hour, 0, 23)
    && fieldMatches(month, parts.month, 1, 12)
    && calendarDay;
}

export function cronMatches(expression: string, date: Date, timezone?: string): boolean {
  if (!timezone) return cronMatchesParts(expression, { minute: date.getMinutes(), hour: date.getHours(), day: date.getDate(), month: date.getMonth() + 1, weekday: date.getDay() });
  const values: Record<string, number> = {};
  try {
    for (const part of new Intl.DateTimeFormat('en-US', { timeZone: timezone, minute: 'numeric', hour: 'numeric', hourCycle: 'h23',
      day: 'numeric', month: 'numeric', weekday: 'short' }).formatToParts(date)) {
      if (part.type !== 'literal') values[part.type] = part.type === 'weekday'
        ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part.value) : Number(part.value);
    }
  } catch { throw new Error(`Invalid timezone: ${timezone}`); }
  return cronMatchesParts(expression, { minute: values.minute, hour: values.hour, day: values.day, month: values.month, weekday: values.weekday });
}

export class ScheduleStore {
  private readonly path: string;

  constructor(home = defaultScheduleHome()) { this.path = join(home, 'schedules.json'); }

  list(): ScheduledJob[] { return readStore(this.path).jobs.sort((a, b) => a.name.localeCompare(b.name)); }

  add(input: { name: string; cron: string; prompt: string; workspace: string; timezone?: string }): ScheduledJob {
    if (!input.name.trim() || !input.prompt.trim() || !input.workspace.trim()) throw new Error('Job name, prompt, and workspace are required');
    return withStoreLock(this.path, () => {
      const store = readStore(this.path);
      if (store.jobs.some(job => job.name === input.name.trim())) throw new Error(`Scheduled job already exists: ${input.name.trim()}`);
      const now = new Date().toISOString();
      if (input.timezone) cronMatches('* * * * *', new Date(), input.timezone);
      const job = normalizeJob({ id: randomUUID(), name: input.name.trim(), cron: normalizeCron(input.cron), prompt: input.prompt.trim(),
        workspace: input.workspace, enabled: true, createdAt: now, updatedAt: now, timezone: input.timezone });
      store.jobs.push(job); writeStore(this.path, store); return job;
    });
  }

  remove(idOrName: string): boolean {
    return withStoreLock(this.path, () => {
      const store = readStore(this.path); const before = store.jobs.length;
      store.jobs = store.jobs.filter(job => job.id !== idOrName && job.name !== idOrName);
      if (store.jobs.length !== before) writeStore(this.path, store);
      return store.jobs.length !== before;
    });
  }

  setEnabled(idOrName: string, enabled: boolean): ScheduledJob {
    return this.update(idOrName, job => { job.enabled = enabled; });
  }

  markRun(id: string, result: { runId?: string; error?: string }, at = new Date()): ScheduledJob {
    return this.update(id, job => { job.lastRunAt = at.toISOString(); job.lastRunId = result.runId; job.lastError = result.error;
      job.leaseOwner = undefined; job.leaseUntil = undefined; });
  }

  due(at = new Date()): ScheduledJob[] {
    const minute = at.toISOString().slice(0, 16);
    return this.list().filter(job => job.enabled && cronMatches(job.cron, at, job.timezone) && job.lastRunAt?.slice(0, 16) !== minute
      && (!job.leaseUntil || Date.parse(job.leaseUntil) <= at.getTime()));
  }

  /** Atomically lease due work so concurrent schedulers cannot execute it twice. */
  claimDue(owner: string, at = new Date(), limit = 1, leaseMs = 15 * 60_000): ScheduledJob[] {
    if (!owner.trim()) throw new Error('Schedule lease owner is required');
    return withStoreLock(this.path, () => {
      const store = readStore(this.path); const minute = at.toISOString().slice(0, 16); const claimed: ScheduledJob[] = [];
      for (const job of store.jobs) {
        if (claimed.length >= Math.max(1, limit)) break;
        const leaseExpired = !job.leaseUntil || Date.parse(job.leaseUntil) <= at.getTime();
        if (job.enabled && leaseExpired && cronMatches(job.cron, at, job.timezone) && job.lastRunAt?.slice(0, 16) !== minute) {
          job.leaseOwner = owner; job.leaseUntil = new Date(at.getTime() + leaseMs).toISOString(); job.updatedAt = new Date().toISOString();
          claimed.push({ ...job });
        }
      }
      if (claimed.length) writeStore(this.path, store);
      return claimed;
    });
  }

  private update(idOrName: string, mutate: (job: ScheduledJob) => void): ScheduledJob {
    return withStoreLock(this.path, () => {
      const store = readStore(this.path); const job = store.jobs.find(item => item.id === idOrName || item.name === idOrName);
      if (!job) throw new Error(`Unknown scheduled job: ${idOrName}`);
      mutate(job); job.updatedAt = new Date().toISOString(); writeStore(this.path, store); return job;
    });
  }
}
