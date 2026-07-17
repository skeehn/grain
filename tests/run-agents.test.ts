import { describe, test, expect, afterEach } from 'bun:test';
import { runAgentsTool } from '../src/tools/run-agents.js';

afterEach(() => { delete process.env.GRAIN_SUBAGENT; });

// These exercise the validation guards that return BEFORE any sub-agent spawns,
// so they're deterministic (no model / network). The full spawn→worktree→merge
// path is verified end-to-end manually (see PR description).
describe('run_agents guards', () => {
  test('refuses to nest inside a sub-agent', async () => {
    process.env.GRAIN_SUBAGENT = '1';
    const r = await runAgentsTool.execute({ tasks: [{ objective: 'x' }] });
    expect(r.is_error).toBe(true);
    expect(r.content).toContain('inside a sub-agent');
  });

  test('rejects an empty task list', async () => {
    const r = await runAgentsTool.execute({ tasks: [] });
    expect(r.is_error).toBe(true);
    expect(r.content).toContain('at least one task');
  });

  test('rejects more than 8 tasks', async () => {
    const tasks = Array.from({ length: 9 }, (_, i) => ({ objective: `t${i}` }));
    const r = await runAgentsTool.execute({ tasks });
    expect(r.is_error).toBe(true);
    expect(r.content).toContain('at most 8');
  });
});
