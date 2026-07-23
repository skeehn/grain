import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { arch, platform, release } from 'node:os';
import { verifyHarborResult } from './benchmark-report.js';

const cycles = Number(process.env.GRAIN_QUALIFICATION_CYCLES || process.argv[2] || 10);
if (!Number.isInteger(cycles) || cycles < 1 || cycles > 100) throw new Error('Qualification cycles must be an integer from 1 to 100');
process.env.npm_config_cache ||= join(process.cwd(), '.grain', 'cache', 'npm');
const startedAt = new Date().toISOString();
const checks: Array<{ name: string; ok: boolean; durationMs: number; evidence?: unknown }> = [];
const capture = (command: string, args: string[]): string => {
  const result = Bun.spawnSync([command, ...args], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  return result.exitCode === 0 ? result.stdout.toString().trim() : '';
};
const hashFile = (path: string): string | undefined => existsSync(path)
  ? createHash('sha256').update(readFileSync(path)).digest('hex') : undefined;
const metadata = {
  schemaVersion: 1,
  qualificationId: randomUUID(),
  commit: capture('git', ['rev-parse', 'HEAD']),
  dirty: !!capture('git', ['status', '--porcelain=v1', '--untracked-files=all']),
  system: { platform: platform(), release: release(), arch: arch(), term: process.env.TERM || null, colorTerm: process.env.COLORTERM || null },
  runtime: { bun: Bun.version, node: process.version },
  dependencies: { bunLockSha256: hashFile('bun.lock'), packageSha256: hashFile('package.json') },
  requestedTarget: { executor: process.env.GRAIN_QUAL_EXECUTOR || 'deterministic-local',
    provider: process.env.GRAIN_QUAL_PROVIDER || null, model: process.env.GRAIN_QUAL_MODEL || null },
  seed: process.env.GRAIN_QUAL_SEED || 'grain-qualification-v1',
};
function persist(): void {
  const cache = join(process.cwd(), '.grain', 'cache');
  const output = join(cache, 'qualification');
  mkdirSync(output, { recursive: true });
  const artifacts = { binarySha256: hashFile(join('dist', 'grain')), packageLockSha256: hashFile('package-lock.json') };
  const body = `${JSON.stringify({ ...metadata, startedAt, finishedAt: new Date().toISOString(), cycles, checks, artifacts }, null, 2)}\n`;
  const immutable = join(output, `${metadata.qualificationId}.json`);
  const latest = join(cache, 'qualification.json');
  for (const target of [immutable, latest]) {
    const temporary = `${target}.tmp`; writeFileSync(temporary, body); renameSync(temporary, target);
  }
}
async function run(name: string, command: string, args: string[]): Promise<void> {
  const start = performance.now();
  const child = Bun.spawn([command, ...args], { cwd: process.cwd(), stdout: 'inherit', stderr: 'inherit', env: process.env });
  const exitCode = await child.exited;
  const item = { name, ok: exitCode === 0, durationMs: Math.round(performance.now() - start) };
  checks.push(item);
  if (!item.ok) { persist(); throw new Error(`Qualification check failed: ${name}`); }
}
function harborResultPaths(): string[] {
  const raw = process.env.GRAIN_QUAL_HARBOR_RESULTS?.trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    let values: unknown;
    try {
      values = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('GRAIN_QUAL_HARBOR_RESULTS must be one path or a JSON array of paths');
    }
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.trim())) {
      throw new Error('GRAIN_QUAL_HARBOR_RESULTS JSON must be an array of non-empty paths');
    }
    return values;
  }
  return [raw];
}
function verifyHarborEvidence(path: string, index: number): void {
  const start = performance.now();
  let evidence: ReturnType<typeof verifyHarborResult>;
  try {
    evidence = verifyHarborResult(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch (error) {
    evidence = {
      ok: false,
      job_id: null,
      total_trials: 0,
      evaluated_trials: 0,
      minimum_mean_reward: null,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  checks.push({
    name: `harbor-result-${index + 1}`,
    ok: evidence.ok,
    durationMs: Math.round(performance.now() - start),
    evidence: { ...evidence, sha256: hashFile(path) },
  });
  if (!evidence.ok) {
    persist();
    throw new Error(`Harbor qualification failed for ${path}: ${evidence.errors.join('; ')}`);
  }
}
const requestedHarborResults = harborResultPaths();
for (let index = 1; index <= cycles; index++) await run(`tests-${index}`, 'bun', ['test']);
await run('typecheck', 'bun', ['run', 'typecheck']);
await run('build', 'bun', ['run', 'build']);
await run('install-smoke', 'bun', ['run', 'install:smoke']);
await run('package-dry-run', 'npm', ['pack', '--dry-run']);
for (const [index, path] of requestedHarborResults.entries()) verifyHarborEvidence(path, index);
persist();
console.log(`Qualification passed: ${cycles} test cycles plus typecheck, build, install smoke, package dry-run, and ${requestedHarborResults.length} Harbor result(s).`);
