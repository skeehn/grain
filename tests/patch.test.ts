import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executePatch } from '../src/tools/patch.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(process.env.GRAIN_HOME!, 'grain-patch-'));
  file = join(dir, 'target.txt');
});

describe('executePatch', () => {
  test('exact match replaces content', async () => {
    writeFileSync(file, 'hello world\ngoodbye world\n');
    const res = await executePatch({ path: file, old_string: 'hello world', new_string: 'hi there' });
    expect(res.is_error).toBeFalsy();
    expect(readFileSync(file, 'utf-8')).toBe('hi there\ngoodbye world\n');
  });

  test('errors when old_string occurs more than once', async () => {
    writeFileSync(file, 'dup\ndup\n');
    const res = await executePatch({ path: file, old_string: 'dup', new_string: 'x' });
    expect(res.is_error).toBe(true);
    expect(readFileSync(file, 'utf-8')).toBe('dup\ndup\n');
  });

  test('errors on missing file', async () => {
    const res = await executePatch({ path: join(dir, 'nope.txt'), old_string: 'a', new_string: 'b' });
    expect(res.is_error).toBe(true);
  });

  test('errors when old_string not found', async () => {
    writeFileSync(file, 'abc');
    const res = await executePatch({ path: file, old_string: 'xyz', new_string: 'b' });
    expect(res.is_error).toBe(true);
  });

  test('dollar signs in new_string are written literally', async () => {
    writeFileSync(file, 'const price = PLACEHOLDER;\n');
    const res = await executePatch({
      path: file,
      old_string: 'PLACEHOLDER',
      new_string: '`$${amount}` + "$&"',
    });
    expect(res.is_error).toBeFalsy();
    expect(readFileSync(file, 'utf-8')).toBe('const price = `$${amount}` + "$&";\n');
  });

  test('trimmed match falls back when old_string has extra whitespace', async () => {
    writeFileSync(file, 'line one\nline two\n');
    const res = await executePatch({ path: file, old_string: '  line one  ', new_string: 'line 1' });
    expect(res.is_error).toBeFalsy();
    expect(readFileSync(file, 'utf-8')).toContain('line 1');
  });

  test('fuzzy whitespace match rewrites the matched lines', async () => {
    writeFileSync(file, 'function  foo() {\n\treturn   1;\n}\n');
    const res = await executePatch({
      path: file,
      old_string: 'function foo() {\nreturn 1;\n}',
      new_string: 'function foo() {\n  return 2;\n}',
    });
    expect(res.is_error).toBeFalsy();
    expect(readFileSync(file, 'utf-8')).toContain('return 2;');
  });

  test('fuzzy match errors when more than one normalized occurrence exists', async () => {
    writeFileSync(file, 'function  foo() {\n\treturn   1;\n}\n\nfunction  foo() {\n\treturn   1;\n}\n');
    const res = await executePatch({
      path: file,
      old_string: 'function foo() {\nreturn 1;\n}',
      new_string: 'function foo() {\n  return 2;\n}',
    });
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/occurrences/i);
    expect(readFileSync(file, 'utf-8')).toContain('return   1;');
  });
});
