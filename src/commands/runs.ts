import { listRuns, readRunEvents, replayRun, RunJournal } from '../kernel/index.js';

export function handleRunsCommand(subcommand = 'list', argument?: string, output?: string): void {
  if (subcommand === 'list') { console.log(listRuns().join('\n') || 'No runs.'); return; }
  if (!argument) throw new Error(`Usage: grain runs ${subcommand} <run-id>`);
  if (subcommand === 'inspect' || subcommand === 'replay') { console.log(JSON.stringify(replayRun(argument), null, 2)); return; }
  if (subcommand === 'events') { console.log(readRunEvents(argument).map(event => JSON.stringify(event)).join('\n')); return; }
  if (subcommand === 'context') {
    const event = [...readRunEvents(argument)].reverse().find(item => item.type === 'model_requested');
    if (!event) throw new Error(`Run ${argument} has no model request`);
    console.log(JSON.stringify((event.payload as any).context_manifest, null, 2)); return;
  }
  if (subcommand === 'export') {
    if (!output) throw new Error('Usage: grain runs export <run-id> <path>');
    RunJournal.open(argument).export(output);
    console.log(`Exported ${argument} to ${output}`);
    return;
  }
  throw new Error(`Unknown runs command: ${subcommand}`);
}
