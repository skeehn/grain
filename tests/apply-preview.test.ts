import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { formatApplyPreview, previewToolEdit } from '../src/agent/apply-preview.js';
import { setWorkspaceRoot } from '../src/workspace/index.js';

const root = process.env.GRAIN_HOME!;
afterEach(() => setWorkspaceRoot(root));

describe('apply preview', () => {
  test('previews a write as a unified diff before the file changes', () => {
    const dir = join(root, 'preview-write');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'main.go');
    writeFileSync(path, 'package main\n');
    setWorkspaceRoot(dir);
    const [preview] = previewToolEdit('write', { path: 'main.go', content: 'package main\n\nfunc main() {}\n' });
    expect(preview.created).toBe(false);
    expect(preview.added).toBeGreaterThan(0);
    expect(preview.unified).toContain('+func main() {}');
    expect(formatApplyPreview([preview])).toContain('APPLY  main.go');
  });

  test('previews a patch without mutating the file', () => {
    const dir = join(root, 'preview-patch');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lib.py'), 'def add(a, b):\n    return a + b\n');
    setWorkspaceRoot(dir);
    const [preview] = previewToolEdit('patch', {
      path: 'lib.py', old_string: 'return a + b', new_string: 'return a + b + 0',
    });
    expect(preview.error).toBeUndefined();
    expect(preview.unified).toContain('+    return a + b + 0');
    expect(preview.unified).toContain('-    return a + b');
  });
});
