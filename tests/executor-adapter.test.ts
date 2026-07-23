import { describe, expect, test } from 'bun:test';
import type { AgentPlugin, AgentTask } from '../src/plugins/types.js';
import { PluginExecutorAdapter, StdioExecutorAdapter } from '../src/orchestration/executors.js';

const authority = { read: true, write: false, network: false, destructive: false as const };

describe('normalized executor adapter', () => {
  test('normalizes plugin sessions, events, usage, evidence, and changed paths', async () => {
    let received: AgentTask | undefined;
    const plugin: AgentPlugin = {
      name: 'fake-cli', version: '1', capabilities: ['testing'], supportsPrintMode: true, supportsInteractive: false, supportsPTY: false,
      async isInstalled() { return true; }, async getVersion() { return 'fake 1.2.3'; },
      async execute(task) { received = task; return { success: true, output: 'verified', filesModified: ['src/a.ts'],
        sessionId: 'external-7', costUSD: 0.25, exitReason: 'completed' }; },
    };
    const adapter = new PluginExecutorAdapter(plugin, 'stdio');
    expect(await adapter.probe()).toMatchObject({ installed: true, version: 'fake 1.2.3', sessions: false, resume: false });
    const session = await adapter.start({ objective: 'test it', workdir: process.cwd(), provider: 'xai', model: 'grok',
      authority, isolation: 'shared_readonly', budget: { maxTurns: 3, maxCostUsd: 1, timeoutMs: 5_000 } });
    const events = (async () => { const found = []; for await (const event of adapter.watch(session.id)) found.push(event); return found; })();
    const result = await session.result;
    expect(result).toMatchObject({ success: true, summary: 'verified', changedPaths: ['src/a.ts'], externalSessionId: 'external-7', usage: { costUsd: 0.25 } });
    expect((await events).map(event => event.type)).toEqual(['started', 'completed']);
    expect(received).toMatchObject({ prompt: 'test it', provider: 'xai', model: 'grok', sandbox: 'read-only' });
  });

  test('cancellation is categorized consistently', async () => {
    const plugin: AgentPlugin = {
      name: 'slow', version: '1', capabilities: ['testing'], supportsPrintMode: true, supportsInteractive: false, supportsPTY: false,
      async isInstalled() { return true; }, async getVersion() { return '1'; },
      async execute(task) { await new Promise<void>(resolve => task.signal?.addEventListener('abort', () => resolve(), { once: true })); throw new Error('aborted'); },
    };
    const adapter = new PluginExecutorAdapter(plugin, 'stdio');
    const session = await adapter.start({ objective: 'wait', workdir: process.cwd(), authority,
      isolation: 'shared_readonly', budget: { maxTurns: 1, maxCostUsd: 0, timeoutMs: 5_000 } });
    await adapter.cancel(session.id);
    expect((await session.result).failure?.category).toBe('cancelled');
  });

  test('generic stdio bridge uses a shell-free versioned protocol', async () => {
    const script = "let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const envelope=JSON.parse(input);console.log(JSON.stringify({success:true,summary:envelope.protocol,evidence:['fake'],changedPaths:[],externalSessionId:'s1'}))})";
    const adapter = new StdioExecutorAdapter('portable-agent', { binary: process.execPath, args: ['-e', script], output: 'json' });
    expect((await adapter.probe()).installed).toBe(true);
    const session = await adapter.start({ objective: 'portable', workdir: process.cwd(), authority,
      isolation: 'shared_readonly', budget: { maxTurns: 1, maxCostUsd: 0, timeoutMs: 5_000 } });
    expect(await session.result).toMatchObject({ success: true, summary: 'grain-executor/v1', externalSessionId: 's1' });
  });
});
