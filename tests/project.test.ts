import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { inspectProject } from '../src/agent/project.js';

const dirs: string[] = [];
function projectDir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'grain-project-'));
  dirs.push(d);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('inspectProject', () => {
  test('Rust repo exposes cargo check and cargo test', () => {
    const d = projectDir({ 'Cargo.toml': '[package]\nname="x"\n' });
    const info = inspectProject(d);
    expect(info.kinds).toEqual(['rust']);
    expect(info.verify?.command).toBe('cargo check --quiet');
    expect(info.test?.command).toBe('cargo test --quiet');
  });

  test('Go repo tests the whole module', () => {
    const d = projectDir({ 'go.mod': 'module example.com/x\n' });
    expect(inspectProject(d).test?.command).toBe('go test ./...');
  });

  test('Python repo with tests/ uses pytest', () => {
    const d = projectDir({ 'pyproject.toml': '[project]\nname="x"\n' });
    writeFileSync(join(d, 'tests'), ''); // file named tests is enough for hasPytest? existsSync tests as file yes
    // treat as present
    expect(inspectProject(d).test?.command).toBe('python3 -m pytest -q');
  });

  test('TypeScript bun repo uses bun test', () => {
    const d = projectDir({
      'package.json': JSON.stringify({ scripts: { typecheck: 'tsc -p .' } }),
      'bun.lock': '',
      'tsconfig.json': '{}',
    });
    const info = inspectProject(d);
    expect(info.kinds).toContain('typescript');
    expect(info.verify?.command).toBe('bun run typecheck');
    expect(info.test?.command).toBe('bun test');
  });
});
