import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const sandbox = mkdtempSync(join(tmpdir(), 'grain-install-smoke-'));
const packDir = join(sandbox, 'pack');
const prefix = join(sandbox, 'prefix');
const home = join(sandbox, 'home');
const cache = join(sandbox, 'npm-cache');
for (const path of [packDir, prefix, home, cache, join(home, 'skills')]) mkdirSync(path, { recursive: true });

async function run(command: string, args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): Promise<string> {
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd || root,
    env: { ...process.env, ...options.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command} ${args.join(' ')} failed (${exitCode})\n${stdout}${stderr}`);
  return stdout;
}

try {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string };
  await run('npm', ['pack', '--pack-destination', packDir], { env: { npm_config_cache: cache } });
  const archive = join(packDir, `${packageJson.name}-${packageJson.version}.tgz`);
  await run('npm', ['install', '--global', '--offline', '--ignore-scripts', '--prefix', prefix, archive], {
    env: { npm_config_cache: cache },
  });
  const grain = join(prefix, 'bin', 'grain');
  const env = { GRAIN_HOME: home, NO_COLOR: '1' };
  const version = await run(grain, ['--version'], { cwd: sandbox, env });
  if (!version.includes(`grain v${packageJson.version}`)) throw new Error(`Unexpected version output: ${version}`);
  const help = await run(grain, ['--help'], { cwd: sandbox, env });
  if (!help.includes('open your workspace') || !help.includes('grain update')) throw new Error('Installed help is missing the primary workspace flow');
  writeFileSync(join(home, 'skills', 'smoke.md'), `---\nname: smoke\ndescription: Installation smoke skill.\ntriggers:\n  - install smoke\n---\n\nVerify installed skill discovery.\n`);
  const skills = await run(grain, ['skills'], { cwd: sandbox, env });
  if (!skills.includes('smoke')) throw new Error('Installed binary did not discover Markdown skills');
  const skill = await run(grain, ['skills', 'view', 'smoke'], { cwd: sandbox, env });
  if (!skill.includes('Verify installed skill discovery.')) throw new Error('Installed binary did not render skill content');
  mkdirSync(join(home, 'skills', 'portable'), { recursive: true });
  writeFileSync(join(home, 'skills', 'portable', 'SKILL.md'), '---\nname: portable\ndescription: Test installed portable skills.\n---\nInstalled portable instructions.\n');
  const validation = await run(grain, ['skills', 'validate'], { cwd: sandbox, env });
  if (!validation.includes('Validated 1')) throw new Error('Installed skills validation did not run');
  await run(grain, ['mcp', 'validate'], { cwd: sandbox, env });
  await run(grain, ['update', '--help'], { cwd: sandbox, env });
  const update = Bun.spawn([grain, 'update', '--yes'], { cwd: sandbox, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
  const [updateCode, updateOut, updateErr] = await Promise.all([update.exited, new Response(update.stdout).text(), new Response(update.stderr).text()]);
  if (updateCode !== 1 || !(updateOut + updateErr).includes('npm install -g')) throw new Error('npm update guidance failed; must not overwrite its symlink');
  console.log(`Install smoke passed: grain v${packageJson.version}, offline npm install, help, portable skills, MCP validation, and safe npm update guidance.`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
