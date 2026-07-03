import { describe, test, expect } from 'bun:test';

// cli.ts runs main() at import time — point argv at the harmless
// `--version` command before importing so nothing heavy executes.
const savedArgv = process.argv;
process.argv = ['bun', 'grain', '--version'];
const { parseArgs } = await import('../src/cli.js');
process.argv = savedArgv;

const parse = (...args: string[]) => parseArgs(['bun', 'grain', ...args]);

describe('parseArgs — flags after a positional prompt', () => {
  test('quoted prompt followed by --yes', () => {
    const p = parse('fix bug', '--yes');
    expect(p.prompt).toBe('fix bug');
    expect(p.autoApprove).toBe(true);
  });

  test('multi-word unquoted prompt with trailing flags', () => {
    const p = parse('fix', 'the', 'bug', '--yes', '--concise');
    expect(p.prompt).toBe('fix the bug');
    expect(p.autoApprove).toBe(true);
    expect(p.concise).toBe(true);
  });

  test('value-taking flag after positional prompt', () => {
    const p = parse('do stuff', '--model', 'claude-opus-4-5', '--max-turns', '5');
    expect(p.prompt).toBe('do stuff');
    expect(p.model).toBe('claude-opus-4-5');
    expect(p.maxTurns).toBe(5);
  });

  test('non-flag tokens interleaved with flags all join the prompt', () => {
    const p = parse('fix', '--yes', 'the', 'bug');
    expect(p.prompt).toBe('fix the bug');
    expect(p.autoApprove).toBe(true);
  });
});

describe('parseArgs — existing behavior preserved', () => {
  test('flags before the positional prompt', () => {
    const p = parse('--yes', '--provider', 'anthropic', 'refactor this');
    expect(p.autoApprove).toBe(true);
    expect(p.provider).toBe('anthropic');
    expect(p.prompt).toBe('refactor this');
  });

  test('-p sets the prompt explicitly', () => {
    const p = parse('-p', 'task description', '--yes');
    expect(p.prompt).toBe('task description');
    expect(p.autoApprove).toBe(true);
  });

  test('no args yields no prompt and defaults', () => {
    const p = parse();
    expect(p.prompt).toBeUndefined();
    expect(p.autoApprove).toBe(false);
    expect(p.concise).toBe(false);
  });

  test('commands still recognized in first position', () => {
    expect(parse('status').command).toBe('status');
    expect(parse('init').command).toBe('init');
    expect(parse('--help').command).toBe('help');
    const cfg = parse('config', 'set', 'model', 'foo');
    expect(cfg.command).toBe('config');
    expect(cfg.configSubcmd).toBe('set');
    expect(cfg.configKey).toBe('model');
    expect(cfg.configValue).toBe('foo');
  });

  test('command words after flags still recognized', () => {
    const p = parse('--yes', 'status');
    expect(p.command).toBe('status');
  });

  test('command-like words inside a prompt stay in the prompt', () => {
    const p = parse('explain', 'config', 'loading');
    expect(p.command).toBeUndefined();
    expect(p.prompt).toBe('explain config loading');
  });

  test('skills subcommand parsing', () => {
    const p = parse('skills', 'add', 'deploy');
    expect(p.command).toBe('skills');
    expect(p.skillsSubcmd).toBe('add');
    expect(p.skillsName).toBe('deploy');
  });
});
