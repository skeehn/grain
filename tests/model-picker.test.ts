import { describe, expect, test } from 'bun:test';
import { applyOverlayKey, decodeOverlayKey, filterItems, fuzzyMatch, type OverlayItem, type OverlayState } from '../src/tui/overlay.js';
import { firstAvailable, sortEntries, type ModelEntry } from '../src/providers/registry.js';
import { ansi256Index } from '../src/tui/differential.js';

const entry = (over: Partial<ModelEntry>): ModelEntry => ({
  id: 'x:y', provider: 'x', model: 'y', label: 'X · Y', hint: '', kind: 'api', available: true, ...over,
});

function overlay(items: OverlayItem<string>[]): { state: OverlayState<string>; picked: () => string | null | undefined } {
  let result: string | null | undefined;
  const state: OverlayState<string> = {
    title: 'pick', items: items as OverlayItem<unknown>[], filter: '', index: 0,
    resolve: value => { result = value as string | null; },
  } as OverlayState<string>;
  return { state, picked: () => result };
}

const items: OverlayItem<string>[] = [
  { label: 'Claude Code · opus', hint: 'subscription', value: 'claude-code:opus' },
  { label: 'Claude Code · sonnet', hint: 'subscription', value: 'claude-code:sonnet' },
  { label: 'OpenAI Codex · codex', hint: 'subscription', value: 'codex:auto' },
  { label: 'Anthropic API · claude-opus-4-5', hint: 'api credit', value: 'anthropic:claude-opus-4-5', disabled: true, fix: 'add credit' },
];

describe('model picker overlay', () => {
  test('filters by substring, then falls back to a fuzzy subsequence', () => {
    expect(filterItems(items, 'codex').map(item => item.value)).toEqual(['codex:auto']);
    expect(filterItems(items, '').length).toBe(items.length);
    // "ccso" matches no substring but does match Claude Code · sonnet in order.
    expect(fuzzyMatch('Claude Code · sonnet', 'ccso')).toBe(true);
    expect(fuzzyMatch('Claude Code · sonnet', 'zzz')).toBe(false);
  });

  test('arrow keys wrap and Enter resolves the highlighted row', () => {
    const { state, picked } = overlay(items);
    expect(applyOverlayKey(state, '\x1b[B')).toBe('open');
    expect(state.index).toBe(1);
    expect(applyOverlayKey(state, '\x1b[A')).toBe('open');
    expect(applyOverlayKey(state, '\x1b[A')).toBe('open');
    expect(state.index).toBe(items.length - 1); // wrapped past the top
    expect(applyOverlayKey(state, '\r')).toBe('closed');
    expect(picked()).toBe('anthropic:claude-opus-4-5');
  });

  test('typing filters and Enter picks from the filtered list', () => {
    const { state, picked } = overlay(items);
    for (const char of 'sonnet') applyOverlayKey(state, char);
    expect(state.filter).toBe('sonnet');
    applyOverlayKey(state, '\r');
    expect(picked()).toBe('claude-code:sonnet');
  });

  test('backspace narrows the filter without losing the list', () => {
    const { state } = overlay(items);
    for (const char of 'codexz') applyOverlayKey(state, char);
    expect(filterItems(state.items, state.filter).length).toBe(0);
    applyOverlayKey(state, '\x7f');
    expect(state.filter).toBe('codex');
    expect(filterItems(state.items, state.filter).length).toBe(1);
  });

  test('escape dismisses without choosing', () => {
    const { state, picked } = overlay(items);
    expect(applyOverlayKey(state, '\x1b')).toBe('closed');
    expect(picked()).toBeNull();
  });

  test('decodes navigation keys without swallowing typed text', () => {
    expect(decodeOverlayKey('\x1b[A').key).toBe('up');
    expect(decodeOverlayKey('\x1b[6~').key).toBe('page-down');
    expect(decodeOverlayKey('q').text).toBe('q');
    expect(decodeOverlayKey('\x1b[Z')).toEqual({}); // unknown escape is ignored, not typed
  });
});

describe('model registry ordering', () => {
  test('usable models come first, subscriptions ahead of paid APIs', () => {
    const sorted = sortEntries([
      entry({ id: 'a', label: 'Anthropic API', kind: 'api', available: true }),
      entry({ id: 'b', label: 'Claude Code', kind: 'subscription', available: true }),
      entry({ id: 'c', label: 'Unusable', kind: 'subscription', available: false }),
      entry({ id: 'd', label: 'Ollama', kind: 'local', available: true }),
    ]);
    expect(sorted.map(item => item.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(firstAvailable(sorted)?.id).toBe('b');
  });

  test('an all-unavailable registry has no usable default', () => {
    expect(firstAvailable([entry({ available: false })])).toBeUndefined();
  });
});

describe('terminal colour fallback', () => {
  test('maps hex to the 256-colour cube and grey ramp', () => {
    // Without this fallback every 256-colour terminal rendered the whole TUI
    // in a single undifferentiated colour.
    expect(ansi256Index(0, 0, 0)).toBeGreaterThanOrEqual(232);
    expect(ansi256Index(255, 255, 255)).toBeGreaterThanOrEqual(232);
    expect(ansi256Index(214, 168, 95)).toBeGreaterThanOrEqual(16);
    expect(ansi256Index(214, 168, 95)).toBeLessThan(232);
  });
});
