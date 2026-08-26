import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAgentPrompt, buildCliAgentArgv, CLI_AGENTS, CliAgentProvider, cliFailureMessage,
  forgetCliSession, isCliAgentProvider, recallCliSession, rememberCliSession,
} from '../src/providers/cli-agent.js';
import { getProvider } from '../src/providers/index.js';
import { getModelCapabilities } from '../src/context/capabilities.js';

const message = (role: 'user' | 'assistant', text: string) => ({ role, content: [{ type: 'text' as const, text }] });

describe('CLI-agent providers', () => {
  test('subscription CLIs resolve to themselves, not to a paid API alias', () => {
    // `claude-code` used to map onto the Anthropic API and `codex` onto
    // OpenRouter — which billed a key the subscription user may not even have.
    expect(getProvider('claude-code').name).toBe('claude-code');
    expect(getProvider('codex').name).toBe('codex');
    expect(getProvider('opencode').name).toBe('opencode');
    expect(getProvider('grok').name).toBe('grok');
    expect(getProvider('grokbot').name).toBe('grok');
    expect(isCliAgentProvider('claude-code')).toBe(true);
    expect(isCliAgentProvider('grok')).toBe(true);
    expect(isCliAgentProvider('anthropic')).toBe(false);
  });

  test('an unspecified model defers to whatever the CLI is already set to', () => {
    expect(getProvider('claude-code').model).toBe('auto');
    expect(getProvider('claude-code', 'opus').model).toBe('opus');
  });

  test('reports the child agent context window instead of the generic default', () => {
    expect(getModelCapabilities('claude-code', 'opus').contextWindow).toBe(200_000);
    expect(getModelCapabilities('codex', 'auto').contextWindow).toBe(272_000);
    expect(getModelCapabilities('grok', 'auto').contextWindow).toBe(256_000);
    expect(getModelCapabilities('grok', 'auto').supportsTools).toBe(false);
    // Grain does not hand its own tools to an agent that runs its own loop.
    expect(getModelCapabilities('claude-code', 'opus').supportsTools).toBe(false);
  });

  test('a cold start replays history; a resumed session sends only the new turn', () => {
    const messages = [message('user', 'first request'), message('assistant', 'first answer'), message('user', 'second request')];
    const cold = buildAgentPrompt(messages, false);
    expect(cold).toContain('first request');
    expect(cold).toContain('first answer');
    expect(cold).toContain('second request');

    const warm = buildAgentPrompt(messages, true);
    expect(warm).toBe('second request');
  });

  test('session ids are remembered per agent and working directory', () => {
    const home = mkdtempSync(join(tmpdir(), 'grain-cli-session-'));
    const previous = process.env.GRAIN_HOME;
    process.env.GRAIN_HOME = home;
    try {
      expect(recallCliSession('claude-code', '/repo/a')).toBeUndefined();
      rememberCliSession('claude-code', '/repo/a', 'session-a');
      rememberCliSession('claude-code', '/repo/b', 'session-b');
      rememberCliSession('codex', '/repo/a', 'session-c');
      expect(recallCliSession('claude-code', '/repo/a')).toBe('session-a');
      expect(recallCliSession('claude-code', '/repo/b')).toBe('session-b');
      expect(recallCliSession('codex', '/repo/a')).toBe('session-c');
      forgetCliSession('claude-code', '/repo/a');
      expect(recallCliSession('claude-code', '/repo/a')).toBeUndefined();
      expect(recallCliSession('claude-code', '/repo/b')).toBe('session-b');
    } finally {
      if (previous === undefined) delete process.env.GRAIN_HOME; else process.env.GRAIN_HOME = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('child failures name the fix rather than an exit code', () => {
    expect(cliFailureMessage('codex', "You've hit your usage limit. Visit ...", 1)).toContain('usage limit');
    expect(cliFailureMessage('claude-code', 'Error: not logged in', 1)).toContain('log in');
    expect(cliFailureMessage('claude-code', '', 2)).toContain('exited with code 2');
  });

  test('every advertised agent model carries a label and a hint for the picker', () => {
    for (const definition of Object.values(CLI_AGENTS)) {
      expect(definition.models.length).toBeGreaterThan(0);
      expect(definition.models.some(model => model.id === definition.defaultModel)).toBe(true);
      for (const model of definition.models) {
        expect(model.label.length).toBeGreaterThan(0);
        expect(model.hint.length).toBeGreaterThan(0);
      }
    }
  });

  test('Codex exec is non-interactive: JSON, no TTY color, no git-repo gate, auto-approve writes', () => {
    const args = buildCliAgentArgv('codex', 'hi', undefined, { write: true });
    expect(args.slice(0, 5)).toEqual(['exec', '--json', '--skip-git-repo-check', '--color', 'never']);
    expect(args).toContain('--approve-for-me');
    expect(args).toContain('workspace-write');
    expect(args.at(-1)).toBe('hi');
    const resumed = buildCliAgentArgv('codex', 'hi', 'sess-1', { write: false });
    expect(resumed.slice(0, 3)).toEqual(['exec', 'resume', 'sess-1']);
    expect(resumed).toContain('--skip-git-repo-check');
    expect(resumed).toContain('never');
    expect(resumed).toContain('read-only');
    expect(resumed).not.toContain('--approve-for-me');
  });

  test('a missing binary surfaces as a stream error, never an unhandled throw', async () => {
    const provider = new CliAgentProvider('claude-code');
    // Point the provider at a binary that cannot exist so spawn fails.
    (provider as unknown as { definition: { binary: string } }).definition =
      { ...CLI_AGENTS['claude-code'], binary: 'grain-nonexistent-agent-binary' };
    const events = [];
    for await (const event of provider.stream([message('user', 'hello')], '', [])) events.push(event);
    expect(events.some(event => event.type === 'error')).toBe(true);
  });
});
