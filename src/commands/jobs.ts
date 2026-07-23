import { agentLoop, type AgentWorkspaceEvent } from '../agent/loop.js';
import { ScheduleStore } from '../schedules/index.js';
import { workspaceKey } from '../session/store.js';
import { randomUUID } from 'crypto';
import { loadConfig } from '../config.js';

async function withJobSecrets<T>(job: import('../schedules/index.js').ScheduledJob, operation: () => Promise<T>): Promise<T> {
  if (job.secretsPolicy === 'inherit') return operation();
  const config = loadConfig(job.workspace); const allowed = new Set<string>();
  const providerKeys: Record<string, string[]> = { anthropic: ['ANTHROPIC_API_KEY'], openrouter: ['OPENROUTER_API_KEY'],
    groq: ['GROQ_API_KEY'], xai: ['XAI_API_KEY'], bedrock: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_REGION'] };
  for (const key of providerKeys[config.provider] || []) allowed.add(key);
  const custom = config.providers?.[config.provider]; if (custom) allowed.add(custom.apiKeyEnv);
  const removed = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/iu.test(key) && !allowed.has(key)) {
    removed.set(key, value); delete process.env[key];
  }
  try { return await operation(); }
  finally { for (const [key, value] of removed) process.env[key] = value; }
}

export async function handleJobsCommand(subcommand = 'list', args: string[] = []): Promise<void> {
  const store = new ScheduleStore();
  if (subcommand === 'list') { console.log(JSON.stringify(store.list(), null, 2)); return; }
  if (subcommand === 'add') {
    const separator = args.indexOf('--'); const [name, ...cronParts] = args.slice(0, separator);
    const prompt = separator >= 0 ? args.slice(separator + 1).join(' ') : '';
    if (!name || !cronParts.length || !prompt) throw new Error('Usage: grain jobs add NAME CRON -- TASK');
    console.log(JSON.stringify(store.add({ name, cron: cronParts.join(' '), prompt, workspace: process.cwd() }), null, 2)); return;
  }
  if (subcommand === 'remove') { if (!args[0]) throw new Error('Usage: grain jobs remove NAME'); console.log(store.remove(args[0]) ? 'Removed.' : 'Not found.'); return; }
  if (subcommand === 'enable' || subcommand === 'disable') { if (!args[0]) throw new Error(`Usage: grain jobs ${subcommand} NAME`); console.log(JSON.stringify(store.setEnabled(args[0], subcommand === 'enable'), null, 2)); return; }
  if (subcommand === 'run' || subcommand === 'run-due') {
    const jobs = subcommand === 'run' ? store.list().filter(job => job.id === args[0] || job.name === args[0])
      : store.claimDue(`jobs-${process.pid}-${randomUUID()}`, new Date(), 10);
    if (subcommand === 'run' && !jobs.length) throw new Error(`Unknown scheduled job: ${args[0] || ''}`);
    for (const job of jobs) {
      const previous = process.cwd(); let runId: string | undefined;
      try {
        process.chdir(job.workspace);
        let lastError: unknown;
        for (let attempt = 0; attempt <= job.maxRetries; attempt++) {
          try {
            await withJobSecrets(job, () => agentLoop({ prompt: job.prompt, oneShot: true, resume: true, autoApprove: true, workspaceRoot: job.workspace,
              workspaceKey: workspaceKey(job.workspace), onEvent: (event: AgentWorkspaceEvent) => { if (event.type === 'run') runId = event.runId; } }));
            lastError = undefined; break;
          } catch (error) {
            lastError = error;
            if (attempt < job.maxRetries) await new Promise(resolve => setTimeout(resolve, Math.min(60_000, job.retryBackoffMs * 2 ** attempt)));
          }
        }
        if (lastError) throw lastError;
        store.markRun(job.id, { runId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error); store.markRun(job.id, { runId, error: message });
        if (subcommand === 'run') throw error; console.error(`${job.name}: ${message}`);
      } finally { process.chdir(previous); }
    }
    return;
  }
  throw new Error(`Unknown jobs command: ${subcommand}`);
}
