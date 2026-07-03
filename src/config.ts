import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import type { PluginsConfig } from './plugins/types.js';

export const GRAIN_VERSION = '0.2.0';

export interface GrainConfig {
  provider: string;
  model: string | null;
  engram_db: string;
  max_tokens: number;
  plugins?: PluginsConfig;
  vllm?: {
    endpoint?: string;
    apiKey?: string;
  };
}

const CONFIG_DIR  = process.env.GRAIN_HOME || join(homedir(), '.grain');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const ENV_PATH    = join(CONFIG_DIR, '.env');

const DEFAULTS: GrainConfig = {
  provider:   'bedrock',
  model:      null,
  engram_db:  '~/.engram/knowledge',
  max_tokens: 180000,
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
    },
    routing: {
      prefer: "claude-code",
      fallback: ["codex", "grain-native"],
      routeByCapability: true,
    },
  },
};

export const VALID_PROVIDERS = ['bedrock', 'anthropic', 'openrouter', 'ollama', 'vllm'] as const;

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
  writeFileSync(ENV_PATH, lines.filter(l => l.trim()).join('\n') + '\n', { mode: 0o600 });
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

export function getConfigDir(): string {
  ensureConfigDir();
  return CONFIG_DIR;
}

export function loadConfig(): GrainConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    // Deep-merge `plugins` — a partial user value (e.g. only `routing`) must
    // not clobber the default plugin map, which PluginRegistry requires.
    const plugins = parsed.plugins
      ? {
          plugins: { ...DEFAULTS.plugins!.plugins, ...(parsed.plugins.plugins || {}) },
          routing: { ...DEFAULTS.plugins!.routing, ...(parsed.plugins.routing || {}) },
        }
      : DEFAULTS.plugins;
    return { ...DEFAULTS, ...parsed, plugins };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config: GrainConfig | Partial<GrainConfig>): void {
  ensureConfigDir();
  const current = existsSync(CONFIG_PATH)
    ? (() => { try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; } })()
    : {};
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...DEFAULTS, ...current, ...config }, null, 2));
}

export function validateConfig(config: GrainConfig): { valid: boolean; error?: string } {
  if (!VALID_PROVIDERS.includes(config.provider as any)) {
    return { valid: false, error: `Unknown provider "${config.provider}". Valid: ${VALID_PROVIDERS.join(', ')}.\n\nRun: grain init` };
  }
  const needs: Record<string, string> = {
    anthropic:  'ANTHROPIC_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  const envKey = needs[config.provider];
  if (envKey && !process.env[envKey]) {
    return { valid: false, error: `${config.provider} requires ${envKey}.\n\nRun: grain config set key ${envKey} <your-key>\nor:  grain init` };
  }
  return { valid: true };
}
