import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const homes: string[] = [];
function invoke(home: string, action: string): { exitCode: number; output: string } {
  const result = Bun.spawnSync([process.execPath, join(process.cwd(), 'src/cli.ts'), 'daemon', action], {
    cwd: process.cwd(), env: { ...process.env, GRAIN_HOME: home }, stdout: 'pipe', stderr: 'pipe',
  });
  return { exitCode: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}` };
}
afterEach(async () => {
  for (const home of homes.splice(0)) {
    const pidFile = join(home, 'daemon.pid');
    try { process.kill(Number(readFileSync(pidFile, 'utf8').trim()), 'SIGTERM'); } catch {}
    await Bun.sleep(50);
    rmSync(home, { recursive: true, force: true });
  }
});

describe('supervised daemon CLI', () => {
  test('start returns only after status can observe the daemon', async () => {
    const home = mkdtempSync(join(tmpdir(), 'grain-daemon-e2e-')); homes.push(home);
    const started = invoke(home, 'start');
    expect(started.exitCode, started.output).toBe(0);
    expect(started.output).toContain('Started Grain daemon');
    const status = invoke(home, 'status');
    expect(status.exitCode, status.output).toBe(0);
    expect(status.output).toContain('running (pid ');
    const stopped = invoke(home, 'stop');
    expect(stopped.exitCode, stopped.output).toBe(0);
    expect(stopped.output).toContain('Stopping Grain daemon');
  }, 15_000);
});
