import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const contextModule = join(import.meta.dir, '../src/agent/context-tracker.ts');

async function runContextProcess(home: string, cwd: string, source: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '-e', source], {
    cwd, env: { ...process.env, GRAIN_HOME: home }, stdout: 'pipe', stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(stderr || `context child exited ${code}`);
  return stdout;
}

describe('context tracker resilience', () => {
  test('keeps recent-file hints isolated per workspace across restarts', async () => {
    const home = mkdtempSync(join(tmpdir(), 'grain-context-home-'));
    const root = mkdtempSync(join(tmpdir(), 'grain-context-projects-'));
    const projectA = join(root, 'a'); const projectB = join(root, 'b');
    mkdirSync(projectA); mkdirSync(projectB);

    await runContextProcess(home, projectA, `const c=await import(${JSON.stringify(contextModule)});c.getContextTracker().trackFileRead('a.ts')`);
    expect(await runContextProcess(home, projectB, `const c=await import(${JSON.stringify(contextModule)});console.log(c.getContextSummary())`)).not.toContain('a.ts');
    await runContextProcess(home, projectB, `const c=await import(${JSON.stringify(contextModule)});c.getContextTracker().trackFileRead('b.ts')`);
    const summaryA = await runContextProcess(home, projectA, `const c=await import(${JSON.stringify(contextModule)});console.log(c.getContextSummary())`);
    expect(summaryA).toContain('a.ts');
    expect(summaryA).not.toContain('b.ts');
  });

  test('recovers from one corrupt workspace context snapshot', async () => {
    const home = mkdtempSync(join(tmpdir(), 'grain-context-corrupt-'));
    await runContextProcess(home, process.cwd(), `const c=await import(${JSON.stringify(contextModule)});c.getContextTracker().trackFileRead('before.ts')`);
    const dir = join(home, 'context', 'session');
    const file = readdirSync(dir).find(name => name.endsWith('.json'))!;
    writeFileSync(join(dir, file), '{broken');
    const output = await runContextProcess(home, process.cwd(), `const c=await import(${JSON.stringify(contextModule)});console.log(JSON.stringify(c.getContextSummary()));c.getContextTracker().trackFileRead('after.ts');console.log(c.getContextSummary())`);
    expect(output.split('\n')[0]).toBe('""');
    expect(output).toContain('after.ts');
  });
});
