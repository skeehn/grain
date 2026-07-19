import { describe, expect, test } from 'bun:test';
import { packContext } from '../src/context/packer.js';
import { getModelCapabilities } from '../src/context/capabilities.js';
import type { Tool } from '../src/providers/types.js';

const schema = { type: 'object' as const, properties: {} };

describe('MCP model-context regression', () => {
  test('allowlisted MCP tools survive provider preferred-tool filtering', () => {
    const tools: Tool[] = [
      { name: 'read', description: 'read', input_schema: schema },
      { name: 'unpreferred_builtin', description: 'omit', input_schema: schema },
      { name: 'mcp__computer-use__computer', description: 'desktop control', input_schema: schema },
    ];

    const packed = packContext(getModelCapabilities('groq', 'openai/gpt-oss-120b'), [], tools);
    expect(packed.manifest.tools).toEqual(['read', 'mcp__computer-use__computer']);
  });
});
