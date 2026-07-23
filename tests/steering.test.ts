import { describe, expect, test } from 'bun:test';
import { combineSteering } from '../src/agent/loop.js';
import { takeQueuedFollowUp } from '../src/tui/app.js';

describe('queued steering', () => {
  test('preserves order and removes empty terminal submissions', () => {
    expect(combineSteering([' focus tests ', '', 'then check the diff'])).toBe('focus tests\n\nthen check the diff');
  });

  test('returns undefined when there is no actionable steering', () => {
    expect(combineSteering([' ', '\n'])).toBeUndefined();
  });

  test('retains ordered follow-up work when a run ends before consuming it', () => {
    const queue = ['first follow-up', 'second follow-up'];
    expect(takeQueuedFollowUp(queue)).toBe('first follow-up');
    expect(queue).toEqual(['second follow-up']);
  });
});
