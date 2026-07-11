import { describe, expect, test } from 'bun:test';
import { AgentMailbox, AgentScheduler, DurableAgentRuntime, RepairLoopRunner, TaskGraphStore, WorkflowRunner } from '../src/orchestration/index.js';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { createTemplate } from '../src/commands/agents.js';

describe('hybrid agent scheduler', () => {
  test('solo and repair templates always isolate their writable task', () => {
    for (const mode of ['solo', 'repair-loop'] as const) {
      const graph = createTemplate(mode, 'fix the project');
      expect(graph.tasks).toHaveLength(1);
      expect(graph.tasks[0].authority.write).toBe(true);
      expect(graph.tasks[0].isolation).toBe('worktree');
    }
  });

  test('uses shared read-only research and worktree-isolated writers', () => {
    const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('pair');
    const research = scheduler.addTask(graph, { role: 'researcher', objective: 'inspect architecture', expectedArtifact: 'evidence report' });
    const driver = scheduler.addTask(graph, { role: 'driver', objective: 'implement change', expectedArtifact: 'verified patch', write: true, dependencies: [research.id] });
    expect(research.isolation).toBe('shared_readonly');
    expect(driver.isolation).toBe('worktree');
    expect(scheduler.ready(graph).map(task => task.id)).toEqual([research.id]);
    scheduler.complete(graph, research.id, { summary: 'inspected', evidence: ['src/agent/loop.ts'], changedPaths: [] });
    expect(scheduler.ready(graph).map(task => task.id)).toEqual([driver.id]);
  });

  test('completion requires verifier evidence', () => {
    const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('research');
    const task = scheduler.addTask(graph, { role: 'researcher', objective: 'research', expectedArtifact: 'report' });
    expect(() => scheduler.complete(graph, task.id, { summary: 'done', evidence: [], changedPaths: [] })).toThrow();
  });

  test('expired read leases retry while writes enter reconciliation', () => {
    const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('pair');
    const read = scheduler.addTask(graph, { role: 'researcher', objective: 'read', expectedArtifact: 'report' });
    const write = scheduler.addTask(graph, { role: 'driver', objective: 'write', expectedArtifact: 'patch', write: true });
    scheduler.acquire(graph, read.id, 'worker', 10, 100); scheduler.acquire(graph, write.id, 'worker', 10, 100);
    scheduler.recoverExpired(graph, 111);
    expect(read.state).toBe('ready'); expect(write.state).toBe('needs_reconciliation');
  });

  test('mailbox persists delivery and acknowledgement', () => {
    const mailbox = new AgentMailbox('graph', join(process.env.GRAIN_HOME!, `mail-${randomUUID()}.jsonl`));
    const message = mailbox.send({ graphId: 'graph', from: 'parent', to: 'child', kind: 'instruction', payload: { task: 'inspect' } });
    expect(mailbox.list('child')).toHaveLength(1);
    expect(mailbox.acknowledge(message.id).acknowledgedAt).toBeTruthy();
  });

  test('runtime persists successful execution and unlocks dependencies', async () => {
    const store = new TaskGraphStore(); const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('research');
    const first = scheduler.addTask(graph, { role: 'researcher', objective: 'inspect', expectedArtifact: 'report' });
    scheduler.addTask(graph, { role: 'reviewer', objective: 'review', expectedArtifact: 'verdict', dependencies: [first.id] });
    store.save(graph);
    const runtime = new DurableAgentRuntime(store, 'test-worker');
    const after = await runtime.runReady(graph.id, async task => ({ summary: task.objective, evidence: ['test'], changedPaths: [] }));
    expect(after.tasks[0].state).toBe('succeeded'); expect(after.tasks[1].state).toBe('ready');
  });

  test('concurrent workflow runs independent ready tasks in the same wave', async () => {
    const store = new TaskGraphStore(); const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('review-panel');
    scheduler.addTask(graph, { role: 'reviewer', objective: 'a', expectedArtifact: 'a' });
    scheduler.addTask(graph, { role: 'reviewer', objective: 'b', expectedArtifact: 'b' }); store.save(graph);
    let active = 0; let peak = 0;
    const after = await new WorkflowRunner(store).executeConcurrent(graph.id, async task => {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 10)); active--;
      return { summary: task.objective, evidence: ['verified'], changedPaths: [] };
    }, 2);
    expect(peak).toBe(2); expect(after.tasks.every(task => task.state === 'succeeded')).toBe(true);
  });

  test('repair loop detects stagnation and accepts independently evidenced success', async () => {
    const runner = new RepairLoopRunner();
    await expect(runner.execute(async () => ({ passed: false, fingerprint: 'same', summary: 'failed', evidence: ['test'] }), 3)).rejects.toThrow('stagnated');
    const result = await runner.execute(async attempt => ({ passed: attempt === 2, fingerprint: `f${attempt}`, summary: 'run', evidence: ['test'] }), 3);
    expect(result.passed).toBe(true);
  });
});
