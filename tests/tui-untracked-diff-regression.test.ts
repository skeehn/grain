import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { collectWorkingTreeDiff } from '../src/tui/app.js';

describe('TUI untracked diff regression', () => {
  test('diff pane includes patch contents for a newly created file', () => {
    const root = mkdtempSync(join(tmpdir(), 'grain-diff-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, 'new-file.txt'), 'GRAIN-DIFF-OK\n');

    const diff = collectWorkingTreeDiff(root);
    expect(diff).toContain('?? new-file.txt');
    expect(diff).toContain('+GRAIN-DIFF-OK');
  });
});
