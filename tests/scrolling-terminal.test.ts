import { expect, test } from 'bun:test';
import { ScrollingTerminal, asciiBlock, terminalText } from '../src/tui/terminal.js';
import { LineEditor } from '../src/tui/editor.js';
import { parseComposerInput } from '../src/workspace/app.js';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchTree } from '../src/agent/changed-files.js';
import { newChangeset, undoLast } from '../src/agent/checkpoint.js';

test('batched Enter commits each message before consuming the next', () => {
  const editor = new LineEditor(); const messages: string[] = [];
  editor.feedAll('first\rsecond\r', action => { if (action === 'submit') messages.push(editor.commit()); });
  expect(messages).toEqual(['first', 'second']);
});

test('child undo never deletes a tracked symlink replaced with a regular file', () => {
  const root = mkdtempSync(join(tmpdir(), 'grain-child-link-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  try {
    git('init', '-q'); git('config', 'user.email', 'grain@test.invalid'); git('config', 'user.name', 'Grain Test');
    symlinkSync('target.txt', join(root, 'link.txt')); git('add', '.'); git('commit', '-qm', 'baseline');
    newChangeset(); const done = watchTree(root);
    rmSync(join(root, 'link.txt')); writeFileSync(join(root, 'link.txt'), 'replacement');
    expect(done()).toContain('link.txt');
    undoLast();
    // Unsupported file types must be left alone, not mistaken for new files.
    expect(existsSync(join(root, 'link.txt'))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('preserves code formatting and quoted attachment paths', () => {
  expect(parseComposerInput('Explain:\n  x =  2\n  y = 3').argument).toBe('Explain:\n  x =  2\n  y = 3');
  expect(parseComposerInput('read @"my notes.md" please')).toEqual({ argument: 'read please', attachments: ['my notes.md'] });
});

test('streaming is incremental and cannot operate the terminal across chunks', () => {
  let text = ''; const terminal = new ScrollingTerminal({ columns: 30, write: value => { text += value; } });
  terminal.prompt('grain> ', 'hello');
  terminal.stream('First '); terminal.stream('answer.');
  terminal.stream('\x1b]52;c;'); terminal.stream('secret\x07');
  terminal.stream('\x1b['); terminal.stream('2J');
  terminal.line('Done.'); terminal.prompt('grain> '); terminal.close();
  expect(text).toContain('First answer.\nDone.');
  expect(text.match(/First/g)).toHaveLength(1);
  expect(text).not.toContain('secret');
  expect(text).not.toContain('\x1b[2J');
  expect(text).not.toContain('\x1b[?1049');
  expect(terminalText('hello\x1b[2Jworld')).toBe('helloworld');
  expect(asciiBlock('tools', 'long output '.repeat(9), 30).split('\n').every(line => line.length < 30)).toBe(true);
});

test('child-agent undo restores clean, dirty and deleted files and removes new files', () => {
  const root = mkdtempSync(join(tmpdir(), 'grain-child-undo-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  const a = join(root, 'a file.txt');
  try {
    git('init', '-q'); git('config', 'user.email', 'grain@test.invalid'); git('config', 'user.name', 'Grain Test');
    writeFileSync(a, 'base\n'); git('add', '.'); git('commit', '-qm', 'baseline');
    newChangeset(); let done = watchTree(root);
    writeFileSync(a, 'child edit\n'); expect(done()).toEqual(['a file.txt']); undoLast();
    expect(readFileSync(a, 'utf8')).toBe('base\n');
    writeFileSync(a, 'user edit\n'); newChangeset(); done = watchTree(root);
    writeFileSync(a, 'child edit again\n'); expect(done()).toEqual(['a file.txt']); undoLast();
    expect(readFileSync(a, 'utf8')).toBe('user edit\n');
    const created = join(root, 'new.txt'); newChangeset(); done = watchTree(root);
    writeFileSync(created, 'new\n'); expect(done()).toEqual(['new.txt']); undoLast(); expect(existsSync(created)).toBe(false);
    rmSync(a); newChangeset(); done = watchTree(root);
    writeFileSync(a, 'child recreated\n'); done(); undoLast(); expect(existsSync(a)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
