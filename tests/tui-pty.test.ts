import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

describe('full-screen TUI PTY wiring', () => {
  async function runPty(steps: Array<{ wait: string; send: string }>): Promise<{ exitCode: number; text: string; stderr: string }> {
    if (process.platform === 'win32' || !Bun.which('python3')) return { exitCode: 0, text: '', stderr: '' };
    const home = mkdtempSync(join(tmpdir(), 'grain-tui-pty-')); homes.push(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify({ provider: 'openrouter', model: null }));
    const child = Bun.spawn([
      Bun.which('python3')!, join(process.cwd(), 'tests/fixtures/pty-driver.py'),
      process.execPath, join(process.cwd(), 'src/cli.ts'), '--no-alt-screen',
    ], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe', env: {
      ...process.env, GRAIN_HOME: home, OPENROUTER_API_KEY: 'pty-fixture', TERM: 'xterm-256color',
      GRAIN_PTY_STEPS: JSON.stringify(steps),
    } });
    const output = new Response(child.stdout).text();
    const errors = new Response(child.stderr).text();
    const exitCode = await Promise.race([
      child.exited,
      Bun.sleep(18_000).then(() => { child.kill(); return 124; }),
    ]);
    const text = await output;
    const stderr = await errors;
    return { exitCode, text, stderr };
  }

  test('honors --no-alt-screen through the workspace orchestrator', async () => {
    if (process.platform === 'win32' || !Bun.which('python3')) return;
    const { exitCode, text, stderr } = await runPty([
      { wait: 'describe a task', send: '/help\r' },
      { wait: 'MEMORY ADMIN', send: '/quit\r' },
    ]);
    expect(exitCode, `PTY child stderr:\n${stderr}\nPTY output:\n${text}`).toBe(0);
    expect(text).toContain('grain');
    expect(text).toContain('MODELS');
    expect(text).toContain('INSPECT');
    expect(text).toContain('ORCHESTRATE');
    expect(text).toContain('MEMORY ADMIN');
    expect(text).not.toContain('\x1b[?1049h');
  }, 20_000);

  test('executes daily-driver commands and durable workflow creation in one session', async () => {
    if (process.platform === 'win32' || !Bun.which('python3')) return;
    const { exitCode, text, stderr } = await runPty([
      { wait: 'describe a task', send: '/settings\r' },
      { wait: 'Provider:', send: '/mode plan\r' },
      { wait: 'Mode: plan', send: '/budget turns 3\r' },
      { wait: 'Turn budget: 3', send: '/workflow pair audit the harness\r' },
      { wait: 'Created pair workflow', send: '/jobs\r' },
      { wait: '[JOBS]', send: '/quit\r' },
    ]);
    expect(exitCode, `PTY child stderr:\n${stderr}\nPTY output:\n${text}`).toBe(0);
    expect(text).toContain('Provider: openrouter');
    expect(text).toContain('Mode: plan');
    expect(text).toContain('Turn budget: 3');
    expect(text).toContain('Created pair workflow');
    expect(text).toContain('[JOBS]');
  }, 20_000);
});
