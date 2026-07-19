import { agentLoop, type AgentWorkspaceEvent } from '../agent/loop.js';
import { ScheduleStore } from '../schedules/index.js';
import { workspaceKey } from '../session/store.js';

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
    const jobs = subcommand === 'run' ? store.list().filter(job => job.id === args[0] || job.name === args[0]) : store.due();
    if (subcommand === 'run' && !jobs.length) throw new Error(`Unknown scheduled job: ${args[0] || ''}`);
    for (const job of jobs) {
      const previous = process.cwd(); let runId: string | undefined;
      try {
        process.chdir(job.workspace);
        await agentLoop({ prompt: job.prompt, oneShot: true, resume: true, autoApprove: true, workspaceRoot: job.workspace,
          workspaceKey: workspaceKey(job.workspace), onEvent: (event: AgentWorkspaceEvent) => { if (event.type === 'run') runId = event.runId; } });
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
