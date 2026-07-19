import { describe, expect, test } from 'bun:test';
import { parseComposerInput } from '../src/workspace/app.js';

describe('scheduled-job composer regression', () => {
  test('cron aliases in slash commands are not stripped as attachments', () => {
    expect(parseComposerInput('/jobs add smoke @daily -- Read README')).toEqual({
      command: 'jobs',
      argument: 'add smoke @daily -- Read README',
      attachments: [],
    });
  });
});
