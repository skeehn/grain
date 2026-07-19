import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cronMatches, normalizeCron, ScheduleStore } from '../src/schedules/index.js';

describe('scheduled jobs', () => {
  test('normalizes aliases and matches five-field cron expressions', () => {
    expect(normalizeCron('@hourly')).toBe('0 * * * *');
    expect(cronMatches('*/15 9-17 * * 1-5', new Date('2026-07-20T13:30:00'))).toBe(true);
    expect(cronMatches('*/15 9-17 * * 1-5', new Date('2026-07-19T13:30:00'))).toBe(false);
    expect(cronMatches('0 9 1 * 1', new Date('2026-07-20T09:00:00'))).toBe(true); // Monday, even though not the first
    expect(() => normalizeCron('* * *')).toThrow();
  });

  test('persists jobs and returns each due job once per minute', () => {
    const store = new ScheduleStore(mkdtempSync(join(tmpdir(), 'grain-schedules-')));
    const job = store.add({ name: 'audit', cron: '* * * * *', prompt: 'audit the repo', workspace: '/tmp/repo' });
    const at = new Date('2026-07-20T13:30:10');
    expect(store.due(at).map(item => item.id)).toEqual([job.id]);
    store.markRun(job.id, { runId: 'run-1' }, at);
    expect(store.due(new Date('2026-07-20T13:30:50'))).toEqual([]);
    expect(store.due(new Date('2026-07-20T13:31:00'))).toHaveLength(1);
  });
});
