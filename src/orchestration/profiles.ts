import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';
import { loadConfig } from '../config.js';
import { DEFAULT_RUN_TREE_LIMITS, type AgentProfileV1, type ExecutorKind, type PermissionDecision } from './types.js';

const EXECUTORS: ExecutorKind[] = ['grain-native', 'direct-api', 'claude-code', 'codex', 'opencode', 'grok', 'hermes', 'stdio'];

const BUILTIN_PROFILES = [
  ['default', '---\nid: default\ndescription: Grain native main agent\nexecutor: grain-native\nmode: primary\npermissions: {"read":"allow","write":"ask","bash":"ask"}\n---\nUse Grain\'s coding runtime, tools, diffs, and verification. Switch models with /model.'],
  ['openrouter', '---\nid: openrouter\ndescription: Grain native via OpenRouter\nexecutor: grain-native\nprovider: openrouter\nmode: primary\npermissions: {"read":"allow","write":"ask","bash":"ask"}\n---\nGrain-native main agent on OpenRouter. Delegate subscriptions with the delegate tool.'],
  ['xai', '---\nid: xai\ndescription: Grain native via xAI Grok API\nexecutor: direct-api\nprovider: xai\nmodel: grok-code-fast-1\nmode: primary\npermissions: {"read":"allow","write":"ask","bash":"ask"}\n---\nGrain-native main agent on the xAI Grok API.'],
  ['claude-code', '---\nid: claude-code\ndescription: Claude Code subscription\nexecutor: claude-code\nmode: all\npermissions: {"read":"allow","write":"ask","bash":"ask"}\n---\nClaude Code CLI. Own tools and login. Use as the main agent or as a sub-agent.'],
  ['codex', '---\nid: codex\ndescription: OpenAI Codex subscription\nexecutor: codex\nmode: all\npermissions: {"read":"allow","write":"ask","bash":"ask"}\n---\nCodex CLI. Own tools and login. Use as the main agent or as a sub-agent.'],
  ['grok', '---\nid: grok\ndescription: Grok CLI / grokbot\nexecutor: grok\nmode: all\npermissions: {"read":"allow","write":"ask","bash":"ask"}\n---\nGrok Build TUI. Own tools and login. Use as the main agent or as a sub-agent.'],
] as const;
const DECISIONS: PermissionDecision[] = ['allow', 'ask', 'deny'];

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true; if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try { return JSON.parse(trimmed); } catch { /* plain string below */ }
  }
  return trimmed.replace(/^['"]|['"]$/gu, '');
}

export function parseAgentProfileMarkdown(source: string, filename = 'agent.md'): AgentProfileV1 {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);
  if (!match) throw new Error(`${filename}: agent profile requires YAML frontmatter`);
  const meta: Record<string, any> = {};
  for (const line of match[1].split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const split = line.indexOf(':'); if (split < 1) throw new Error(`${filename}: invalid frontmatter line: ${line}`);
    meta[line.slice(0, split).trim()] = scalar(line.slice(split + 1));
  }
  const id = String(meta.id || meta.name || basename(filename, '.md'));
  const executor = String(meta.executor || 'grain-native') as ExecutorKind;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) throw new Error(`${filename}: invalid profile id ${id}`);
  if (!EXECUTORS.includes(executor)) throw new Error(`${filename}: unknown executor ${executor}`);
  const permissions = typeof meta.permissions === 'object' && !Array.isArray(meta.permissions) ? meta.permissions : {};
  for (const decision of Object.values(permissions)) if (!DECISIONS.includes(decision as PermissionDecision)) throw new Error(`${filename}: invalid permission ${decision}`);
  const write = permissions.write === 'allow' || permissions.write === 'ask';
  const list = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : value ? String(value).split(',').map(item => item.trim()).filter(Boolean) : [];
  return { schemaVersion: 1, id, description: String(meta.description || id), mode: meta.mode || 'all', executor,
    provider: meta.provider ? String(meta.provider) : undefined, model: meta.model ? String(meta.model) : undefined,
    prompt: match[2].trim() || undefined, skills: list(meta.skills), permissions,
    isolation: meta.isolation || (write ? 'worktree' : 'shared_readonly'),
    budget: { maxTurns: Number(meta.maxTurns || 20), maxCostUsd: Number(meta.maxCostUsd || 5), timeoutMs: Number(meta.timeoutMs || 30 * 60_000) },
    recursion: { enabled: meta.recursion !== false, maxDepth: Number(meta.maxDepth ?? DEFAULT_RUN_TREE_LIMITS.maxDepth),
      maxFanOut: Number(meta.maxFanOut ?? DEFAULT_RUN_TREE_LIMITS.maxConcurrency) },
    command: meta.command && typeof meta.command === 'object' ? meta.command : undefined };
}

function profilesIn(directory: string): AgentProfileV1[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.md')).sort().map(name =>
    parseAgentProfileMarkdown(readFileSync(join(directory, name), 'utf8'), join(directory, name)));
}

export function loadAgentProfiles(workspaceRoot?: string): AgentProfileV1[] {
  const config = loadConfig(workspaceRoot); const profiles = new Map<string, AgentProfileV1>();
  for (const [id, source] of BUILTIN_PROFILES) profiles.set(id, parseAgentProfileMarkdown(source, `${id}.md`));
  const globalDir = join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'agents');
  for (const profile of profilesIn(globalDir)) profiles.set(profile.id, profile);
  if (workspaceRoot) for (const profile of profilesIn(join(workspaceRoot, '.grain', 'agents'))) profiles.set(profile.id, profile);
  for (const [id, partial] of Object.entries(config.agents || {})) {
    const base = profiles.get(id) || parseAgentProfileMarkdown(`---\nid: ${id}\ndescription: ${id}\n---\n`, `${id}.md`);
    profiles.set(id, { ...base, ...partial, schemaVersion: 1, id,
      budget: { ...base.budget, ...(partial.budget || {}) }, recursion: { ...base.recursion, ...(partial.recursion || {}) },
      permissions: { ...base.permissions, ...(partial.permissions || {}) } });
  }
  return [...profiles.values()];
}

export function validateAgentProfiles(profiles: AgentProfileV1[]): string[] {
  const errors: string[] = []; const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id)) errors.push(`duplicate profile: ${profile.id}`); ids.add(profile.id);
    if (profile.recursion.maxDepth < 0 || profile.recursion.maxDepth > 4) errors.push(`${profile.id}: maxDepth must be 0-4`);
    if (profile.recursion.maxFanOut < 1 || profile.recursion.maxFanOut > 8) errors.push(`${profile.id}: maxFanOut must be 1-8`);
    if (profile.budget.maxTurns < 1 || profile.budget.timeoutMs < 1 || profile.budget.maxCostUsd < 0) errors.push(`${profile.id}: invalid budget`);
    if (profile.executor === 'stdio' && !profile.command?.binary) errors.push(`${profile.id}: stdio executor requires command.binary`);
  }
  return errors;
}
