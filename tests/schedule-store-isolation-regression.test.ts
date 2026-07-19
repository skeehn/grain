import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ScheduleStore } from '../src/schedules/index.js';

describe('schedule store isolation regression', () => {
  test('independent stores do not mutate process-wide GRAIN_HOME', () => {
    const originalHome = process.env.GRAIN_HOME;
    const first = new ScheduleStore(mkdtempSync(join(tmpdir(), 'grain-schedule-a-')));
    const second = new ScheduleStore(mkdtempSync(join(tmpdir(), 'grain-schedule-b-')));
    first.add({ name: 'same-name', cron: '@daily', prompt: 'first', workspace: '/tmp/first' });
    second.add({ name: 'same-name', cron: '@daily', prompt: 'second', workspace: '/tmp/second' });

    expect(first.list()[0].prompt).toBe('first');
    expect(second.list()[0].prompt).toBe('second');
    expect(process.env.GRAIN_HOME).toBe(originalHome);
  });
});
