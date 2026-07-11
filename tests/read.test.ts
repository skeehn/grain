import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeRead } from '../src/tools/read.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(process.env.GRAIN_HOME!, 'grain-read-'));
});

describe('executeRead', () => {
  test('numbers lines starting at 1', async () => {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'alpha\nbeta\ngamma');
    const res = await executeRead({ path: f });
    expect(res.is_error).toBeFalsy();
    expect(res.content).toContain('1|alpha\n2|beta\n3|gamma');
    expect(res.content).toContain('[sha256:');
  });

  test('offset and limit window the output', async () => {
    const f = join(dir, 'b.txt');
    writeFileSync(f, Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n'));
    const res = await executeRead({ path: f, offset: 3, limit: 2 });
    expect(res.content).toContain('3|line3');
    expect(res.content).toContain('4|line4');
    expect(res.content).not.toContain('5|line5');
    expect(res.content).toContain('(6 more lines)');
  });

  test('offset below 1 clamps to 1', async () => {
    const f = join(dir, 'c.txt');
    writeFileSync(f, 'one\ntwo');
    const res = await executeRead({ path: f, offset: 0 });
    expect(res.content.startsWith('1|one')).toBe(true);
  });

  test('missing file is an error', async () => {
    const res = await executeRead({ path: join(dir, 'missing.txt') });
    expect(res.is_error).toBe(true);
  });
});
