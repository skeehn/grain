import { describe, test, expect } from 'bun:test';

const savedArgv = process.argv;
process.argv = ['bun', 'grain', '--version'];
const { parseArgs } = await import('../src/cli.js');
process.argv = savedArgv;

const parse = (...args: string[]) => parseArgs(['bun', 'grain', ...args]);

describe('parseArgs — dash tokens inside prompts', () => {
  test('unknown dash token after prompt text joins the prompt', () => {
    const p = parse('fix', 'the', '--dry-run', 'handling');
    expect(p.prompt).toBe('fix the --dry-run handling');
    expect(p.unknownFlags).toBeUndefined();
  });

  test('bare minus survives in arithmetic prompts', () => {
    const p = parse('what', 'is', '5', '-', '3');
    expect(p.prompt).toBe('what is 5 - 3');
  });

  test('-- terminator passes everything through verbatim', () => {
    const p = parse('--yes', '--', 'explain', '--model', 'flag', 'usage');
    expect(p.autoApprove).toBe(true);
    expect(p.prompt).toBe('explain --model flag usage');
    expect(p.model).toBeUndefined();
  });

  test('unknown flag before any prompt text is recorded, not dropped', () => {
    const p = parse('--ys', 'do', 'the', 'thing');
    expect(p.unknownFlags).toEqual(['--ys']);
    expect(p.prompt).toBe('do the thing');
  });

  test('known flags after prompt text still act as flags', () => {
    const p = parse('do', 'the', 'thing', '--yes');
    expect(p.prompt).toBe('do the thing');
    expect(p.autoApprove).toBe(true);
  });
});
