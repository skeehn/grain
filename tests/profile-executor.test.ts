import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AgentScheduler, executeProfileGraph, TaskGraphStore } from '../src/orchestration/index.js';
import { readRunEvents } from '../src/kernel/index.js';

describe('profile-selected execution', () => {
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
});
