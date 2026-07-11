import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalWorkspaceFS } from '../src/workspace/index.js';

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
