import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
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

  test('serializes concurrent writers without dropping jobs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'grain-schedules-concurrent-'));
    const modulePath = join(import.meta.dir, '../src/schedules/store.ts');
    const writers = Array.from({ length: 8 }, (_, index) => Bun.spawn([
      process.execPath, '-e',
      `const {ScheduleStore}=await import(${JSON.stringify(modulePath)});new ScheduleStore(${JSON.stringify(home)}).add({name:'job-${index}',cron:'@hourly',prompt:'run',workspace:'/repo'})`,
    ]));
    expect(await Promise.all(writers.map(writer => writer.exited))).toEqual(Array(8).fill(0));
    expect(new ScheduleStore(home).list()).toHaveLength(8);
  });

  test('fails closed instead of replacing a corrupt schedule store', () => {
    const home = mkdtempSync(join(tmpdir(), 'grain-schedules-corrupt-'));
    writeFileSync(join(home, 'schedules.json'), '{broken');
    const store = new ScheduleStore(home);
    expect(() => store.list()).toThrow('Schedule store is corrupt');
    expect(() => store.add({ name: 'new', cron: '@daily', prompt: 'run', workspace: '/repo' })).toThrow('Schedule store is corrupt');
  });
});
