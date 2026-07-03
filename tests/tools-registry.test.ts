import { describe, test, expect } from 'bun:test';
import { TOOLS, executeTool } from '../src/tools/index.js';

describe('tool registry', () => {
  test('every registered tool has a unique name', () => {
    const names = TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every tool declares a JSON schema object', () => {
    for (const tool of TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.input_schema.type).toBe('object');
    }
  });

  test('executeTool returns an error result for unknown tools', async () => {
    const res = await executeTool('no_such_tool', {});
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('Unknown tool');
  });

  test('every declared tool has a wired executor (no "Unknown tool")', async () => {
    // Call each executor with obviously-invalid input; a missing executor
    // returns "Unknown tool", a wired one returns anything else.
    const skip = new Set(['bash', 'delegate', 'engram', 'spawn_agent', 'test_fix_loop', 'run_tests', 'git']); // spawn subprocesses / network
    for (const tool of TOOLS) {
      if (skip.has(tool.name)) continue;
      const res = await executeTool(tool.name, { path: '/nonexistent/definitely/missing' });
      expect(res.content).not.toContain('Unknown tool:');
    }
  });
});
