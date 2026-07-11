import { describe, expect, test } from 'bun:test';
import { parseDashboardKey } from '../src/orchestration/dashboard.js';

describe('agent-aware TUI controls', () => {
  test('maps navigation, cancellation, refresh, and quit deterministically', () => {
    expect(parseDashboardKey('j')).toEqual({ type: 'move', delta: 1 });
    expect(parseDashboardKey('\u001b[A')).toEqual({ type: 'move', delta: -1 });
    expect(parseDashboardKey('c')).toEqual({ type: 'cancel' });
    expect(parseDashboardKey('r')).toEqual({ type: 'refresh' });
    expect(parseDashboardKey('q')).toEqual({ type: 'quit' });
    expect(parseDashboardKey('x')).toBeUndefined();
  });
});
