import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveWorkspace } from '../src/workspace/root.js';

describe('workspace resolution', () => {
  test('discovers a project upward and keeps unrelated directories in general chat', () => {
    const base = `${process.env.GRAIN_HOME}/workspace-root`;
    const repo = join(base, 'repo'); const nested = join(repo, 'src', 'deep'); const plain = join(base, 'plain');
    mkdirSync(nested, { recursive: true }); mkdirSync(plain, { recursive: true }); writeFileSync(join(repo, 'package.json'), '{}');
    expect(resolveWorkspace(nested)).toEqual({ root: repo, mode: 'project' });
    expect(resolveWorkspace(plain)).toEqual({ mode: 'general' });
  });
});
