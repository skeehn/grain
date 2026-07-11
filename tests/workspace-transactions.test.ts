import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalWorkspaceFS, WorkspaceTransactionManager } from '../src/workspace/index.js';

describe('workspace transactions', () => {
  test('requires approval and commits optimistic multi-file writes', () => {
    const root = mkdtempSync(join(tmpdir(), 'grain-tx-')); writeFileSync(join(root, 'a.txt'), 'old\n');
    const fs = new LocalWorkspaceFS(root); const manager = new WorkspaceTransactionManager(fs); const before = fs.stat('a.txt');
    const tx = manager.begin({ invocationId: 'tool-1', expectedInputs: [{ path: 'a.txt', content_hash: before.content_hash }],
      operations: [{ type: 'write', path: 'a.txt', content: 'new\n' }, { type: 'write', path: 'b.txt', content: 'created\n' }] });
    expect(() => manager.apply(tx.id)).toThrow('Cannot apply'); manager.approve(tx.id); const result = manager.apply(tx.id);
    expect(result.transaction.state).toBe('committed'); expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('new\n');
  });
  test('rolls back earlier writes when a later operation fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'grain-tx-fail-')); writeFileSync(join(root, 'a.txt'), 'old\n');
    const fs = new LocalWorkspaceFS(root); const manager = new WorkspaceTransactionManager(fs);
    const tx = manager.begin({ invocationId: 'tool-2', operations: [{ type: 'write', path: 'a.txt', content: 'changed\n' }, { type: 'remove', path: 'missing.txt' }] });
    manager.approve(tx.id); expect(() => manager.apply(tx.id)).toThrow('rolled_back');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('old\n'); expect(manager.load(tx.id).state).toBe('rolled_back');
  });
});
