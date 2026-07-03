// Tests for test_fix_loop command construction and output parsing
import { describe, test, expect } from 'bun:test';
import { buildCommand, parseResults } from '../src/tools/test-fix-loop.js';

describe('buildCommand', () => {
  test('cargo: failFast=true uses cargo default (stop at first failure)', () => {
    const cmd = buildCommand('cargo', true);
    expect(cmd).toContain('cargo test');
    expect(cmd).not.toContain('--no-fail-fast');
  });

  test('cargo: failFast=false adds --no-fail-fast (continue past failures)', () => {
    const cmd = buildCommand('cargo', false);
    expect(cmd).toContain('--no-fail-fast');
  });

  test('jest: failFast=true adds --bail', () => {
    expect(buildCommand('jest', true)).toContain('--bail');
    expect(buildCommand('jest', false)).not.toContain('--bail');
  });

  test('pytest: failFast=true adds -x', () => {
    expect(buildCommand('pytest', true)).toContain(' -x');
    expect(buildCommand('pytest', false)).not.toContain(' -x');
  });

  test('go: failFast=true adds -failfast', () => {
    expect(buildCommand('go', true)).toContain('-failfast');
    expect(buildCommand('go', false)).not.toContain('-failfast');
  });

  test('test path is appended', () => {
    expect(buildCommand('vitest', true, 'tests/foo.test.ts')).toContain('tests/foo.test.ts');
  });
});

describe('parseResults', () => {
  test('jest summary with colon: "Tests: 2 failed, 3 passed"', () => {
    const out = [
      'FAIL src/foo.test.ts',
      'Tests:       2 failed, 3 passed, 5 total',
      'Snapshots:   0 total',
    ].join('\n');
    const r = parseResults(out, 'jest');
    expect(r.passed).toBe(3);
    expect(r.failed).toBe(2);
    expect(r.total).toBe(5);
  });

  test('vitest summary without colon: "Tests  2 failed | 3 passed (5)"', () => {
    const out = [
      ' Test Files  1 failed | 1 passed (2)',
      '      Tests  2 failed | 3 passed (5)',
      '   Start at  10:00:00',
    ].join('\n');
    const r = parseResults(out, 'vitest');
    expect(r.passed).toBe(3);
    expect(r.failed).toBe(2);
    expect(r.total).toBe(5);
  });

  test('vitest all passing: "Tests  5 passed (5)"', () => {
    const out = '      Tests  5 passed (5)\n';
    const r = parseResults(out, 'vitest');
    expect(r.passed).toBe(5);
    expect(r.failed).toBe(0);
  });

  test('bun summary: "5 pass" / "2 fail"', () => {
    const out = [
      'bun test v1.2.0',
      '',
      ' 5 pass',
      ' 2 fail',
      'Ran 7 tests across 2 files.',
    ].join('\n');
    const r = parseResults(out, 'bun');
    expect(r.passed).toBe(5);
    expect(r.failed).toBe(2);
    expect(r.total).toBe(7);
  });

  test('bun all passing', () => {
    const out = ' 65 pass\n 0 fail\nRan 65 tests across 10 files.\n';
    const r = parseResults(out, 'bun');
    expect(r.passed).toBe(65);
    expect(r.failed).toBe(0);
  });

  test('bun "pass" does not accidentally parse jest "passed" and vice versa', () => {
    // jest output parsed as bun framework should not blow up
    const jestOut = 'Tests:       2 failed, 3 passed, 5 total\n';
    const asBun = parseResults(jestOut, 'bun');
    // "passed"/"failed" do not match the bun "pass\b"/"fail\b" word-boundary regexes
    expect(asBun.passed).toBe(0);
    expect(asBun.failed).toBe(0);
  });

  test('unknown wrapper (npm) falls through jest → vitest → bun formats', () => {
    const vitestOut = '      Tests  1 failed | 4 passed (5)\n';
    const r = parseResults(vitestOut, 'npm');
    expect(r.passed).toBe(4);
    expect(r.failed).toBe(1);

    const bunOut = ' 3 pass\n 1 fail\n';
    const r2 = parseResults(bunOut, 'npm');
    expect(r2.passed).toBe(3);
    expect(r2.failed).toBe(1);
  });

  test('unparseable output yields 0/0 (caller must treat nonzero exit as failure)', () => {
    const r = parseResults('Segmentation fault (core dumped)\n[exit code: 139]', 'vitest');
    expect(r.passed).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.total).toBe(0);
  });

  test('pytest parsing still works', () => {
    const out = '3 passed, 1 failed\nFAILED tests/test_x.py::test_y\n';
    const r = parseResults(out, 'pytest');
    expect(r.passed).toBe(3);
    expect(r.failed).toBe(1);
  });
});
