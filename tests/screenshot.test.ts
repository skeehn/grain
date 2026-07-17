import { describe, test, expect } from 'bun:test';
import { screenshotTool, drainPendingScreenshots, hasPendingScreenshots } from '../src/tools/screenshot.js';

// Chrome isn't guaranteed in CI, so these cover the deterministic paths that
// return before launching a browser. The capture→queue→attach path is verified
// end-to-end manually (see PR description).
describe('screenshot tool', () => {
  test('rejects a non-URL input before touching Chrome', async () => {
    const r = await screenshotTool.execute({ url: 'not-a-url' });
    expect(r.is_error).toBe(true);
    expect(r.content).toContain('http');
  });

  test('rejects an empty url', async () => {
    const r = await screenshotTool.execute({ url: '' } as any);
    expect(r.is_error).toBe(true);
  });

  test('the pending-screenshot queue drains and empties', () => {
    drainPendingScreenshots(); // reset
    expect(hasPendingScreenshots()).toBe(false);
    expect(drainPendingScreenshots()).toEqual([]);
  });
});
