import { describe, expect, test } from 'bun:test';
import { executeTool, registerDynamicTool } from '../src/tools/index.js';

const tool = {
  name: 'mcp__lifecycle-regression__echo',
  description: 'lifecycle fixture',
  input_schema: { type: 'object' as const, properties: {} },
};

describe('dynamic tool lifecycle regression', () => {
  test('re-registration replaces an executor whose MCP client was closed', async () => {
    registerDynamicTool(tool, async () => ({ content: 'stale-client' }));
    expect((await executeTool(tool.name, {})).content).toBe('stale-client');

    registerDynamicTool(tool, async () => ({ content: 'reconnected-client' }));
    expect((await executeTool(tool.name, {})).content).toBe('reconnected-client');
  });
});
