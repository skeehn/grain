import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const cycles = Number(process.env.GRAIN_QUALIFICATION_CYCLES || process.argv[2] || 10);
if (!Number.isInteger(cycles) || cycles < 1 || cycles > 100) throw new Error('Qualification cycles must be an integer from 1 to 100');
process.env.npm_config_cache ||= join(process.cwd(), '.grain', 'cache', 'npm');
const startedAt = new Date().toISOString();
const checks: Array<{ name: string; ok: boolean; durationMs: number }> = [];
function persist(): void {
  const output = join(process.cwd(), '.grain', 'cache');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'qualification.json'), `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), cycles, checks }, null, 2)}\n`);
}
async function run(name: string, command: string, args: string[]): Promise<void> {
  const start = performance.now();
  const child = Bun.spawn([command, ...args], { cwd: process.cwd(), stdout: 'inherit', stderr: 'inherit', env: process.env });
  const exitCode = await child.exited;
  const item = { name, ok: exitCode === 0, durationMs: Math.round(performance.now() - start) };
  checks.push(item);
  if (!item.ok) { persist(); throw new Error(`Qualification check failed: ${name}`); }
}
for (let index = 1; index <= cycles; index++) await run(`tests-${index}`, 'bun', ['test']);
await run('typecheck', 'bun', ['run', 'typecheck']);
await run('build', 'bun', ['run', 'build']);
await run('install-smoke', 'bun', ['run', 'install:smoke']);
await run('package-dry-run', 'npm', ['pack', '--dry-run']);
persist();
console.log(`Qualification passed: ${cycles} test cycles plus typecheck, build, and package dry-run.`);
