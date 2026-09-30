import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { GRAIN_VERSION } from '../config.js';

export function parseUpdateArgs(args: string[]) {
  const options = { check: false, yes: false, release: false, source: undefined as string | undefined };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') options.check = true;
    else if (args[i] === '--yes' || args[i] === '-y') options.yes = true;
    else if (args[i] === '--release') options.release = true;
    else if (args[i] === '--source' && args[i + 1] && !args[i + 1].startsWith('-')) options.source = resolve(args[++i]);
    else throw new Error(`Invalid update option: ${args[i]}. Run grain update --help.`);
  }
  if (options.source && options.release) throw new Error('Choose --source PATH or --release, not both.');
  return options;
}

/** Verify before replacing. Keep a unique backup; a failed update leaves the original intact. */
export function installVerifiedBinary(bytes: Buffer, destination: string, version?: string): { backup?: string } {
  if (existsSync(destination) && (!lstatSync(destination).isFile() || lstatSync(destination).isSymbolicLink())) {
    throw new Error(`Refusing to replace non-regular installation: ${destination}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  const stage = mkdtempSync(join(dirname(destination), '.grain-update-'));
  const binary = join(stage, 'grain');
  try {
    writeFileSync(binary, bytes, { mode: 0o755 }); chmodSync(binary, 0o755);
    const actual = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 15_000, maxBuffer: 4096 }).trim();
    if (!/^grain v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(actual) || (version && actual !== `grain v${version}`)) {
      throw new Error(`Downloaded executable reported unexpected version: ${actual}`);
    }
    let backup: string | undefined;
    if (existsSync(destination)) {
      backup = `${destination}.backup-${basename(stage).slice('.grain-update-'.length)}`;
      copyFileSync(destination, backup); chmodSync(backup, 0o755);
    }
    renameSync(binary, destination);
    return { backup };
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

export function verifyChecksum(bytes: Buffer, manifest: string, asset: string): void {
  const expected = manifest.split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line))
    .find(match => match?.[2] === asset)?.[1].toLowerCase();
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Checksum verification failed for ${asset}; installation was not changed.`);
}

interface UpdateDependencies {
  source: string | null;
  destination: string;
  npm: boolean;
  fetch: typeof fetch;
  build: (source: string) => void;
  install: typeof installVerifiedBinary;
  log: (message: string) => void;
  confirm: () => Promise<boolean>;
}

export async function handleUpdate(args: string[] = [], overrides: Partial<UpdateDependencies> = {}): Promise<void> {
  const options = parseUpdateArgs(args);
  const native = !['node', 'node.exe', 'bun', 'bun.exe'].includes(basename(process.execPath));
  let entryPoint = process.argv[1] || '';
  try { entryPoint = realpathSync(entryPoint); } catch { /* source or compiled entry point */ }
  const defaults: UpdateDependencies = {
    source: [process.env.GRAIN_SRC, join(homedir(), 'conductor/repos/grain'), join(homedir(), 'grain')]
      .find(path => path && existsSync(join(path, 'scripts/build.ts')) && existsSync(join(path, 'src/cli.ts'))) || null,
    destination: native ? process.execPath : join(homedir(), 'bin', 'grain'),
    npm: !native && /[/\\]node_modules[/\\]grain[/\\]/.test(entryPoint),
    fetch,
    build: source => { execFileSync('bun', ['run', 'build'], { cwd: source, stdio: 'inherit' }); },
    install: installVerifiedBinary,
    log: console.log,
    confirm: async () => {
      if (!process.stdin.isTTY) throw new Error('Update needs confirmation. Use grain update --yes to install, or --check to inspect.');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return await new Promise<boolean>(resolve => { rl.once('close', () => resolve(false)); rl.question('Install update? [y/N] ', answer => resolve(/^y(es)?$/i.test(answer.trim()))); }); }
      finally { rl.close(); }
    },
  };
  const deps = { ...defaults, ...overrides };
  deps.log(`grain update — current v${GRAIN_VERSION}`);
  if (deps.npm && !options.check) throw new Error('This is an npm installation. Update with: npm install -g grain@latest (use the same --prefix as installation).');
  const source = options.release || deps.npm ? null : options.source || deps.source;
  if (source) {
    if (!existsSync(join(source, 'scripts/build.ts')) || !existsSync(join(source, 'src/cli.ts'))) throw new Error(`Not a Grain source checkout: ${source}`);
    deps.log(`Source checkout: ${source}\nRebuilds the current checkout; does not fetch, pull, or switch branches. Use --release for the latest published release.`);
    if (options.check) return;
    deps.build(source);
    const result = deps.install(readFileSync(join(source, 'dist/grain')), deps.destination);
    deps.log(`Installed ${deps.destination}${result.backup ? `\nBackup: ${result.backup}` : ''}\nRestart grain to use this build.`);
    return;
  }
  const get = async (url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['api.github.com', 'github.com'].includes(parsed.hostname)) throw new Error('Release URL must be HTTPS on GitHub.');
    const response = await deps.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `grain/${GRAIN_VERSION}` }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Update request failed: HTTP ${response.status}. Installation was not changed.`);
    return response;
  };
  const release = await (await get('https://api.github.com/repos/skeehn/grain/releases/latest')).json() as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
  const version = release.tag_name?.replace(/^v/, '');
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('GitHub returned an invalid release version.');
  if (version === GRAIN_VERSION) { deps.log(`Already up to date (v${version}).`); return; }
  const currentParts = GRAIN_VERSION.split('.').map(Number); const latestParts = version.split('.').map(Number);
  const difference = latestParts.map((part, index) => part - currentParts[index]).find(part => part !== 0);
  if (difference && difference < 0) { deps.log(`Installed v${GRAIN_VERSION} is newer than published v${version}; refusing downgrade.`); return; }
  const assetName = `grain-${process.platform}-${process.arch}`;
  const asset = release.assets?.find(item => item.name === assetName);
  const checksums = release.assets?.find(item => item.name === 'SHA256SUMS');
  if (!asset || !checksums) throw new Error(`Release v${version} lacks ${assetName} or SHA256SUMS. Keep this installation; build from source instead.`);
  deps.log(`Available: v${version} (${assetName}).`);
  if (options.check || (!options.yes && !await deps.confirm())) return;
  const bytes = Buffer.from(await (await get(asset.browser_download_url)).arrayBuffer());
  verifyChecksum(bytes, await (await get(checksums.browser_download_url)).text(), assetName);
  const result = deps.install(bytes, deps.destination, version);
  deps.log(`Updated to v${version}.${result.backup ? `\nBackup: ${result.backup}` : ''}\nRestart grain to use the new version.`);
}
