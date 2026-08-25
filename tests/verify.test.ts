import { describe, test, expect, afterAll } from 'bun:test';
import { detectVerifyCommand } from '../src/agent/verify.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dirs: string[] = [];
function projectDir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'grain-verify-'));
  dirs.push(d);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('detectVerifyCommand', () => {
  test('Rust → cargo check', () => {
    expect(detectVerifyCommand(projectDir({ 'Cargo.toml': '[package]' }))?.command).toBe('cargo check --quiet');
  });
  test('Go → go build', () => {
    expect(detectVerifyCommand(projectDir({ 'go.mod': 'module x' }))?.command).toBe('go build ./...');
  });
  test('bun project with a typecheck script → bun run typecheck', () => {
    const d = projectDir({ 'package.json': JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } }), 'bun.lock': '' });
    expect(detectVerifyCommand(d)?.command).toBe('bun run typecheck');
  });
  test('TS project without a script but with tsconfig → npx tsc --noEmit', () => {
    const d = projectDir({ 'package.json': '{}', 'tsconfig.json': '{}' });
    expect(detectVerifyCommand(d)?.command).toBe('npx tsc --noEmit');
  });
  test('nothing detectable → null (stays out of the way)', () => {
    expect(detectVerifyCommand(projectDir({ 'README.md': '# hi' }))).toBeNull();
  });

  test('Python → compileall', () => {
    const d = projectDir({ 'pyproject.toml': '[project]\nname="x"\n' });
    expect(detectVerifyCommand(d)?.label).toBe('python compileall');
    expect(detectVerifyCommand(d)?.command).toContain('compileall');
  });

  test('changed Python files in a Rust repo still use the Python check', () => {
    const d = projectDir({ 'Cargo.toml': '[package]', 'pyproject.toml': '[project]\nname="x"\n' });
    expect(detectVerifyCommand(d, ['src/lib.rs'])?.command).toContain('cargo check');
    expect(detectVerifyCommand(d, ['pkg/mod.py'])?.command).toContain('compileall');
  });

  test('Makefile check is the generic fallback', () => {
    const d = projectDir({ 'Makefile': 'check:\n\techo ok\n' });
    expect(detectVerifyCommand(d)?.command).toBe('make check');
  });
});

