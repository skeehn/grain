import { test, expect } from 'bun:test';
import { parseArgs } from '../src/cli.js';
import { COMMAND_HELP } from '../src/commands/help.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const cli = join(import.meta.dir, '../src/cli.ts');
async function isolated(run: (invoke: (...args: string[]) => Promise<{ code: number; text: string }>, home: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'grain-command-test-'));
  const project = join(home, 'project'); mkdirSync(project); writeFileSync(join(project, 'package.json'), '{}');
  const invoke = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, cli, ...args], { cwd: project, env: { ...process.env, GRAIN_HOME: home, ENGRAM_URL: 'http://127.0.0.1:1', NO_COLOR: '1' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try { const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return { code, text: out + err }; }
    finally { clearTimeout(timer); }
  };
  try { await run(invoke, home); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('every command has side-effect-free help and bad invocations fail promptly', async () => {
  await isolated(async invoke => {
    for (const command of Object.keys(COMMAND_HELP)) {
      const result = await invoke(command, '--help');
      expect(result.code, result.text).toBe(0); expect(result.text).toContain('grain');
    }
    for (const args of [['skills', 'validate'], ['mcp', 'validate'], ['runs', 'list'], ['agents', 'profiles'], ['jobs', 'list'], ['learning', 'list'], ['config', 'show'], ['worklog']]) {
      const result = await invoke(...args); expect(result.code, `${args}: ${result.text}`).toBe(0);
    }
    const daemon = await invoke('daemon', 'status'); expect(daemon.code).toBe(1); expect(daemon.text).toContain('stopped');
    for (const args of [['skills', 'view'], ['skills', 'delete', 'missing'], ['skills', 'add', 'new'], ['mcp', 'tools'], ['mcp', 'typo'], ['update', '--typo'], ['agents', 'typo'], ['jobs', 'typo'], ['runs', 'typo'], ['wiki', 'typo'], ['learning', 'typo']]) {
      const result = await invoke(...args); expect(result.code, `${args}: ${result.text}`).toBe(1);
    }
  });
}, 30_000);

test('skills validate catches invalid packages and view/delete work from the command line', async () => {
  await isolated(async (invoke, home) => {
    const folder = join(home, 'skills/example'); mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'SKILL.md'), '---\nname: example\ndescription: Example testing skill.\n---\nSKILL_BODY_MARKER\n');
    expect((await invoke('skills', 'validate')).text).toContain('Validated 1');
    expect((await invoke('skills', 'view', 'example')).text).toContain('SKILL_BODY_MARKER');
    writeFileSync(join(folder, 'SKILL.md'), 'invalid portable package');
    expect((await invoke('skills', 'validate')).code).toBe(1);
    writeFileSync(join(folder, 'SKILL.md'), '---\nname: example\ndescription: Example testing skill.\n---\nSKILL_BODY_MARKER\n');
    expect((await invoke('skills', 'delete', 'example')).code).toBe(0);
    expect((await invoke('skills', 'view', 'example')).code).toBe(1);
  });
});

test('skills add completes in a real terminal and creates a valid portable package', async () => {
  await isolated(async (invoke, home) => {
    const child = Bun.spawn(['python3', join(import.meta.dir, 'fixtures/pty-driver.py'), process.execPath, cli, 'skills', 'add', 'terminal-skill'], {
      cwd: home, env: { ...process.env, GRAIN_HOME: home, NO_COLOR: '1', GRAIN_PTY_STEPS: JSON.stringify([
        { wait: 'Description (one line):', send: 'Terminal creation test\r' },
        { wait: 'Tags (comma-separated, optional):', send: 'testing\r' },
        { wait: 'on a line by itself to finish:', send: 'TERMINAL_SKILL_BODY\rEOF\r' },
        { wait: 'Created skill:', send: '' },
      ]) }, stdout: 'pipe', stderr: 'pipe',
    });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, out + err).toBe(0);
    expect((await invoke('skills', 'validate')).text).toContain('Validated 1');
    expect((await invoke('skills', 'view', 'terminal-skill')).text).toContain('TERMINAL_SKILL_BODY');
  });
}, 20_000);

test('MCP tools connects to a real stdio server and reports allowlisted versus blocked tools', async () => {
  await isolated(async (invoke, home) => {
    writeFileSync(join(home, 'mcp.json'), JSON.stringify({ servers: { fixture: { command: process.execPath, args: [join(import.meta.dir, 'fixtures/mcp-server.ts')], trust: { enabled: true, allowTools: ['echo'] } } } }));
    const result = await invoke('mcp', 'tools', 'fixture');
    expect(result.code, result.text).toBe(0); expect(result.text).toContain('echo\tallowed'); expect(result.text).toContain('blocked\tblocked');
    expect((await invoke('mcp', 'list')).text).toContain('fixture');
  });
});

test('configuration, notes/recall, and scheduled-job commands round-trip in an isolated project', async () => {
  await isolated(async invoke => {
    for (const args of [['config', 'set', 'provider', 'ollama'], ['config', 'set', 'model', 'fixture-model'],
      ['note', 'COMMAND_NOTE_MARKER'], ['jobs', 'add', 'fixture-job', '@daily', '--', 'Review the local notes']]) {
      const result = await invoke(...args); expect(result.code, result.text).toBe(0);
    }
    expect((await invoke('config', 'show')).text).toContain('fixture-model');
    expect((await invoke('worklog')).text).toContain('COMMAND_NOTE_MARKER');
    expect((await invoke('recall', 'COMMAND_NOTE_MARKER')).text).toContain('COMMAND_NOTE_MARKER');
    expect((await invoke('jobs', 'list')).text).toContain('fixture-job');
    expect((await invoke('jobs', 'disable', 'fixture-job')).text).toContain('false');
    expect((await invoke('jobs', 'enable', 'fixture-job')).text).toContain('true');
    expect((await invoke('jobs', 'remove', 'fixture-job')).text).toContain('Removed');
    expect((await invoke('jobs', 'list')).text).not.toContain('fixture-job');
  });
}, 20_000);

test('skills validation and MCP are actual commands, not silent fallbacks', () => {
  expect(parseArgs(['bun', 'grain', 'skills', 'validate']).skillsSubcmd).toBe('validate');
  expect(parseArgs(['bun', 'grain', 'mcp', 'validate']).command).toBe('mcp');
  expect(() => parseArgs(['bun', 'grain', 'skills', 'typo'])).toThrow('Unknown');
  expect(() => parseArgs(['bun', 'grain', 'config', 'typo'])).toThrow('Unknown');
});
