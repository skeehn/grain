import { describe, expect, test } from 'bun:test';
import { mascotFrame, mascotState, resolveTheme } from '../src/tui/index.js';

describe('Workshop Companion', () => {
  test('ships four distinct persistent theme palettes', () => {
    expect(resolveTheme('field').canvas).not.toBe(resolveTheme('studio').canvas);
    expect(resolveTheme('arcade').accent).not.toBe(resolveTheme('system').accent);
    expect(resolveTheme('unknown').name).toBe('field');
  });

  test('maps durable run states to helpful rice companion states', () => {
    expect(mascotState('waiting_input')).toBe('question');
    expect(mascotState('waiting_approval')).toBe('approval');
    expect(mascotState('verifying')).toBe('verifying');
    expect(mascotState('succeeded')).toBe('complete');
    expect(mascotFrame('running', 0, true)).toBe(mascotFrame('running', 9, true));
  });
});
