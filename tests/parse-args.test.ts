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

  test('wiki, runs, and destructive approval flags parse explicitly', () => {
    const wiki = parse('wiki', 'search', 'architecture');
    expect(wiki.command).toBe('wiki');
    expect(wiki.utilitySubcmd).toBe('search');
    expect(wiki.utilityArg).toBe('architecture');
    const runs = parse('runs', 'export', 'run-1', 'out.json');
    expect(runs.utilityOutput).toBe('out.json');
    expect(parse('--allow-destructive', 'fix it').allowDestructive).toBe(true);
  });

  test('learning and agent graph commands parse explicitly', () => {
    expect(parseArgs(['node', 'grain', 'learning', 'show', 'abc']).command).toBe('learning');
    const agents = parseArgs(['node', 'grain', 'agents', 'pair', 'implement auth']);
    expect(agents.command).toBe('agents');
    expect(agents.utilitySubcmd).toBe('pair');
    expect(agents.utilityArg).toBe('implement auth');
  });

  test('scheduled job commands retain cron and task arguments', () => {
    const parsed = parseArgs(['node', 'grain', 'jobs', 'add', 'audit', '0', '9', '*', '*', '1-5', '--', 'review', 'the', 'repo']);
    expect(parsed.command).toBe('jobs');
    expect(parsed.utilitySubcmd).toBe('add');
    expect(parsed.utilityArgs).toEqual(['audit', '0', '9', '*', '*', '1-5', '--', 'review', 'the', 'repo']);
  });

  test('TUI command and presentation flags parse without changing classic prompts', () => {
    const tui = parseArgs(['node', 'grain', 'tui', '--run', 'run-1']);
    expect(tui.command).toBe('tui'); expect(tui.utilitySubcmd).toBe('--run'); expect(tui.utilityArg).toBe('run-1');
    const flags = parse('--classic', '--no-alt-screen', '--theme', 'field', '--density', 'compact', 'inspect repo');
    expect(flags.classic).toBe(true); expect(flags.noAltScreen).toBe(true); expect(flags.theme).toBe('field'); expect(flags.density).toBe('compact');
  });
  test('TUI continues parsing presentation flags after a run selector', () => {
    const result = parseArgs(['node', 'grain', 'tui', '--run', 'run-123', '--no-alt-screen']);
    expect(result.command).toBe('tui');
    expect(result.utilitySubcmd).toBe('--run');
    expect(result.utilityArg).toBe('run-123');
    expect(result.noAltScreen).toBe(true);
  });
  test('validates operands for Lab and attachments', () => {
    expect(() => parse('lab', '--run')).toThrow('Usage: grain lab --run <run-id>');
    expect(() => parse('--attach')).toThrow('Missing path for --attach');
  });
});
