import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalWorkspaceFS, expandUserPath } from '../src/workspace/index.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'grain-workspace-')); });

describe('LocalWorkspaceFS', () => {
  test('rejects traversal and symlink escapes', () => {
    const outside = mkdtempSync(join(tmpdir(), 'grain-outside-'));
    writeFileSync(join(outside, 'secret'), 'secret');
    symlinkSync(outside, join(root, 'escape'));
    const fs = new LocalWorkspaceFS(root);
    expect(() => fs.readRange(join(outside, 'secret'))).toThrow('escapes workspace');
    expect(() => fs.readRange('escape/secret')).toThrow('escapes workspace');
  });

  test('uses optimistic hashes and atomic replacement', () => {
    const fs = new LocalWorkspaceFS(root);
    fs.writeAtomic('a.txt', 'first\n');
    const read = fs.readRange('a.txt');
    fs.writeAtomic('a.txt', 'second\n', read.hash);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('second\n');
    expect(() => fs.writeAtomic('a.txt', 'third', read.hash)).toThrow('changed since read');
  });

  test('reads an explicit ~/ path outside the project and refuses to write it', () => {
    const home = mkdtempSync(join(tmpdir(), 'grain-home-'));
    writeFileSync(join(home, 'named.txt'), 'hello from home\n');
    const fs = new LocalWorkspaceFS(root, { home });
    expect(expandUserPath('~/named.txt', home)).toBe(join(home, 'named.txt'));
    expect(fs.readRange('~/named.txt').content).toBe('hello from home\n');
    expect(() => fs.writeAtomic('~/named.txt', 'nope')).toThrow('escapes workspace');
  });

  test('skips ignored and binary files during search', () => {
    writeFileSync(join(root, '.gitignore'), 'ignored\n');
    require('fs').mkdirSync(join(root, 'ignored'));
    writeFileSync(join(root, 'ignored', 'x.txt'), 'needle');
    writeFileSync(join(root, 'visible.txt'), 'needle');
    writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    const fs = new LocalWorkspaceFS(root);
    expect(fs.search('needle').map(match => match.path)).toEqual(['visible.txt']);
  });
});
