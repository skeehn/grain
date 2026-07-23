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
});
