import { describe, expect, test } from 'bun:test';
import { GRAIN_LOGO_HEIGHT, GRAIN_LOGO_WIDTH, grainLogoColor, grainLogoFrame, grainLogoSprite, grainLogoState } from '../src/tui/logo.js';

describe('Grain rice logo', () => {
  test('maps durable run states to logo states', () => {
    expect(grainLogoState('running')).toBe('thinking');
    expect(grainLogoState('executing_tool')).toBe('working');
    expect(grainLogoState('waiting_approval')).toBe('approval');
    expect(grainLogoState('verifying')).toBe('verifying');
    expect(grainLogoState('succeeded')).toBe('complete');
    expect(grainLogoState('failed')).toBe('failed');
  });

  test('keeps every logo frame at the terminal-safe width', () => {
    for (const status of ['idle', 'running', 'executing_tool', 'waiting_input', 'waiting_approval', 'verifying', 'needs_reconciliation', 'succeeded', 'failed']) {
      expect([...grainLogoFrame(status, 0, true)]).toHaveLength(GRAIN_LOGO_WIDTH);
      expect([...grainLogoFrame(status, 1, false)]).toHaveLength(GRAIN_LOGO_WIDTH);
    }
  });

  test('animates active states and freezes in reduced motion mode', () => {
    expect(grainLogoFrame('running', 0)).not.toBe(grainLogoFrame('running', 1));
    expect(grainLogoFrame('running', 0, true)).toBe(grainLogoFrame('running', 1, true));
  });

  test('keeps the full ASCII riceball sprite rectangular', () => {
    const sprite = grainLogoSprite('running', 2, true);
    expect(sprite).toHaveLength(GRAIN_LOGO_HEIGHT);
    sprite.forEach(line => expect([...line]).toHaveLength(GRAIN_LOGO_WIDTH));
  });

  test('maps logo states to theme colors', () => {
    const theme = { success: 'green', danger: 'red', warning: 'yellow', evidence: 'cyan' } as any;
    expect(grainLogoColor('succeeded', theme)).toBe('green');
    expect(grainLogoColor('failed', theme)).toBe('red');
    expect(grainLogoColor('waiting_approval', theme)).toBe('yellow');
    expect(grainLogoColor('waiting_input', theme)).toBe('yellow');
    expect(grainLogoColor('needs_reconciliation', theme)).toBe('yellow');
    expect(grainLogoColor('running', theme)).toBe('cyan');
  });
});
