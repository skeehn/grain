import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorktreeManager } from '../src/orchestration/index.js';

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'grain-worktree-'));
  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'grain@test.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Grain Test'], { cwd: root });
  writeFileSync(join(root, 'file.txt'), 'before\n');
  execFileSync('git', ['add', 'file.txt'], { cwd: root }); execFileSync('git', ['commit', '-m', 'base'], { cwd: root });
  return root;
}

describe('transactional worktrees', () => {
  test('captures, verifies, and atomically applies an isolated patch', () => {
    const root = repository(); const manager = new WorktreeManager();
    const tx = manager.prepare(root, `graph${Date.now()}`, 'writer');
    writeFileSync(join(tx.worktreePath, 'file.txt'), 'after\n');
    manager.capture(tx); manager.verify(tx, 'git', ['diff', '--check']); manager.merge(tx);
    expect(tx.state).toBe('merged'); expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('after\n');
  });

  test('refuses unverified and modified patches', () => {
    const root = repository(); const manager = new WorktreeManager();
    const tx = manager.prepare(root, `graph${Date.now()}x`, 'writer');
    writeFileSync(join(tx.worktreePath, 'file.txt'), 'after\n'); manager.capture(tx);
    expect(() => manager.merge(tx)).toThrow('Only verified');
    manager.verify(tx, 'git', ['diff', '--check']); writeFileSync(tx.patchPath, 'tampered');
    expect(() => manager.merge(tx)).toThrow('patch hash changed');
  });
});
