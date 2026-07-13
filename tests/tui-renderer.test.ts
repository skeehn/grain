import { describe, expect, test } from 'bun:test';
import { bayerDither, formatAgentDashboard, formatContextBudget, orderedDither } from '../src/tui/renderer.js';

describe('ordered Bayer dither', () => {
  test('is deterministic and preserves requested cell width', () => {
    expect(orderedDither(8, 0, 8)).toBe('█░█░█░█░');
    expect([...orderedDither(31, 3, 11)]).toHaveLength(31);
  });

  test('uses only bitmap-safe terminal glyphs', () => {
    expect(orderedDither(64, 2, 9)).toMatch(/^[█░]+$/);
  });
});

test('agent dashboard exposes state, dependencies, leases, and mailbox without ANSI requirements', () => {
  const graph: any = { id: 'graph-1', mode: 'pair', tasks: [{ id: 'a', role: 'driver', state: 'running', objective: 'implement',
    dependencies: [], attempts: 1, authority: { write: true }, lease: { owner: 'worker-1', heartbeatAt: 'now' } }] };
  const rendered = formatAgentDashboard(graph, [{ id: 'm', graphId: 'graph-1', from: 'parent', to: 'a', kind: 'steering', payload: {}, createdAt: 'now' } as any]);
  expect(rendered).toContain('AGENT GRAPH'); expect(rendered).toContain('worker-1'); expect(rendered).toContain('1 pending');
});

test('8x8 Bayer motion is deterministic, bounded, and phase-sensitive', () => {
  expect(bayerDither(16, 0, 32)).toHaveLength(16);
  expect(bayerDither(16, 0, 32)).toMatch(/^[█░]+$/);
  expect(bayerDither(16, 0, 20)).not.toBe(bayerDither(16, 3, 20));
});

test('context budget view exposes token allocation and selected tools', () => {
  const rendered = formatContextBudget({ schemaVersion: 1, provider: 'groq', model: 'qwen', contextWindow: 100,
    reservedOutputTokens: 20, inputBudgetTokens: 80, estimatedInputTokens: 40,
    selected: [{ id: 's', kind: 'instruction', content: '', priority: 1, estimatedTokens: 40, truncated: false }], omitted: [], tools: ['read'] });
  expect(rendered).toContain('40/80'); expect(rendered).toContain('read');
});
