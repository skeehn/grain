import { describe, test, expect } from 'bun:test';
import { newSessionStats, recordUsage, fmtTokens, fmtContext, statusLineText } from '../src/tui/status.js';

describe('status line', () => {
  test('fmtTokens humanizes counts', () => {
    expect(fmtTokens(942)).toBe('942');
    expect(fmtTokens(12_400)).toBe('12k');
    expect(fmtTokens(3_400)).toBe('3.4k');
    expect(fmtTokens(1_240_000)).toBe('1.24M');
  });

  test('recordUsage accumulates up/down and tracks last input', () => {
    const s = newSessionStats();
    recordUsage(s, { input_tokens: 1000, output_tokens: 200, cost_usd: 0.01 });
    recordUsage(s, { input_tokens: 1500, output_tokens: 300 });
    expect(s.upTokens).toBe(2500);
    expect(s.downTokens).toBe(500);
    expect(s.lastInputTokens).toBe(1500); // last request drives the context gauge
    expect(s.costUsd).toBeCloseTo(0.01);
  });

  test('context gauge is a percent of the window', () => {
    const s = newSessionStats();
    s.contextWindow = 1_000_000;
    s.lastInputTokens = 377_000;
    expect(fmtContext(s)).toBe('37.7%/1.00M');
  });

  test('context gauge is empty when the window is unknown', () => {
    expect(fmtContext(newSessionStats())).toBe('');
  });

  test('status line reads model, tokens, and mode', () => {
    const s = newSessionStats();
    s.provider = 'openrouter'; s.model = 'poolside/laguna-m.1:free';
    s.contextWindow = 262_144; s.lastInputTokens = 98_000;
    recordUsage(s, { input_tokens: 98_000, output_tokens: 12_000 });
    const line = statusLineText(s, 'execute');
    expect(line).toContain('↑98k');
    expect(line).toContain('↓12k');
    expect(line).toContain('execute');
    expect(line).toContain('poolside/laguna-m.1:free');
    expect(line).not.toContain('child tools');
  });

  test('status line names when a subscription CLI owns tools', () => {
    const s = newSessionStats();
    s.provider = 'codex'; s.model = 'auto'; s.childTools = true;
    expect(statusLineText(s, 'execute')).toContain('child tools');
  });
});
