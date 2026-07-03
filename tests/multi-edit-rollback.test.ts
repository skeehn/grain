// Tests for multi_edit atomic rollback semantics
import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeMultiEdit } from '../src/tools/multi-edit.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'grain-multiedit-'));
});

describe('executeMultiEdit rollback', () => {
  test('rollback removes files created via create_if_missing (all-or-nothing)', async () => {
    // An existing file that will be modified
    const existing = join(dir, 'existing.txt');
    writeFileSync(existing, 'original', 'utf-8');

    // A brand-new file created during the batch
    const created = join(dir, 'created.txt');

    // A path guaranteed to fail during apply: 'blocker' is a regular file,
    // so mkdirSync(dirname(...)) throws ENOTDIR when applying the third edit.
    const blockerFile = join(dir, 'blocker');
    writeFileSync(blockerFile, 'i am a file, not a directory', 'utf-8');
    const failing = join(dir, 'blocker', 'nested', 'x.txt');

    const res = await executeMultiEdit({
      edits: [
        { path: created, new_content: 'new file content', create_if_missing: true },
        { path: existing, old_content: 'original', new_content: 'changed' },
        { path: failing, new_content: 'never lands', create_if_missing: true },
      ],
    });

    expect(res.is_error).toBe(true);
    expect(res.content).toContain('rolled back');

    // Modified file restored
    expect(readFileSync(existing, 'utf-8')).toBe('original');
    // Newly created file must be removed, not left on disk
    expect(existsSync(created)).toBe(false);
  });

  test('successful batch creates and modifies files', async () => {
    const existing = join(dir, 'a.txt');
    writeFileSync(existing, 'old', 'utf-8');
    const fresh = join(dir, 'b.txt');

    const res = await executeMultiEdit({
      edits: [
        { path: existing, old_content: 'old', new_content: 'new' },
        { path: fresh, new_content: 'hello', create_if_missing: true },
      ],
    });

    expect(res.is_error).toBeFalsy();
    expect(readFileSync(existing, 'utf-8')).toBe('new');
    expect(readFileSync(fresh, 'utf-8')).toBe('hello');
  });
});
