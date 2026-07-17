import { describe, test, expect } from 'bun:test';
import { getChildTools, TOOLS } from '../src/tools/index.js';

describe('delegate child tool set', () => {
  test('children cannot delegate or spawn (no unbounded recursion)', () => {
    const names = getChildTools().map(t => t.name);
    expect(names).not.toContain('delegate');
    expect(names).not.toContain('spawn_agent');
  });

  test('children still get the real work tools', () => {
    const names = getChildTools().map(t => t.name);
    for (const essential of ['read', 'write', 'bash', 'grep', 'finish']) {
      expect(names).toContain(essential);
    }
    // parent set minus the delegation/orchestration tools children can't use
    expect(names).not.toContain('run_agents');
    expect(getChildTools().length).toBe(TOOLS.length - 3);
  });
});
