/**
 * Plugin discovery module — shared by config and status commands
 * 
 * Detects installed agent plugins (claude-code, codex, aider) and their versions.
 */
import { spawn } from 'child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface PluginInfo {
  name: string;
  installed: boolean;
  version?: string;
  enabled: boolean;
  cached?: boolean;
}

// Discovery runs in setup/config/doctor paths and must remain responsive even
// when an installed CLI waits on a broken updater, cache lock, or login helper.
const PROBE_TIMEOUT_MS = 3_000;
const LAST_GOOD_TTL_MS = 24 * 60 * 60 * 1_000;
type ProbeResult = { installed: boolean; version?: string; timedOut?: boolean };
type ProbeCache = Record<string, { version?: string; observedAt: number }>;

function probeBinary(binary: string, cacheDirectory: string, args = ['--version']): Promise<ProbeResult> {
  return new Promise(resolve => {
    let settled = false; let output = '';
    const proc = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, XDG_CACHE_HOME: cacheDirectory } });
    const finish = (result: ProbeResult) => {
      if (settled) return; settled = true; clearTimeout(timer); resolve(result);
    };
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} finish({ installed: false, timedOut: true }); }, PROBE_TIMEOUT_MS);
    timer.unref();
    proc.stdout?.on('data', chunk => { if (output.length < 4096) output += chunk.toString(); });
    proc.stderr?.on('data', chunk => { if (output.length < 4096) output += chunk.toString(); });
    proc.on('error', () => finish({ installed: false }));
    proc.on('close', code => finish(code === 0 || /(?:version|agent v|codex-cli|claude code)/iu.test(output)
      ? { installed: true, version: output.trim().split(/\r?\n/u).find(line => /\d+\.\d+/u.test(line)) || output.trim() || undefined }
      : { installed: false }));
  });
}

/**
 * Discover installed plugins and their versions
 * 
 * Checks for:
 * - claude-code (via ClaudeCodePlugin)
 * - codex (via CodexPlugin)
 * - aider (via shell which + --version)
 */
export async function discoverPlugins(pluginsConfig?: Record<string, any>): Promise<PluginInfo[]> {
  pluginsConfig = pluginsConfig ?? {};
  const cacheDirectory = join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'cache', 'executors');
  const cacheFile = join(cacheDirectory, 'last-good.json');
  mkdirSync(cacheDirectory, { recursive: true });
  let cache: ProbeCache = {};
  try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')) as ProbeCache; } catch { /* First run or corrupt cache: probe normally. */ }
  const definitions = [
    { name: 'claude-code', binary: 'claude', enabled: pluginsConfig['claude-code']?.enabled ?? true },
    { name: 'codex', binary: 'codex', enabled: pluginsConfig.codex?.enabled ?? true },
    { name: 'opencode', binary: 'opencode', enabled: pluginsConfig.opencode?.enabled ?? true },
    { name: 'hermes', binary: 'hermes', enabled: pluginsConfig.hermes?.enabled ?? true },
    { name: 'grok', binary: 'grok', enabled: pluginsConfig.grok?.enabled ?? true },
    { name: 'aider', binary: 'aider', enabled: pluginsConfig.aider?.enabled ?? false },
  ];
  const results = await Promise.all(definitions.map(async definition => {
    const probe = await probeBinary(definition.binary, cacheDirectory);
    const lastGood = cache[definition.binary];
    if (probe.timedOut && lastGood && Date.now() - lastGood.observedAt <= LAST_GOOD_TTL_MS) {
      return { name: definition.name, enabled: definition.enabled, installed: true, version: lastGood.version, cached: true };
    }
    if (probe.installed) cache[definition.binary] = { version: probe.version, observedAt: Date.now() };
    return { name: definition.name, enabled: definition.enabled, installed: probe.installed, version: probe.version };
  }));
  try {
    const temporary = `${cacheFile}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, cacheFile);
  } catch { /* Discovery remains usable when its advisory cache is read-only. */ }
  return results;
}
