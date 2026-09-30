import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AgentScheduler, executeProfileGraph, TaskGraphStore } from '../src/orchestration/index.js';
import { readRunEvents } from '../src/kernel/index.js';

describe('profile-selected execution', () => {
  test('cancelling before execution does not launch any profile task', async () => {
    const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('solo');
    scheduler.addTask(graph, { role: 'researcher', objective: 'must not launch', expectedArtifact: 'none', profile: 'nonexistent', executor: 'stdio' });
    const store = new TaskGraphStore(); store.save(graph);
    const controller = new AbortController(); controller.abort();
    const result = await executeProfileGraph(graph, process.cwd(), store, controller.signal);
    expect(result.graph.tasks[0].state).toBe('cancelled');
    expect(result.graph.tasks[0].attempts).toBe(0);
    expect(readRunEvents(result.runId).at(-1)?.payload.status).toBe('cancelled');
  });
  test('a portable stdio profile runs through the durable scheduler', async () => {
    const root = join(process.env.GRAIN_HOME!, 'stdio-profile-' + randomUUID()); mkdirSync(root, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root }); writeFileSync(join(root, 'README.md'), 'fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: root }); execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
    const script = "let x='';process.stdin.on('data',c=>x+=c);process.stdin.on('end',()=>{const e=JSON.parse(x);console.log(JSON.stringify({success:true,summary:e.request.objective,evidence:['portable'],changedPaths:[]}))})";
    mkdirSync(join(root, '.grain', 'agents'), { recursive: true });
    writeFileSync(join(root, '.grain', 'agents', 'portable.md'), [
      '---', 'id: portable', 'description: portable test', 'executor: stdio',
      'command: ' + JSON.stringify({ binary: process.execPath, args: ['-e', script], output: 'json' }),
      'permissions: {"read":"allow","write":"deny"}', '---', 'Return verified evidence.',
    ].join('\n'));
    const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('solo');
    scheduler.addTask(graph, { role: 'researcher', objective: 'inspect safely', expectedArtifact: 'report',
      profile: 'portable', executor: 'stdio' }); const store = new TaskGraphStore(); store.save(graph);
    const execution = await executeProfileGraph(graph, root, store); const final = execution.graph;
    expect(final.tasks[0].state).toBe('succeeded');
    expect(final.tasks[0].result?.summary).toContain('Return verified evidence');
    expect(final.tasks[0].result?.evidence).toContain('agent:portable');
    expect(readRunEvents(execution.runId).map(event => event.type)).toContain('child_run_completed');
  });

  test('cancellation reaches a running stdio subprocess and stops dependent work', async () => {
    const root = join(process.env.GRAIN_HOME!, 'cancel-profile-' + randomUUID()); mkdirSync(root, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    const ready = join(process.env.GRAIN_HOME!, 'ready-' + randomUUID());
    mkdirSync(join(root, '.grain', 'agents'), { recursive: true });
    const script = `require('fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); process.stdin.resume(); setInterval(()=>{},1000);`;
    writeFileSync(join(root, '.grain/agents/slow.md'), [
      '---', 'id: slow', 'executor: stdio',
      'command: ' + JSON.stringify({ binary: process.execPath, args: ['-e', script], output: 'json' }),
      'permissions: {"read":"allow","write":"deny"}', '---', 'Wait.',
    ].join('\n'));
    const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('solo');
    const first = scheduler.addTask(graph, { role: 'researcher', objective: 'wait', expectedArtifact: 'none', profile: 'slow', executor: 'stdio' });
    scheduler.addTask(graph, { role: 'researcher', objective: 'must not launch', expectedArtifact: 'none', profile: 'slow', executor: 'stdio', dependencies: [first.id] });
    const store = new TaskGraphStore(); store.save(graph); const controller = new AbortController();
    const pending = executeProfileGraph(graph, root, store, controller.signal);
    try {
      for (let attempt = 0; attempt < 100 && !existsSync(ready); attempt++) await Bun.sleep(10);
      expect(existsSync(ready)).toBe(true);
    } finally { controller.abort(); }
    const result = await pending;
    expect(result.graph.tasks[1].state).toBe('cancelled');
    expect(result.graph.tasks[1].attempts).toBe(0);
    expect(readRunEvents(result.runId).at(-1)?.payload.status).toBe('cancelled');
  }, 3000);
});
