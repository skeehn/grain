import { closeSync, existsSync, fsyncSync, readFileSync, writeFileSync, mkdirSync, openSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

import type { PluginsConfig } from './plugins/types.js';
import type { AgentProfileV1, RunTreeLimits, WorkflowDefinitionV1 } from './orchestration/types.js';

export const GRAIN_VERSION = '0.2.0';

export interface GrainConfig {
  schemaVersion?: 3;
  provider: string;
  model: string | null;
  engram_db: string;
  max_tokens: number;
  /** Reasoning effort for models that support it (OpenRouter `reasoning.effort`). */
  effort?: 'low' | 'medium' | 'high';
  plugins?: PluginsConfig;
  agents?: Record<string, Partial<AgentProfileV1>>;
  workflows?: Record<string, WorkflowDefinitionV1>;
  orchestration?: Partial<RunTreeLimits>;
  providers?: Record<string, {
    kind: 'openai-compatible'; baseUrl: string; apiKeyEnv: string; defaultModel: string;
    headers?: Record<string, string>; displayName?: string;
  }>;
  vllm?: {
    endpoint?: string;
    apiKey?: string;
  };
  tui?: {
    schemaVersion: 2;
    theme: 'field' | 'studio' | 'arcade' | 'system';
    density: 'compact' | 'comfortable';
    mouse: boolean;
    alternateScreen: boolean;
    motion: boolean;
    defaultPanels: Array<'timeline' | 'workspace' | 'agents' | 'context' | 'diagnostics'>;
  };
}

const CONFIG_DIR  = process.env.GRAIN_HOME || join(homedir(), '.grain');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const ENV_PATH    = join(CONFIG_DIR, '.env');

const DEFAULTS: GrainConfig = {
  schemaVersion: 3,
  provider:   'bedrock',
  model:      null,
  engram_db:  '~/.engram/knowledge',
  max_tokens: 180000,
  tui: { schemaVersion: 2, theme: 'field', density: 'compact', mouse: true, alternateScreen: true, motion: true,
    defaultPanels: ['timeline', 'workspace', 'agents'] },
  plugins: {
    plugins: {
      "claude-code": {
        enabled: true,
        defaultModel: "sonnet",
        maxBudgetPerTask: 5.0,
        preferredFor: ["code-review", "refactoring"],
      },
      "codex": {
        enabled: true,
        maxBudgetPerTask: 3.0,
        preferredFor: ["feature-dev", "bug-fixing"],
      },
      "aider": {
        enabled: false,
      },
      "opencode": { enabled: true, preferredFor: ["feature-dev", "refactoring"] },
      "hermes": { enabled: true, preferredFor: ["documentation", "code-review"] },
      "grok": { enabled: true, preferredFor: ["feature-dev", "bug-fixing"] },
    },
    routing: {
      prefer: "claude-code",
      fallback: ["codex", "grain-native"],
      routeByCapability: true,
    },
  },
  agents: {}, workflows: {}, orchestration: {}, providers: {},
};

/** Providers backed by an installed, already-signed-in coding-agent CLI. */
export const CLI_AGENT_PROVIDERS = ['claude-code', 'codex', 'opencode', 'grok'] as const;

/** Spoken / shorthand names that must resolve to a real provider id. */
export const PROVIDER_ALIASES: Record<string, string> = {
  grokbot: 'grok',
  claude: 'claude-code',
  'quad-code': 'claude-code',
  'grok-api': 'xai',
};

export function normalizeProvider(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return PROVIDER_ALIASES[trimmed] || trimmed;
}

export const VALID_PROVIDERS = [
  'bedrock', 'anthropic', 'openrouter', 'groq', 'xai', 'ollama', 'vllm', ...CLI_AGENT_PROVIDERS,
] as const;

// ─── .env loading ─────────────────────────────────────────────────────────────
// Load ~/.grain/.env into process.env at startup.
// This means users never have to edit .zshrc / .bashrc for API keys —
// grain manages them in one place.
export function loadGrainEnv(): void {
  if (!existsSync(ENV_PATH)) return;
  try {
    const lines = readFileSync(ENV_PATH, 'utf-8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val; // never overwrite shell env
    }
  } catch { /* ignore */ }
}

export function saveKeyToEnv(key: string, value: string): void {
  ensureConfigDir();
  let contents = '';
  if (existsSync(ENV_PATH)) contents = readFileSync(ENV_PATH, 'utf-8');

  const lines = contents.split('\n').filter(l => !l.startsWith(`${key}=`));
  lines.push(`${key}=${value}`);
  atomicConfigWrite(ENV_PATH, lines.filter(l => l.trim()).join('\n') + '\n');
}

export function listEnvKeys(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    out[key] = val;
  }
  return out;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

function atomicConfigWrite(path: string, contents: string, mode = 0o600): void {
  ensureConfigDir();
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'w', mode);
  try { writeFileSync(fd, contents); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, path);
}

export function getConfigDir(): string {
  ensureConfigDir();
  return CONFIG_DIR;
}

function mergeConfig(parsed: any, project: any = {}): GrainConfig {
    const combined = { ...parsed, ...project,
      agents: { ...(parsed.agents || {}), ...(project.agents || {}) },
      workflows: { ...(parsed.workflows || {}), ...(project.workflows || {}) },
      providers: { ...(parsed.providers || {}), ...(project.providers || {}) },
      orchestration: { ...(parsed.orchestration || {}), ...(project.orchestration || {}) } };
    // Deep-merge `plugins` — a partial user value (e.g. only `routing`) must
    // not clobber the default plugin map, which PluginRegistry requires.
    const plugins = combined.plugins
      ? {
          plugins: { ...DEFAULTS.plugins!.plugins, ...(combined.plugins.plugins || {}) },
          routing: { ...DEFAULTS.plugins!.routing, ...(combined.plugins.routing || {}) },
        }
      : DEFAULTS.plugins;
    const tui = { ...DEFAULTS.tui!, ...(combined.tui || {}) };
    if (tui.theme === 'light') tui.theme = 'studio';
    tui.schemaVersion = 2;
    return { ...DEFAULTS, ...combined, schemaVersion: 3, plugins, tui };
}

export function loadConfig(workspaceRoot?: string): GrainConfig {
  let parsed: any = {};
  if (existsSync(CONFIG_PATH)) try { parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { parsed = {}; }
  let project: any = {};
  const projectPath = workspaceRoot ? join(workspaceRoot, '.grain', 'config.json') : undefined;
  if (projectPath && existsSync(projectPath)) try { project = JSON.parse(readFileSync(projectPath, 'utf-8')); } catch { project = {}; }
  try {
    return mergeConfig(parsed, project);
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config: GrainConfig | Partial<GrainConfig>): void {
  ensureConfigDir();
  const current = existsSync(CONFIG_PATH)
    ? (() => { try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; } })()
    : {};
  atomicConfigWrite(CONFIG_PATH, JSON.stringify({ ...DEFAULTS, ...current, ...config }, null, 2));
}

export function validateConfig(config: GrainConfig): { valid: boolean; error?: string } {
  if (!VALID_PROVIDERS.includes(config.provider as any) && !config.providers?.[config.provider]) {
    return { valid: false, error: `Unknown provider "${config.provider}". Valid: ${[...VALID_PROVIDERS, ...Object.keys(config.providers || {})].join(', ')}.\n\nRun: grain init` };
  }
  const needs: Record<string, string> = {
    anthropic:  'ANTHROPIC_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    groq: 'GROQ_API_KEY',
    xai: 'XAI_API_KEY',
  };
  // CLI-agent providers authenticate through their own login, so they need no
  // Grain-managed key — requiring one would lock out exactly the subscription
  // users they exist to serve.
  const isCliAgent = (CLI_AGENT_PROVIDERS as readonly string[]).includes(config.provider);
  const envKey = isCliAgent ? undefined : needs[config.provider] || config.providers?.[config.provider]?.apiKeyEnv;
  if (envKey && !process.env[envKey]) {
    return { valid: false, error: `${config.provider} requires ${envKey}.\n\nRun: grain config set key ${envKey} <your-key>\nor:  grain init` };
  }
  if (config.tui && (config.tui.schemaVersion !== 2 || !['field', 'studio', 'arcade', 'system'].includes(config.tui.theme)
    || !['compact', 'comfortable'].includes(config.tui.density))) {
    return { valid: false, error: 'Invalid TUI configuration. Expected schemaVersion=2 and a supported theme/density value.' };
  }
  for (const [id, provider] of Object.entries(config.providers || {})) {
    if (!id.trim() || provider.kind !== 'openai-compatible' || !/^https?:\/\//u.test(provider.baseUrl)
      || !provider.apiKeyEnv || !provider.defaultModel) return { valid: false, error: `Invalid custom provider configuration: ${id}` };
  }
  return { valid: true };
}
