import { describe, expect, test } from 'bun:test';
import { blankFrame, detectTerminalCapabilities, diffFrames, graphemeWidth, layoutRun, projectRun, putText } from '../src/tui/index.js';

const capabilities = detectTerminalCapabilities({ columns: 100, rows: 24, isTTY: true, env: { TERM: 'xterm-256color', NO_COLOR: '1' } });

describe('differential TUI', () => {
  test('detects deterministic terminal fallbacks', () => {
    expect(capabilities.color).toBe('none'); expect(capabilities.columns).toBe(100); expect(capabilities.rows).toBe(24);
  });
  test('handles combining and wide graphemes without splitting cells', () => {
    expect(graphemeWidth('界')).toBe(2); expect(graphemeWidth('\u0301')).toBe(0);
    const frame = blankFrame(8, 2); expect(putText(frame, 0, 0, 'A界B')).toBe(4); expect(frame.cells[2].width).toBe(0);
  });
  test('emits only changed spans after the first frame', () => {
    const first = blankFrame(8, 2); putText(first, 0, 0, 'hello');
    const second = structuredClone(first); putText(second, 0, 1, 'a');
    const initial = diffFrames(undefined, first, capabilities); const patch = diffFrames(first, second, capabilities);
    expect(initial.length).toBeGreaterThan(patch.length); expect(patch).toContain('\x1b[1;2H'); expect(patch).not.toContain('hello');
  });
  test('projects journal events into responsive frames', () => {
    const events: any[] = [{ type: 'run_created', sequence: 1, payload: { run_id: 'r', task: 'repair auth', provider: 'openrouter', model: 'pool', created_at: new Date(0).toISOString() } },
      { type: 'status_changed', sequence: 2, payload: { status: 'running' } }, { type: 'model_requested', sequence: 3, payload: { context_manifest: { selected: [{}], estimatedInputTokens: 10, inputBudgetTokens: 100 } } }];
    const view = projectRun(events as any, 1000); const frame = layoutRun(view, capabilities);
    expect(view.run.status).toBe('running'); expect(frame.width).toBe(100); expect(frame.cells.map(cell => cell.grapheme).join('')).toContain('TIMELINE');
  });
});
