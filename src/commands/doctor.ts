import { execFileSync } from 'child_process';
import { loadConfig, validateConfig } from '../config.js';
import { loadAgentProfiles, validateAgentProfiles } from '../orchestration/profiles.js';
import { discoverPlugins } from '../plugins/discovery.js';

export type DoctorStatus = 'pass' | 'warn' | 'fail';
export interface DoctorCheck { id: string; status: DoctorStatus; summary: string; detail?: string }

export async function localEngramCheck(fetcher: typeof fetch): Promise<DoctorCheck> {
  try {
    const response = await fetcher('http://127.0.0.1:7474/health', { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return { id: 'engram', status: 'warn', summary: `memory daemon returned HTTP ${response.status}` };
    try {
      const statsResponse = await fetcher('http://127.0.0.1:7474/stats', { signal: AbortSignal.timeout(2_000) });
      if (statsResponse.ok) {
        const stats = await statsResponse.json() as Record<string, unknown>;
        const nodes = typeof stats.nodes === 'number' ? stats.nodes : null;
        const fts = typeof stats.fts_docs === 'number' ? stats.fts_docs : null;
        const vectors = typeof stats.vectors === 'number' ? stats.vectors : null;
        const divergent = nodes !== null && ((fts !== null && fts !== nodes) || (vectors !== null && vectors > 0 && vectors !== nodes));
        if (divergent) return {
          id: 'engram', status: 'warn',
          summary: `memory daemon is ready; index counts diverge (nodes ${nodes}, FTS ${fts ?? 'unknown'}, vectors ${vectors ?? 'unknown'})`,
          detail: 'Legacy Engram has no verified repair endpoint. Back up the store and reconcile it in Engram before relying on complete recall.',
        };
      } else return { id: 'engram', status: 'warn', summary: `memory daemon is ready; index stats returned HTTP ${statsResponse.status}`,
        detail: 'Memory remains available, but Grain could not verify node, full-text, and vector index consistency.' };
    } catch {
      return { id: 'engram', status: 'warn', summary: 'memory daemon is ready; index consistency could not be verified',
        detail: 'Memory remains available, but Grain could not verify node, full-text, and vector index consistency.' };
    }
    return { id: 'engram', status: 'pass', summary: 'local memory daemon is ready' };
  } catch {
    return { id: 'engram', status: 'warn', summary: 'memory daemon is offline', detail: 'Grain still works without memory; start Engram on 127.0.0.1:7474.' };
  }
}

export async function runDoctor(workspaceRoot = process.cwd(), fetcher: typeof fetch = fetch): Promise<DoctorCheck[]> {
  const config = loadConfig(workspaceRoot); const checks: DoctorCheck[] = [];
  const validation = validateConfig(config);
  checks.push(validation.valid ? { id: 'config', status: 'pass', summary: `schema v${config.schemaVersion || 1}; ${config.provider}/${config.model || 'auto'}` }
    : { id: 'config', status: 'fail', summary: validation.error || 'configuration is invalid' });

  try {
    const profiles = loadAgentProfiles(workspaceRoot); const errors = validateAgentProfiles(profiles);
    checks.push(errors.length ? { id: 'agents', status: 'fail', summary: `${errors.length} invalid agent profile(s)`, detail: errors.join('\n') }
      : { id: 'agents', status: 'pass', summary: `${profiles.length} agent profile(s) valid` });
  } catch (error) {
    checks.push({ id: 'agents', status: 'fail', summary: 'agent profiles could not be loaded', detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: workspaceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    checks.push({ id: 'workspace', status: 'pass', summary: `git workspace ${root}` });
  } catch {
    checks.push({ id: 'workspace', status: 'warn', summary: 'not inside a git repository', detail: 'Write agents require Git for checkpoints and isolated worktrees.' });
  }

  try {
    const plugins = await discoverPlugins(config.plugins?.plugins || {}); const installed = plugins.filter(plugin => plugin.installed);
    checks.push({ id: 'executors', status: installed.length ? 'pass' : 'warn',
      summary: `${installed.length}/${plugins.length} external executor(s) installed`,
      detail: plugins.map(plugin => `${plugin.name}: ${plugin.installed ? plugin.version || 'installed' : 'not found'}${plugin.cached ? ' (last known good; probe timed out)' : ''}`).join('\n') });
  } catch (error) {
    checks.push({ id: 'executors', status: 'warn', summary: 'external executors could not be probed', detail: String(error) });
  }
  checks.push(await localEngramCheck(fetcher));
  return checks;
}

export async function handleDoctorCommand(): Promise<void> {
  const checks = await runDoctor(); const icon: Record<DoctorStatus, string> = { pass: '✓', warn: '!', fail: '✗' };
  console.log('Grain doctor\n');
  for (const check of checks) {
    console.log(`${icon[check.status]} ${check.id.padEnd(11)} ${check.summary}`);
    if (check.detail) for (const line of check.detail.split('\n')) console.log(`  ${line}`);
  }
  const failures = checks.filter(check => check.status === 'fail').length;
  console.log(`\n${failures ? `${failures} blocking problem(s)` : 'Ready for a Grain run'}`);
  if (failures) process.exitCode = 1;
}
