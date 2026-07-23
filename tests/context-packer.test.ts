import { describe, expect, test } from 'bun:test';
import { getModelCapabilities, packContext } from '../src/context/index.js';
import type { Tool } from '../src/providers/types.js';

const tools: Tool[] = ['read', 'grep', 'delegate', 'finish'].map(name => ({ name, description: name, input_schema: { type: 'object' } }));

describe('context engine', () => {
  test('uses model capabilities to limit tools and records omissions deterministically', () => {
    const caps = { ...getModelCapabilities('groq', 'qwen/qwen3-32b'), contextWindow: 1_600, maxOutputTokens: 512 };
    const result = packContext(caps, [
      { id: 'system', kind: 'instruction', content: 'required '.repeat(300), priority: 100, required: true },
      { id: 'memory', kind: 'memory', content: 'optional '.repeat(500), priority: 10 },
    ], tools);
    expect(result.tools.map(tool => tool.name)).toEqual(['read', 'grep', 'finish']);
    expect(result.manifest.selected.some(item => item.id === 'system')).toBe(true);
    expect(result.manifest.omitted.some(item => item.id === 'memory')).toBe(true);
    expect(result.manifest.estimatedInputTokens).toBeLessThanOrEqual(result.manifest.inputBudgetTokens);
    expect(result.manifest.schemaVersion).toBe(2);
    expect(result.manifest.selected.every(item => item.sourceHash?.length === 64)).toBe(true);
  });

  test('caps untrusted memory independently of required instructions', () => {
    const caps = { ...getModelCapabilities('groq', 'qwen/qwen3-32b'), contextWindow: 4_000, maxOutputTokens: 512 };
    const result = packContext(caps, [
      { id: 'system', kind: 'instruction', content: 'policy', priority: 100, required: true },
      { id: 'memory', kind: 'memory', content: 'memory '.repeat(600), priority: 80, untrusted: true },
    ], []);
    expect(result.manifest.selected.some(item => item.id === 'system')).toBe(true);
    expect(result.manifest.omitted.find(item => item.id === 'memory')?.reason).toBe('memory_allocation_exhausted');
    expect(result.manifest.allocation.memory).toBe(0);
  });
});
