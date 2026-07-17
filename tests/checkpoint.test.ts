import { describe, test, expect, afterAll } from 'bun:test';
import { newChangeset, snapshotBeforeEdit, undoLast, changedFileCount } from '../src/agent/checkpoint.js';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const root = mkdtempSync(join(tmpdir(), 'grain-ckpt-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('edit checkpoint / undo', () => {
  test('restores a modified file to its pre-task content', () => {
    const f = join(root, 'a.txt');
    writeFileSync(f, 'original');
    newChangeset();
    snapshotBeforeEdit(f);       // agent is about to edit
    writeFileSync(f, 'edited by agent');
    expect(readFileSync(f, 'utf8')).toBe('edited by agent');
    const { restored } = undoLast();
    expect(restored).toContain(f);
    expect(readFileSync(f, 'utf8')).toBe('original');
  });

  test('removes a file the agent newly created', () => {
    const f = join(root, 'new.txt');
    newChangeset();
    snapshotBeforeEdit(f);       // did not exist yet
    writeFileSync(f, 'created by agent');
    const { deleted } = undoLast();
    expect(deleted).toContain(f);
    expect(existsSync(f)).toBe(false);
  });

  test('keeps the ORIGINAL state when a file is edited twice in one task', () => {
    const f = join(root, 'b.txt');
    writeFileSync(f, 'v0');
    newChangeset();
    snapshotBeforeEdit(f); writeFileSync(f, 'v1');
    snapshotBeforeEdit(f); writeFileSync(f, 'v2'); // second snapshot must NOT overwrite v0
    undoLast();
    expect(readFileSync(f, 'utf8')).toBe('v0');
  });

  test('a new changeset clears the previous one', () => {
    newChangeset();
    snapshotBeforeEdit(join(root, 'c.txt'));
    expect(changedFileCount()).toBe(1);
    newChangeset();
    expect(changedFileCount()).toBe(0);
  });
});
