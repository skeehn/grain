import { describe, expect, test } from 'bun:test';
import { formatEngramStats, formatEngramStatus } from '../src/tools/engram.js';

describe('Engram terminal presentation', () => {
  test('turns transport JSON into a scannable capability summary', () => {
    const output = formatEngramStatus(JSON.stringify({
      available: true, degraded: true, transport: 'legacy-http', reason: 'Legacy API',
      capabilities: { apiVersion: 'legacy', searchModes: ['hybrid'], supportsGovernance: false,
        supportsIndexStatus: false, supportsIndexRebuild: false, supportsExport: false },
    }));
    expect(output).toContain('✓ Connected  legacy-http  API legacy');
    expect(output).toContain('Governance unavailable');
    expect(output).toContain('! Legacy API');
    expect(output).not.toContain('{');
  });

  test('makes index divergence explicit without hiding counts', () => {
    const output = formatEngramStats('Nodes: 200\nEdges: 4\nFTS docs: 210\nVectors: 210');
    expect(output).toContain('Nodes: 200');
    expect(output).toContain('! Counts diverge: 200 nodes · 210 FTS · 210 vectors');
  });

  test('marks matching index counts as healthy', () => {
    expect(formatEngramStats('Nodes: 2\nFTS docs: 2\nVectors: 2')).toEndWith('✓ Index counts agree');
  });
});
