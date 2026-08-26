import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { loadAgentProfiles, parseAgentProfileMarkdown, validateAgentProfiles } from '../src/orchestration/profiles.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('versioned agent profiles', () => {
  test('parses a portable Markdown profile with safe bounded defaults', () => {
    const profile = parseAgentProfileMarkdown([
      '---', 'id: grok-reviewer', 'description: Independent Grok review', 'mode: subagent',
      'executor: direct-api', 'provider: xai', 'model: grok-code-fast-1',
      'skills: ["review", "security"]', 'permissions: {"read":"allow","write":"deny"}',
      'maxDepth: 1', 'maxFanOut: 2', '---', 'Review the patch and cite evidence.',
    ].join('\n'));
    expect(profile.provider).toBe('xai'); expect(profile.skills).toEqual(['review', 'security']);
    expect(profile.isolation).toBe('shared_readonly'); expect(profile.recursion).toEqual({ enabled: true, maxDepth: 1, maxFanOut: 2 });
    expect(validateAgentProfiles([profile])).toEqual([]);
  });

  test('project profiles override global profiles without losing defaults', () => {
    const root = join(process.env.GRAIN_HOME!, 'profile-workspace-' + randomUUID()); roots.push(root);
    mkdirSync(join(root, '.grain', 'agents'), { recursive: true });
    writeFileSync(join(root, '.grain', 'agents', 'driver.md'), [
      '---', 'id: driver', 'description: Project driver', 'executor: codex', 'model: gpt-5-codex',
      'permissions: {"read":"allow","write":"ask"}', '---', 'Implement only verified changes.',
    ].join('\n'));
    const profiles = loadAgentProfiles(root);
    expect(profiles.find(profile => profile.id === 'driver')?.executor).toBe('codex');
    expect(profiles.find(profile => profile.id === 'driver')?.isolation).toBe('worktree');
    expect(profiles.some(profile => profile.id === 'default')).toBe(true);
    expect(profiles.find(profile => profile.id === 'grok')?.executor).toBe('grok');
    expect(profiles.find(profile => profile.id === 'openrouter')?.executor).toBe('grain-native');
    expect(profiles.find(profile => profile.id === 'xai')?.provider).toBe('xai');
    expect(profiles.find(profile => profile.id === 'claude-code')?.executor).toBe('claude-code');
  });

  test('stdio profiles require an explicit binary', () => {
    const profile = parseAgentProfileMarkdown(['---', 'id: bridge', 'executor: stdio', '---', 'Use the bridge.'].join('\n'));
    expect(validateAgentProfiles([profile])).toContain('bridge: stdio executor requires command.binary');
  });
});
