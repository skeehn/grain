import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeWrite } from '../src/tools/write.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(process.env.GRAIN_HOME!, 'grain-write-'));
});

describe('executeWrite', () => {
  test('writes content and creates parent directories', async () => {
    const f = join(dir, 'nested', 'deep', 'file.txt');
    const res = await executeWrite({ path: f, content: 'hello' });
    expect(res.is_error).toBeFalsy();
    expect(readFileSync(f, 'utf-8')).toBe('hello');
  });

  test('overwrites existing files', async () => {
    const f = join(dir, 'x.txt');
    await executeWrite({ path: f, content: 'first' });
    await executeWrite({ path: f, content: 'second' });
    expect(readFileSync(f, 'utf-8')).toBe('second');
  });

  test('flags invalid JSON via syntax check but still writes the file', async () => {
    const f = join(dir, 'bad.json');
    const res = await executeWrite({ path: f, content: '{"unclosed": ' });
    expect(existsSync(f)).toBe(true);
    expect(res.content.toLowerCase()).toContain('syntax');
  });

  test('valid JSON passes the syntax check', async () => {
    const f = join(dir, 'good.json');
    const res = await executeWrite({ path: f, content: '{"ok": true}' });
    expect(res.is_error).toBeFalsy();
    expect(res.content.toLowerCase()).not.toContain('syntax error');
  });
});
