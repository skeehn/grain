// Tests for repo_map focus pattern handling (glob → regex conversion)
import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeRepoMap } from '../src/tools/repo-map.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'grain-repomap-'));
  mkdirSync(join(dir, 'src', 'sub'), { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'src', 'alpha.ts'), 'export function alpha() {}\n');
  writeFileSync(join(dir, 'src', 'sub', 'beta.ts'), 'export function beta() {}\n');
  writeFileSync(join(dir, 'lib', 'gamma.ts'), 'export function gamma() {}\n');
});

describe('executeRepoMap focus patterns', () => {
  test('documented "src/**" example does not throw and matches files under src/', async () => {
    const res = await executeRepoMap({ path: dir, focus: 'src/**' });
    expect(res.is_error).toBeFalsy();
    expect(res.content).toContain('alpha.ts');
    expect(res.content).toContain('beta.ts'); // ** crosses directory boundaries
    expect(res.content).not.toContain('gamma.ts');
  });

  test('single * does not cross directory separators', async () => {
    // "src/*.ts" should match src/alpha.ts but not src/sub/beta.ts
    const res = await executeRepoMap({ path: dir, focus: 'src/*.ts' });
    expect(res.is_error).toBeFalsy();
    expect(res.content).toContain('alpha.ts');
    expect(res.content).not.toContain('sub/beta.ts');
  });

  test('regex metacharacters in focus are treated literally, not as regex', async () => {
    // Unescaped, "src/(**" was an invalid regex and threw. Now it must be
    // handled gracefully — literal "(" matches nothing here.
    const res = await executeRepoMap({ path: dir, focus: 'src/(**' });
    expect(res.is_error).toBeFalsy();
    expect(res.content).toContain('No source files found');
  });

  test('dots in focus are literal (README.ts does not match "READMEXts")', async () => {
    writeFileSync(join(dir, 'src', 'axts.ts'), 'export const x = 1;\n');
    const res = await executeRepoMap({ path: dir, focus: 'a.ts' });
    // "a.ts" must not match "axts.ts" via an unescaped dot
    expect(res.content).not.toContain('axts.ts');
  });

  test('no focus returns all source files', async () => {
    const res = await executeRepoMap({ path: dir });
    expect(res.is_error).toBeFalsy();
    expect(res.content).toContain('alpha.ts');
    expect(res.content).toContain('gamma.ts');
  });
});
