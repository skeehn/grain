import { describe, test, expect } from 'bun:test';
import { applyToolCache, applyHistoryCache, cachedSystem, countBreakpoints } from '../src/providers/cache.js';

describe('prompt-cache breakpoints', () => {
  test('tool cache marks only the last tool', () => {
    const tools = [{ name: 'a' }, { name: 'b' }, { name: 'c' }] as any[];
    applyToolCache(tools);
    expect((tools[2] as any).cache_control).toEqual({ type: 'ephemeral' });
    expect((tools[0] as any).cache_control).toBeUndefined();
  });

  test('cachedSystem wraps text with cache_control (undefined when empty)', () => {
    const s = cachedSystem('you are grain');
    expect(s).toEqual([{ type: 'text', text: 'you are grain', cache_control: { type: 'ephemeral' } }]);
    expect(cachedSystem('')).toBeUndefined();
  });

  test('history cache marks the last block of the last message', () => {
    const messages = [
      { content: [{ type: 'text', text: 'hi' }] },
      { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    ] as any[];
    applyHistoryCache(messages);
    expect((messages[1].content[1] as any).cache_control).toEqual({ type: 'ephemeral' });
    expect((messages[1].content[0] as any).cache_control).toBeUndefined();
    expect((messages[0].content[0] as any).cache_control).toBeUndefined();
  });

  test('a full request stays within the 4-breakpoint limit', () => {
    const tools = [{ name: 'a' }, { name: 'b' }] as any[];
    const messages = [{ content: [{ type: 'text', text: 'x' }] }, { content: [{ type: 'text', text: 'y' }] }] as any[];
    applyToolCache(tools);
    applyHistoryCache(messages);
    const sys = cachedSystem('sys');
    expect(countBreakpoints(sys, tools, messages)).toBe(3); // tools + system + history
    expect(countBreakpoints(sys, tools, messages)).toBeLessThanOrEqual(4);
  });
});
