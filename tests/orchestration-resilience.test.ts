import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { AgentMailbox, AgentScheduler, DurableAgentRuntime, TaskGraphStore } from '../src/orchestration/index.js';

describe('durable orchestration crash and security behavior', () => {
  test('read-only crash is retryable after lease expiry', () => {
    const scheduler = new AgentScheduler();
    const graph = scheduler.createGraph('research');
    const task = scheduler.addTask(graph, { role: 'researcher', objective: 'inspect', expectedArtifact: 'evidence' });
    scheduler.acquire(graph, task.id, 'dead-worker', 1, 0);
    expect(scheduler.recoverExpired(graph, 2)).toHaveLength(1);
    expect(task.state).toBe('ready');
    expect(task.lease).toBeUndefined();
  });

  test('writer crash never replays silently and enters reconciliation', () => {
    const scheduler = new AgentScheduler();
    const graph = scheduler.createGraph('solo');
    const task = scheduler.addTask(graph, { role: 'driver', objective: 'modify', expectedArtifact: 'patch', write: true });
    scheduler.acquire(graph, task.id, 'dead-worker', 1, 0);
    scheduler.recoverExpired(graph, 2);
    expect(task.state).toBe('needs_reconciliation');
  });

  test('runtime persists executor failure and clears its lease', async () => {
    const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('research');
    const task = scheduler.addTask(graph, { role: 'researcher', objective: 'fail safely', expectedArtifact: 'failure' });
    const store = new TaskGraphStore(); store.save(graph);
    await new DurableAgentRuntime(store, 'test-worker').runTask(graph.id, task.id, async () => { throw new Error('simulated crash'); });
    const recovered = store.load(graph.id).tasks[0];
    expect(recovered.state).toBe('failed');
    expect(recovered.lastError).toContain('simulated crash');
    expect(recovered.lease).toBeUndefined();
  });

  test('mailbox fails closed on forged acknowledgement', () => {
    const mailbox = new AgentMailbox('forged-mail', join(process.env.GRAIN_HOME!, 'forged-mail.jsonl'));
    require('node:fs').writeFileSync(mailbox.path, '{"type":"acknowledged","id":"unknown","at":"now"}\n');
    expect(() => mailbox.list()).toThrow('unknown message');
  });
});
