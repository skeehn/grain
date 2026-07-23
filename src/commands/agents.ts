import { AgentScheduler, ExternalAgentExecutor, TaskGraphStore, WorkflowRunner, WorktreeManager } from '../orchestration/index.js';
import type { TaskGraph } from '../orchestration/index.js';
import { AgentMailbox } from '../orchestration/index.js';
import { agentDashboard } from '../tui/renderer.js';
import { watchAgentGraph } from '../orchestration/dashboard.js';
import { loadAgentProfiles, validateAgentProfiles } from '../orchestration/profiles.js';
import { executeProfileGraph } from '../orchestration/profile-executor.js';

export function createTemplate(mode: TaskGraph['mode'], objective: string): TaskGraph {
  const scheduler = new AgentScheduler(); const graph = scheduler.createGraph(mode);
  if (mode === 'pair') {
    const research = scheduler.addTask(graph, { role: 'researcher', objective: `Research: ${objective}`, expectedArtifact: 'evidence-backed implementation brief' });
    const driver = scheduler.addTask(graph, { role: 'driver', objective, expectedArtifact: 'verified patch', write: true, dependencies: [research.id] });
    scheduler.addTask(graph, { role: 'navigator', objective: `Review implementation: ${objective}`, expectedArtifact: 'review verdict with evidence', dependencies: [driver.id] });
  } else if (mode === 'research' || mode === 'plan') {
    const first = scheduler.addTask(graph, { role: 'researcher', objective: `${mode} primary: ${objective}`, expectedArtifact: mode === 'research' ? 'sourced research report' : 'evidence-backed execution plan' });
    const second = scheduler.addTask(graph, { role: 'researcher', objective: `${mode} alternative: ${objective}`, expectedArtifact: 'independent alternative with evidence' });
    scheduler.addTask(graph, { role: 'reviewer', objective: `Synthesize and critique: ${objective}`, expectedArtifact: 'independent synthesis', dependencies: [first.id, second.id] });
  } else if (mode === 'review-panel') {
    const reviews = ['correctness', 'security', 'testing', 'performance'].map(focus => scheduler.addTask(graph,
      { role: 'reviewer', objective: `${focus} review: ${objective}`, expectedArtifact: `${focus} findings with evidence` }));
    scheduler.addTask(graph, { role: 'verifier', objective: `Panel verdict: ${objective}`, expectedArtifact: 'deduplicated severity-ranked verdict', dependencies: reviews.map(task => task.id) });
  } else if (mode === 'swarm') {
    const scouts = ['architecture', 'implementation', 'tests'].map(focus => scheduler.addTask(graph,
      { role: 'researcher', objective: `${focus} scout: ${objective}`, expectedArtifact: `${focus} evidence packet` }));
    scheduler.addTask(graph, { role: 'coordinator', objective, expectedArtifact: 'verified integrated patch', write: true, dependencies: scouts.map(task => task.id) });
  } else if (mode === 'repair-loop' || mode === 'migration-loop') {
    const driver = scheduler.addTask(graph, { role: 'driver', objective, expectedArtifact: 'candidate patch', write: true });
    scheduler.addTask(graph, { role: 'verifier', objective: `Independently verify: ${objective}`, expectedArtifact: 'test evidence and repair verdict', dependencies: [driver.id] });
  } else if (mode === 'benchmark-loop') {
    const runner = scheduler.addTask(graph, { role: 'researcher', objective: `Run pinned benchmark: ${objective}`, expectedArtifact: 'reproducible benchmark artifact' });
    scheduler.addTask(graph, { role: 'verifier', objective: `Audit benchmark isolation: ${objective}`, expectedArtifact: 'qualification verdict', dependencies: [runner.id] });
  } else if (mode === 'recursive-delivery') {
    const plan = scheduler.addTask(graph, { role: 'coordinator', objective: `Plan bounded delivery: ${objective}`, expectedArtifact: 'dependency graph and budgets' });
    const build = scheduler.addTask(graph, { role: 'driver', objective, expectedArtifact: 'verified isolated patch', write: true, dependencies: [plan.id] });
    scheduler.addTask(graph, { role: 'verifier', objective: `Review and qualify: ${objective}`, expectedArtifact: 'independent completion evidence', dependencies: [build.id] });
  } else scheduler.addTask(graph, { role: 'coordinator', objective, expectedArtifact: 'verified result', write: true });
  return graph;
}

export async function handleAgentsCommand(subcommand = 'list', argument?: string, extra?: string): Promise<void> {
  const store = new TaskGraphStore();
  if (subcommand === 'profiles' || subcommand === 'validate') {
    const profiles = loadAgentProfiles(process.cwd()); const errors = validateAgentProfiles(profiles);
    if (subcommand === 'profiles') {
      console.log(profiles.map(profile => `${profile.id}\t${profile.mode}\t${profile.executor}\t${profile.provider || '-'}\t${profile.model || '-'}`).join('\n'));
      return;
    }
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; return; }
    console.log(`Validated ${profiles.length} agent profile(s).`); return;
  }
  if (subcommand === 'run') {
    if (!argument || !extra) throw new Error('Usage: grain agents run <profile> <objective>');
    const profile = loadAgentProfiles(process.cwd()).find(item => item.id === argument);
    if (!profile) throw new Error(`Unknown agent profile: ${argument}`);
    const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('solo');
    const write = profile.permissions.write === 'allow' || profile.permissions.write === 'ask';
    const driver = scheduler.addTask(graph, { role: write ? 'driver' : 'researcher', objective: extra,
      expectedArtifact: write ? 'isolated verified patch' : 'evidence-backed response', write, profile: profile.id,
      executor: profile.executor, provider: profile.provider, model: profile.model, budget: profile.budget });
    if (write) scheduler.addTask(graph, { role: 'verifier', objective: `Independently verify: ${extra}`,
      expectedArtifact: 'verification verdict with evidence', dependencies: [driver.id], profile: profile.id,
      executor: profile.executor, provider: profile.provider, model: profile.model, budget: profile.budget });
    store.save(graph);
    const execution = await executeProfileGraph(graph, process.cwd(), store); const final = execution.graph;
    console.log(JSON.stringify({ runId: execution.runId, ...final }, null, 2));
    if (final.tasks.some(task => task.state !== 'succeeded')) process.exitCode = 1;
    return;
  }
  if (subcommand === 'list') {
    const graphs = store.list(); console.log(graphs.length ? graphs.map(g => `${g.id}  ${g.mode}  ${g.tasks.length} tasks`).join('\n') : 'No agent graphs.'); return;
  }
  if (subcommand === 'show') { if (!argument) throw new Error('Usage: grain agents show <id>'); console.log(JSON.stringify(store.load(argument), null, 2)); return; }
  if (subcommand === 'dashboard') {
    if (!argument) throw new Error('Usage: grain agents dashboard <id>');
    agentDashboard(store.load(argument), new AgentMailbox(argument).list()); return;
  }
  if (subcommand === 'watch') {
    if (!argument) throw new Error('Usage: grain agents watch <id>');
    await watchAgentGraph(argument, store); return;
  }
  if (subcommand === 'execute') {
    if (!argument) throw new Error('Usage: grain agents execute <id>');
    const graph = await new WorkflowRunner(store).executeConcurrent(argument, new ExternalAgentExecutor(process.cwd()).executor(argument));
    console.log(JSON.stringify(graph, null, 2)); if (graph.tasks.some(task => task.state !== 'succeeded')) process.exitCode = 1; return;
  }
  if (subcommand === 'merge') {
    if (!argument) throw new Error('Usage: grain agents merge <id>');
    const graph = store.load(argument);
    if (!graph.tasks.every(task => task.state === 'succeeded')) throw new Error('Every task must succeed before merge');
    const driver = graph.tasks.find(task => task.role === 'driver' && task.authority.write);
    if (!driver) throw new Error('Graph has no writable driver task');
    const manager = new WorktreeManager(); const tx = manager.load(graph.id, driver.id); manager.merge(tx);
    if (tx.state !== 'merged') throw new Error(`Merge requires reconciliation: ${tx.error || 'unknown conflict'}`);
    console.log(JSON.stringify(tx, null, 2)); return;
  }
  if (subcommand === 'cancel') {
    if (!argument || !extra) throw new Error('Usage: grain agents cancel <graph-id> <task-id>');
    const graph = new (await import('../orchestration/runtime.js')).DurableAgentRuntime(store).cancel(argument, extra);
    console.log(JSON.stringify(graph.tasks.find(task => task.id === extra), null, 2)); return;
  }
  if (['solo', 'pair', 'research', 'plan', 'swarm', 'review-panel', 'repair-loop', 'migration-loop', 'benchmark-loop', 'recursive-delivery'].includes(subcommand)) {
    if (!argument) throw new Error(`Usage: grain agents ${subcommand} <objective>`);
    const graph = createTemplate(subcommand as TaskGraph['mode'], argument); const path = store.save(graph);
    console.log(JSON.stringify({ graphId: graph.id, mode: graph.mode, tasks: graph.tasks.length, path }, null, 2)); return;
  }
  throw new Error(`Unknown agents command: ${subcommand}`);
}
