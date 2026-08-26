import { describe, expect, test } from 'bun:test';
import { selectToolsForRun } from '../src/context/capabilities.js';
import { getSystemPrompt } from '../src/system-prompt.js';
import { TOOLS } from '../src/tools/index.js';

describe('Harbor benchmark isolation', () => {
  test('exposes only the container-proxied terminal and side-effect-free finish tools', () => {
    const selected = selectToolsForRun(TOOLS, { benchmarkBridge: true });
    expect(selected.map(tool => tool.name).sort()).toEqual(['bash', 'finish']);
    expect(selected.some(tool => ['read', 'write', 'patch', 'search', 'engram', 'delegate', 'run_agents'].includes(tool.name))).toBe(false);
  });

  test('describes the container rather than leaking the host checkout into the model prompt', () => {
    const prompt = getSystemPrompt(true, 'repair the task', { cwd: '/app', platform: 'linux', shell: '/bin/bash' });
    expect(prompt).toContain('Working directory: /app');
    expect(prompt).toContain('Platform: linux');
    expect(prompt).not.toContain(process.cwd());
  });

  test('general chat keeps read-only file tools so named paths can be opened', () => {
    const selected = selectToolsForRun(TOOLS, { generalChat: true }).map(tool => tool.name).sort();
    expect(selected).toContain('read');
    expect(selected).toContain('workspace_scan');
    expect(selected).toContain('finish');
    expect(selected.some(name => ['write', 'patch', 'bash', 'git'].includes(name))).toBe(false);
  });

  test('a non-home folder can take write tools without being a git project', () => {
    const selected = selectToolsForRun(TOOLS, { generalChat: true, allowWrites: true }).map(tool => tool.name);
    expect(selected).toContain('write');
    expect(selected).toContain('read');
  });

  test('hides Grain-native sub-agent routing when a CLI agent owns tools', () => {
    const native = getSystemPrompt(true, 'task', { cwd: '/app', platform: 'linux', shell: '/bin/bash' });
    expect(native).toContain('provider grok');
    const child = getSystemPrompt(true, 'task', { cwd: '/app', platform: 'linux', shell: '/bin/bash', agentRouting: false });
    expect(child).not.toContain('## Agents');
  });
});
