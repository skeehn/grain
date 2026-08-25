import { describe, expect, test } from 'bun:test';
import { LineEditor } from '../src/tui/editor.js';
import { formatViewTabs, HELP_LINES, panelLineKind, wrapTuiText } from '../src/tui/app.js';

describe('TUI line editor', () => {
  test('edits Unicode by code point and moves the cursor', () => {
    const editor = new LineEditor();
    editor.feed('a🙂c'); editor.feed('\x1b[D'); editor.feed('\x7f'); editor.feed('b');
    expect(editor.value()).toBe('abc');
    expect(editor.cursorColumn()).toBe(2);
  });

  test('retains multiline bracketed paste without submitting', () => {
    const editor = new LineEditor();
    expect(editor.feed('\x1b[200~one\ntwo\x1b[201~')).toBe('changed');
    expect(editor.value()).toBe('one\ntwo');
    expect(editor.displayValue()).toBe('one↵two');
  });

  test('does not drop Enter when text and controls arrive in one chunk', () => {
    const editor = new LineEditor();
    expect(editor.feedAll('/help\r')).toEqual(['changed', 'submit']);
    expect(editor.value()).toBe('/help');
  });

  test('reassembles escape sequences split across terminal chunks', () => {
    const editor = new LineEditor(); editor.setValue('ab');
    expect(editor.feedAll('\x1b[')).toEqual([]);
    expect(editor.feedAll('D')).toEqual(['changed']);
    editor.feedAll('X'); expect(editor.value()).toBe('aXb');
  });

  test('Tab-completes an @file mention at the cursor', () => {
    const editor = new LineEditor();
    editor.feed('fix @src/tui/ed');
    expect(editor.mention()).toEqual({ start: 4, query: 'src/tui/ed' });
    editor.replaceMention('src/tui/editor.ts');
    expect(editor.value()).toBe('fix @src/tui/editor.ts ');
    expect(editor.mention()).toBeNull();
  });

  test('recalls committed history', () => {
    const editor = new LineEditor(); editor.feed('first'); editor.commit(); editor.feed('second'); editor.commit();
    editor.feed('\x1b[A'); expect(editor.value()).toBe('second');
    editor.feed('\x1b[A'); expect(editor.value()).toBe('first');
    editor.feed('\x1b[B'); expect(editor.value()).toBe('second');
  });
});

describe('TUI information layout', () => {
  test('keeps help within a normal terminal body and groups commands', () => {
    expect(HELP_LINES.length).toBeLessThanOrEqual(24);
    expect(HELP_LINES).toContain('MODELS');
    expect(HELP_LINES).toContain('INSPECT');
    expect(HELP_LINES).toContain('ORCHESTRATE');
    expect(HELP_LINES).toContain('MEMORY ADMIN');
  });

  test('keeps the active inspector visible in narrow terminals', () => {
    expect(formatViewTabs('jobs', 24)).toStartWith('[JOBS]');
    expect(formatViewTabs('memory', 24).length).toBeLessThanOrEqual(24);
  });

  test('wraps at words and preserves indentation', () => {
    expect(wrapTuiText('  alpha beta gamma', 12)).toEqual(['  alpha beta', '  gamma']);
    expect(wrapTuiText('supercalifragilistic', 10).every(line => line.length <= 10)).toBe(true);
  });

  test('colors unified-diff lines for the apply preview', () => {
    expect(panelLineKind('APPLY  src/main.rs  edit  +2 -1')).toBe('heading');
    expect(panelLineKind('+fn main() {}')).toBe('success');
    expect(panelLineKind('-fn main() {}')).toBe('error');
    expect(panelLineKind('+++ src/main.rs')).toBe('assistant');
  });
});
